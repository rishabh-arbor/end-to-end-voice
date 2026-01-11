/**
 * Page Controller Module
 * 
 * @module browser/page-controller
 * @description Manages browser page interactions including navigation,
 *              audio device setup, and script injection for automation.
 * 
 * @example
 * const { navigateToInterview, setupAudioDevices, injectAutomation } = require('./page-controller');
 * 
 * await setupAudioDevices(page, interviewUrl);
 * await navigateToInterview(page, interviewUrl);
 * await injectAutomation(page, { password, geminiApiKey });
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Each function handles one specific task
 * - Open/Closed: Functions are extensible via options parameter
 * - Dependency Inversion: Logger and conversation are injected as dependencies
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// NAVIGATION
// ============================================================

/**
 * Navigates the browser page to the interview URL
 * Sets up console forwarding and error handling
 * 
 * @async
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} url - Interview URL to navigate to
 * @param {Object} [options={}] - Navigation options
 * @param {Object} [options.logger=console] - Logger instance
 * @param {number} [options.timeout=60000] - Navigation timeout in ms
 * @returns {Promise<void>}
 * @throws {Error} If navigation fails or times out
 * 
 * @example
 * await navigateToInterview(page, 'https://interview.example.com/abc123');
 */
async function navigateToInterview(page, url, options = {}) {
  const {
    logger = console,
    timeout = 60000,
  } = options;
  
  logger.info('[page] Navigating to:', url);
  
  // Set up console message forwarding
  setupConsoleForwarding(page, logger);
  
  // Set up error handling
  setupErrorHandling(page, logger);
  
  // Navigate with timeout
  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout,
  });
  
  logger.info('[page] ✓ Navigation complete');
  logger.info('[page] Page title:', await page.title());
}

/**
 * Sets up console message forwarding from page to logger
 * 
 * @private
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {Object} logger - Logger instance
 */
function setupConsoleForwarding(page, logger) {
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    
    switch (type) {
      case 'error':
        console.error('[page-console]', text);
        break;
      case 'warning':
        console.warn('[page-console]', text);
        break;
      default:
        console.log('[page-console]', text);
    }
  });
}

/**
 * Sets up error handling for the page
 * 
 * @private
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {Object} logger - Logger instance
 */
function setupErrorHandling(page, logger) {
  page.on('pageerror', (error) => {
    console.error('[page-error]', error.message);
  });
  
  page.on('requestfailed', (request) => {
    console.warn('[page-request-failed]', request.url(), request.failure()?.errorText);
  });
}

// ============================================================
// AUDIO DEVICE SETUP
// ============================================================

/**
 * Configures audio device permissions for the interview page
 * Grants microphone, camera, and notification permissions
 * 
 * @async
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} url - Interview URL (to determine origin for permissions)
 * @param {Object} [options={}] - Setup options
 * @param {Object} [options.logger=console] - Logger instance
 * @returns {Promise<void>}
 * 
 * @example
 * await setupAudioDevices(page, 'https://interview.example.com/abc123');
 */
async function setupAudioDevices(page, url, options = {}) {
  const { logger = console } = options;
  
  logger.info('[audio] Setting up audio device permissions...');
  
  try {
    // Parse the URL to get the origin
    const urlObj = new URL(url);
    const origin = urlObj.origin;
    
    // Override permissions for the interview site
    const context = page.browserContext();
    await context.overridePermissions(origin, [
      'microphone',
      'camera',
      'notifications',
    ]);
    
    logger.info('[audio] ✓ Audio permissions configured for:', origin);
  } catch (error) {
    logger.warn('[audio] Could not set permissions:', error.message);
    logger.info('[audio] Continuing without explicit permissions (using browser flags instead)');
  }
}

// ============================================================
// SCRIPT INJECTION
// ============================================================

/**
 * @typedef {Object} InjectOptions
 * @property {string} [password=''] - Interview password
 * @property {string} [geminiApiKey=''] - Gemini API key for in-page LLM
 * @property {Object} [conversation] - Conversation manager instance
 * @property {Object} [logger=console] - Logger instance
 */

/**
 * Injects the automation script into the interview page
 * Sets up bridge functions for communication between page and Node.js
 * 
 * @async
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {InjectOptions} [options={}] - Injection options
 * @returns {Promise<void>}
 * @throws {Error} If script injection fails
 * 
 * @example
 * await injectAutomation(page, {
 *   password: 'secret123',
 *   geminiApiKey: 'AIza...',
 *   conversation: myConversation,
 * });
 */
async function injectAutomation(page, options = {}) {
  const {
    password = '',
    geminiApiKey = '',
    logger = console,
  } = options;
  
  logger.info('[inject] Injecting automation script...');
  
  // Wait for page to be ready
  await page.waitForTimeout(2000);
  
  // Expose Node.js bridge functions to the page
  await exposeBridgeFunctions(page, options);
  
  logger.info('[inject] ✓ Node.js bridge functions exposed');
  
  // Load and inject the automation script
  const scriptContent = loadAutomationScript(logger);
  await executeAutomationScript(page, scriptContent, password, geminiApiKey);
  
  logger.info('[inject] ✓ Automation script injected');
}

/**
 * Exposes Node.js bridge functions to the browser page context
 * These functions allow the page to communicate with the Node.js process
 * 
 * @private
 * @async
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {InjectOptions} options - Options containing callbacks
 */
async function exposeBridgeFunctions(page, options) {
  const { logger = console } = options;
  
  // Logging bridge
  await page.exposeFunction('__arborLog', (level, ...args) => {
    const logFn = logger[level] || logger.info || console.log;
    logFn('[page]', ...args);
  });
  
  // Audio send bridge
  await page.exposeFunction('__arborSendAudio', async (base64Audio, sampleRate) => {
    if (options.conversation) {
      await options.conversation.sendAudio(base64Audio, sampleRate);
    }
  });
  
  // Audio file save bridge
  await page.exposeFunction('__arborSaveAudioFile', createAudioFileSaver(logger));
  
  // TTS playback bridge (via PulseAudio)
  await page.exposeFunction('__arborPlayAudio', createTTSPlaybackHandler(logger));
}

/**
 * Creates the audio file saver function
 * Saves audio files to a runtime directory for debugging
 * 
 * @private
 * @param {Object} logger - Logger instance
 * @returns {Function} Audio file saver function
 */
function createAudioFileSaver(logger) {
  return async (base64Audio, filename, sampleRate) => {
    const fsMod = require('fs');
    const pathMod = require('path');
    const os = require('os');
    
    try {
      // Create runtime directory
      const runtimeDir = pathMod.join(os.tmpdir(), 'arbor-audio-runtime');
      if (!fsMod.existsSync(runtimeDir)) {
        fsMod.mkdirSync(runtimeDir, { recursive: true });
      }
      
      // Decode and save
      const buffer = Buffer.from(base64Audio, 'base64');
      const filePath = pathMod.join(runtimeDir, filename);
      fsMod.writeFileSync(filePath, buffer);
      
      logger.info(`[audio-file] Saved: ${filename} (${buffer.length} bytes, ${sampleRate || 'unknown'}Hz)`);
      return filePath;
    } catch (error) {
      logger.error('[audio-file] Save error:', error.message);
      return null;
    }
  };
}

/**
 * Creates the TTS playback handler function
 * Plays audio through PulseAudio using paplay
 * 
 * @private
 * @param {Object} logger - Logger instance
 * @returns {Function} TTS playback handler function
 */
function createTTSPlaybackHandler(logger) {
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  const MAX_RETRIES = 2;
  
  return async (base64Audio, sampleRate) => {
    const { spawn } = require('child_process');
    const fsMod = require('fs');
    const os = require('os');
    const pathMod = require('path');
    
    // Check if PulseAudio is available before attempting playback
    const checkPulseAudio = () => {
      try {
        const { execSync } = require('child_process');
        execSync('pactl info >/dev/null 2>&1', { timeout: 1000 });
        return true;
      } catch {
        return false;
      }
    };
    
    // If too many consecutive failures, stop processing queue
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error('[audio] Too many consecutive playback failures. Stopping TTS queue to prevent audio burn-through.');
      logger.error('[audio] PulseAudio may be down. Check container logs for PulseAudio status.');
      throw new Error('TTS playback failed: PulseAudio unavailable');
    }
    
    return new Promise((resolve, reject) => {
      const playWithRetry = (retryCount = 0) => {
        try {
          // Verify PulseAudio is available
          if (!checkPulseAudio()) {
            const error = new Error('PulseAudio daemon is not running');
            logger.error('[audio]', error.message);
            consecutiveFailures++;
            reject(error);
            return;
          }
          
          // Decode base64 to raw PCM
          const buffer = Buffer.from(base64Audio, 'base64');
          
          // Create temp file
          const tmpFile = pathMod.join(os.tmpdir(), `tts_${Date.now()}_${retryCount}.raw`);
          fsMod.writeFileSync(tmpFile, buffer);
          
          logger.debug('[audio] Playing TTS via paplay:', tmpFile, 'rate:', sampleRate, retryCount > 0 ? `(retry ${retryCount})` : '');
          
          // Play through PulseAudio
          const paplay = spawn('paplay', [
            '--device=virtual_speaker',
            '--raw',
            '--format=s16le',
            '--channels=1',
            `--rate=${sampleRate || 24000}`,
            tmpFile,
          ], {
            env: {
              ...process.env,
              PULSE_SERVER: process.env.PULSE_SERVER || 'unix:/run/pulse/native',
              XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/pulse',
            },
          });
          
          let stderrOutput = '';
          paplay.stderr.on('data', (data) => {
            stderrOutput += data.toString();
          });
          
          paplay.on('close', (code) => {
            cleanupTempFile(tmpFile);
            if (code !== 0) {
              consecutiveFailures++;
              const errorMsg = `paplay exited with code ${code}${stderrOutput ? ': ' + stderrOutput.trim() : ''}`;
              logger.error('[audio]', errorMsg);
              
              // Retry if we haven't exceeded max retries
              if (retryCount < MAX_RETRIES && code === 1) {
                logger.warn('[audio] Retrying playback in 500ms...');
                setTimeout(() => playWithRetry(retryCount + 1), 500);
                return;
              }
              
              // If too many failures, reject to stop queue
              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                logger.error('[audio] CRITICAL: TTS playback failing repeatedly. PulseAudio may be down.');
                reject(new Error(`TTS playback failed after ${retryCount + 1} attempts: ${errorMsg}`));
              } else {
                resolve(); // Continue queue but log error
              }
            } else {
              // Success - reset failure counter
              consecutiveFailures = 0;
              resolve();
            }
          });
          
          paplay.on('error', (err) => {
            cleanupTempFile(tmpFile);
            consecutiveFailures++;
            logger.error('[audio] paplay spawn error:', err.message);
            
            // Retry if we haven't exceeded max retries
            if (retryCount < MAX_RETRIES) {
              logger.warn('[audio] Retrying playback in 500ms...');
              setTimeout(() => playWithRetry(retryCount + 1), 500);
              return;
            }
            
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              reject(new Error(`TTS playback failed: ${err.message}`));
            } else {
              resolve();
            }
          });
          
          // Timeout safety
          setTimeout(() => {
            if (!paplay.killed) {
              paplay.kill();
              cleanupTempFile(tmpFile);
              consecutiveFailures++;
              logger.error('[audio] paplay timeout after 10 seconds');
              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                reject(new Error('TTS playback timeout'));
              } else {
                resolve();
              }
            }
          }, 10000);
          
        } catch (error) {
          consecutiveFailures++;
          logger.error('[audio] Playback error:', error.message);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            reject(error);
          } else {
            resolve();
          }
        }
      };
      
      playWithRetry();
    });
  };
}

/**
 * Safely removes a temporary file
 * 
 * @private
 * @param {string} filePath - Path to file to remove
 */
function cleanupTempFile(filePath) {
  try {
    require('fs').unlinkSync(filePath);
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Loads the automation script from file or returns inline fallback
 * 
 * @private
 * @param {Object} logger - Logger instance
 * @returns {string} Script content
 */
function loadAutomationScript(logger) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'injected-automation.js');
  
  try {
    return fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    logger.warn('[inject] Could not read external script, using inline version');
    return getInlineAutomationScript();
  }
}

/**
 * Executes the automation script in the page context
 * Replaces placeholders with actual values
 * 
 * @private
 * @async
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} script - Script content
 * @param {string} password - Interview password
 * @param {string} apiKey - Gemini API key
 */
async function executeAutomationScript(page, script, password, apiKey) {
  await page.evaluate((scriptContent, pwd, key) => {
    // Set global config
    window.__ARBOR_CONFIG = {
      PASSWORD: pwd || '',
      GEMINI_API_KEY: key || '',
    };
    
    // Replace variable assignments
    let finalScript = scriptContent
      .replace(/var PASSWORD = ['"]__PASSWORD__['"];/g, 
               `var PASSWORD = window.__ARBOR_CONFIG.PASSWORD;`)
      .replace(/var GEMINI_API_KEY = ['"]__GEMINI_API_KEY__['"];/g, 
               `var GEMINI_API_KEY = window.__ARBOR_CONFIG.GEMINI_API_KEY;`);
    
    // Fallback placeholder replacement
    finalScript = finalScript
      .replace(/__PASSWORD__/g, (pwd || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"))
      .replace(/__GEMINI_API_KEY__/g, (key || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
    
    // Debug logging
    console.log('[inject] API key length:', key ? key.length : 0);
    console.log('[inject] GEMINI_API_KEY in script:', 
                finalScript.includes('window.__ARBOR_CONFIG.GEMINI_API_KEY') ? 'YES' : 'NO');
    console.log('[inject] Still has placeholder:', 
                finalScript.includes('__GEMINI_API_KEY__') ? 'YES' : 'NO');
    
    // Execute the script
    eval(finalScript);
  }, script, password, apiKey);
}

// ============================================================
// INLINE FALLBACK SCRIPT
// ============================================================

/**
 * Returns the inline automation script as a fallback
 * Used when the external script file cannot be loaded
 * 
 * @private
 * @returns {string} Inline automation script
 */
function getInlineAutomationScript() {
  return `
(function() {
  console.log('[arbor] Inline automation script starting...');
  
  var PASSWORD = '__PASSWORD__';
  var GEMINI_API_KEY = '__GEMINI_API_KEY__';
  
  // ============================================================
  // AUTO-CLICK AUTOMATION
  // ============================================================
  
  setInterval(function() {
    try {
      // Fill password field
      var pwd = document.querySelector('input[type="password"]');
      if (pwd && !pwd.value && PASSWORD) {
        pwd.focus();
        pwd.value = PASSWORD;
        pwd.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[arbor] Filled password');
      }
      
      // Click progress buttons
      var btns = document.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        var txt = (btn.innerText || '').toLowerCase();
        if (txt.includes('get started') || txt.includes('start voice') || 
            txt.includes('skip') || txt.includes('continue')) {
          var style = window.getComputedStyle(btn);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            console.log('[arbor] Clicked: ' + txt.slice(0, 30));
            break;
          }
        }
      }
    } catch (e) {
      console.error('[arbor] Auto-click error:', e);
    }
  }, 2000);
  
  console.log('[arbor] ✓ Automation script initialized');
})();
`;
}

// ============================================================
// MODULE EXPORTS
// ============================================================

module.exports = {
  navigateToInterview,
  setupAudioDevices,
  injectAutomation,
};
