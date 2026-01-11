/**
 * Puppeteer Launcher Module
 * 
 * @module browser/puppeteer-launcher
 * @description Launches and manages headless Chrome instances with appropriate
 *              settings for Docker environments and audio handling.
 * 
 * @example
 * const { launchBrowser, closeBrowser } = require('./puppeteer-launcher');
 * 
 * const browser = await launchBrowser();
 * const page = await browser.newPage();
 * // ... use the page
 * await closeBrowser(browser);
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Only handles browser launching/closing
 * - Open/Closed: Configurable via options and DEFAULT_OPTIONS
 * - Dependency Inversion: Uses puppeteer-core (injected dependency)
 */

'use strict';

const puppeteer = require('puppeteer-core');

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Check if headless mode should be disabled
 * Defaults to headless unless explicitly disabled via env or args
 * @type {boolean}
 */
const HEADLESS = process.env.HEADLESS !== 'false' && !process.argv.includes('--no-headless');

/**
 * Determines the Chrome/Chromium executable path based on platform
 * Checks environment variable first, then falls back to platform defaults
 * 
 * @private
 * @returns {string} Path to Chrome/Chromium executable
 */
function getExecutablePath() {
  // Allow override via environment variable
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  // Platform-specific defaults
  switch (process.platform) {
    case 'darwin':
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'win32':
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    default:
      return '/usr/bin/chromium';
  }
}

/**
 * Default browser launch options
 * Configured for Docker environments with virtual audio support
 * 
 * @constant {Object}
 */
const DEFAULT_OPTIONS = {
  /**
   * Whether to run browser in headless mode
   * @type {boolean}
   */
  headless: HEADLESS,
  
  /**
   * Path to Chrome/Chromium executable
   * @type {string}
   */
  executablePath: getExecutablePath(),
  
  /**
   * Chrome launch arguments
   * @type {string[]}
   */
  args: [
    // ===========================================
    // DOCKER / CONTAINER REQUIREMENTS
    // ===========================================
    '--no-sandbox',                           // Required for Docker
    '--disable-setuid-sandbox',               // Required for Docker
    '--disable-dev-shm-usage',                // Prevents /dev/shm issues in Docker
    
    // ===========================================
    // AUDIO CONFIGURATION
    // ===========================================
    
    // Auto-allow microphone/camera permissions (but use real devices)
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    
    // Enable PulseAudio support and loopback features
    '--enable-features=PulseAudioLoopbackForScreenShare,PulseAudioLoopbackForCast',
    
    // CRITICAL: Force ALSA to use PulseAudio (via .asoundrc)
    '--alsa-output-device=default',
    
    // CRITICAL: Allow audio service to access PulseAudio socket
    '--enable-audio-service-sandbox=false',
    
    // CRITICAL: Disable audio processing that filters loopback audio
    // Echo cancellation/noise suppression would remove our TTS audio
    '--disable-features=WebRtcAecDump,AudioServiceOutOfProcess,WebRtcUseEchoCanceller3',
    '--disable-rtc-smoothness-algorithm',
    '--disable-webrtc-hw-encoding',
    '--disable-webrtc-hw-decoding',
    '--disable-audio-output-resampler',
    
    // Don't mute audio (we need it for capture/playback)
    '--mute-audio=false',
    
    // ===========================================
    // PERFORMANCE OPTIMIZATIONS
    // ===========================================
    HEADLESS ? '--disable-gpu' : '',          // Disable GPU only in headless mode
    '--disable-software-rasterizer',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',
    
    // ===========================================
    // WINDOW CONFIGURATION
    // ===========================================
    '--window-size=1920,1080',
    '--window-position=0,0',
    '--start-maximized',                      // For VNC display
    
  ].filter(Boolean),  // Remove empty strings
  
  /**
   * Default viewport dimensions
   */
  defaultViewport: {
    width: 1920,
    height: 1080,
  },
  
  /**
   * Operation timeout in milliseconds
   */
  timeout: 60000,
};

// ============================================================
// BROWSER LIFECYCLE
// ============================================================

/**
 * Launches a new browser instance with the specified options
 * 
 * @async
 * @param {Object} [options={}] - Additional launch options to merge
 * @param {string[]} [options.args=[]] - Additional Chrome arguments
 * @param {boolean} [options.headless] - Override headless mode
 * @param {string} [options.executablePath] - Override executable path
 * @returns {Promise<import('puppeteer').Browser>} Puppeteer browser instance
 * @throws {Error} If browser fails to launch
 * 
 * @example
 * // Launch with defaults
 * const browser = await launchBrowser();
 * 
 * @example
 * // Launch with custom options
 * const browser = await launchBrowser({
 *   args: ['--proxy-server=localhost:8080'],
 *   headless: false,
 * });
 */
async function launchBrowser(options = {}) {
  // Merge options with defaults
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    // Merge args arrays instead of replacing
    args: [...DEFAULT_OPTIONS.args, ...(options.args || [])],
  };
  
  // CRITICAL: Add PulseAudio environment variables to browser process
  // This ensures Chromium uses PulseAudio instead of falling back to ALSA/dummy
  mergedOptions.env = {
    ...process.env,
    // PulseAudio connection
    PULSE_SERVER: process.env.PULSE_SERVER || 'unix:/run/pulse/native',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/pulse',
    // ALSA will route through PulseAudio via .asoundrc
    ALSA_CARD: 'PULSE',
  };
  
  console.log('[browser] Launching browser with executable:', mergedOptions.executablePath);
  console.log('[browser] Headless:', mergedOptions.headless);
  console.log('[browser] PulseAudio env:', {
    PULSE_SERVER: mergedOptions.env.PULSE_SERVER,
    XDG_RUNTIME_DIR: mergedOptions.env.XDG_RUNTIME_DIR,
  });
  
  // Launch browser
  const browser = await puppeteer.launch(mergedOptions);
  
  console.log('[browser] ✓ Browser launched successfully');
  
  // Log browser version for debugging
  const version = await browser.version();
  console.log('[browser] Version:', version);
  
  return browser;
}

/**
 * Closes a browser instance gracefully
 * First closes all pages, then closes the browser
 * Falls back to force kill if graceful close fails
 * 
 * @async
 * @param {import('puppeteer').Browser} browser - Browser instance to close
 * @returns {Promise<void>}
 * 
 * @example
 * await closeBrowser(browser);
 * console.log('Browser closed');
 */
async function closeBrowser(browser) {
  if (!browser) {
    return;
  }
  
  try {
    // Close all pages first
    const pages = await browser.pages();
    for (const page of pages) {
      await page.close().catch(() => {});  // Ignore individual page close errors
    }
    
    // Close the browser
    await browser.close();
    console.log('[browser] ✓ Browser closed');
    
  } catch (error) {
    console.error('[browser] Error closing browser:', error.message);
    
    // Force kill if graceful close fails
    const browserProcess = browser.process();
    if (browserProcess) {
      console.log('[browser] Force killing browser process');
      browserProcess.kill('SIGKILL');
    }
  }
}

// ============================================================
// MODULE EXPORTS
// ============================================================

module.exports = {
  launchBrowser,
  closeBrowser,
  DEFAULT_OPTIONS,
  getExecutablePath,
};
