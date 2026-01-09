/**
 * Page Controller - Manages browser page interactions
 * 
 * Handles:
 * - Navigation to interview URL
 * - Audio device setup
 * - Script injection for automation
 */

const fs = require('fs');
const path = require('path');

/**
 * Navigate to the interview URL
 * @param {Page} page - Puppeteer page instance
 * @param {string} url - Interview URL
 */
async function navigateToInterview(page, url) {
  console.log('[page] Navigating to:', url);
  
  // Set up console message forwarding
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.error('[page-console]', text);
    } else if (type === 'warning') {
      console.warn('[page-console]', text);
    } else {
      console.log('[page-console]', text);
    }
  });
  
  // Handle page errors
  page.on('pageerror', (error) => {
    console.error('[page-error]', error.message);
  });
  
  // Handle requests (for debugging)
  page.on('requestfailed', (request) => {
    console.warn('[page-request-failed]', request.url(), request.failure()?.errorText);
  });
  
  // Navigate with timeout
  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  
  console.log('[page] ✓ Navigation complete');
  console.log('[page] Page title:', await page.title());
}

/**
 * Set up audio devices to use PulseAudio virtual devices
 * @param {Page} page - Puppeteer page instance
 * @param {string} url - The interview URL (to grant permissions for)
 */
async function setupAudioDevices(page, url) {
  console.log('[audio] Setting up audio device permissions...');
  
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
    
    console.log('[audio] ✓ Audio permissions configured for:', origin);
  } catch (error) {
    console.warn('[audio] Could not set permissions:', error.message);
    console.log('[audio] Continuing without explicit permissions (using browser flags instead)');
  }
}

/**
 * Inject the automation script into the page
 * @param {Page} page - Puppeteer page instance
 * @param {object} options - Configuration options
 */
async function injectAutomation(page, options = {}) {
  const {
    password = '',
    geminiApiKey = '',
    logger = console,
  } = options;
  
  console.log('[inject] Injecting automation script...');
  
  // Wait for page to be ready
  await page.waitForTimeout(2000);
  
  // Read the injected script
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'injected-automation.js');
  let scriptContent;
  
  try {
    scriptContent = fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    console.warn('[inject] Could not read external script, using inline version');
    scriptContent = getInlineAutomationScript();
  }
  
  // IMPORTANT: Expose functions BEFORE injecting the script!
  // Set up message handler for communication from page
  await page.exposeFunction('__arborLog', (level, ...args) => {
    const logFn = logger[level] || logger.info || console.log;
    logFn('[page]', ...args);
  });
  
  // Set up audio data handler
  await page.exposeFunction('__arborSendAudio', async (base64Audio, sampleRate) => {
    // This will be called by the page when it captures audio
    if (options.conversation) {
      await options.conversation.sendAudio(base64Audio, sampleRate);
    }
  });
  
  // Set up audio file saver - saves audio files to runtime directory
  await page.exposeFunction('__arborSaveAudioFile', async (base64Audio, filename, sampleRate) => {
    const fs = require('fs');
    const pathMod = require('path');
    const os = require('os');
    
    try {
      // Create runtime directory
      const runtimeDir = pathMod.join(os.tmpdir(), 'arbor-audio-runtime');
      if (!fs.existsSync(runtimeDir)) {
        fs.mkdirSync(runtimeDir, { recursive: true });
      }
      
      // Decode base64 to buffer
      const buffer = Buffer.from(base64Audio, 'base64');
      
      // Save file
      const filePath = pathMod.join(runtimeDir, filename);
      fs.writeFileSync(filePath, buffer);
      
      console.log(`[audio-file] Saved: ${filename} (${buffer.length} bytes, ${sampleRate || 'unknown'}Hz) -> ${filePath}`);
      return filePath;
    } catch (e) {
      console.error('[audio-file] Save error:', e.message);
      return null;
    }
  });
  
  // Set up TTS playback handler - plays through PulseAudio for REAL audio flow
  await page.exposeFunction('__arborPlayAudio', async (base64Audio, sampleRate) => {
    const { spawn } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const pathMod = require('path');
    
    return new Promise((resolve, reject) => {
      try {
        // Decode base64 to raw PCM
        const buffer = Buffer.from(base64Audio, 'base64');
        
        // Create temp file for the audio
        const tmpFile = pathMod.join(os.tmpdir(), `tts_${Date.now()}.raw`);
        fs.writeFileSync(tmpFile, buffer);
        
        console.log('[audio] Playing TTS via paplay:', tmpFile, 'rate:', sampleRate);
        
        // Play through PulseAudio using paplay
        // Set PULSE_SERVER to use the correct PulseAudio socket
        const paplay = spawn('paplay', [
          '--raw',
          '--format=s16le',
          '--channels=1',
          `--rate=${sampleRate || 24000}`,
          tmpFile
        ], {
          env: {
            ...process.env,
            PULSE_SERVER: process.env.PULSE_SERVER || 'unix:/run/pulse/native',
            XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/pulse'
          }
        });
        
        paplay.stdout.on('data', (data) => {
          console.log('[paplay]', data.toString());
        });
        
        paplay.stderr.on('data', (data) => {
          console.log('[paplay-err]', data.toString());
        });
        
        paplay.on('close', (code) => {
          try { fs.unlinkSync(tmpFile); } catch (e) {}
          if (code !== 0) {
            console.error('[audio] paplay exited with code:', code);
          }
          resolve();
        });
        
        paplay.on('error', (err) => {
          console.error('[audio] paplay error:', err.message);
          try { fs.unlinkSync(tmpFile); } catch (e) {}
          resolve();
        });
        
        // Timeout safety
        setTimeout(() => {
          paplay.kill();
          try { fs.unlinkSync(tmpFile); } catch (e) {}
          resolve();
        }, 10000);
        
      } catch (e) {
        console.error('[audio] Playback error:', e.message);
        resolve();
      }
    });
  });
  
  console.log('[inject] ✓ Node.js bridge functions exposed');
  
  // Execute the script in page context with the values as parameters
  // Set variables directly in window scope, then run script
  await page.evaluate((script, pwd, apiKey) => {
    // Set global variables first - these will be used by the script
    window.__ARBOR_CONFIG = {
      PASSWORD: pwd || '',
      GEMINI_API_KEY: apiKey || ''
    };
    
    // Replace variable assignments to use window config
    // Match the exact format from the script file
    let finalScript = script
      .replace(/var PASSWORD = ['"]__PASSWORD__['"];/g, `var PASSWORD = window.__ARBOR_CONFIG.PASSWORD;`)
      .replace(/var GEMINI_API_KEY = ['"]__GEMINI_API_KEY__['"];/g, `var GEMINI_API_KEY = window.__ARBOR_CONFIG.GEMINI_API_KEY;`);
    
    // Also replace any remaining placeholders (fallback)
    finalScript = finalScript
      .replace(/__PASSWORD__/g, (pwd || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"'))
      .replace(/__GEMINI_API_KEY__/g, (apiKey || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"'));
    
    // Debug - verify the replacement
    console.log('[inject] API key length:', apiKey ? apiKey.length : 0);
    console.log('[inject] GEMINI_API_KEY in script:', finalScript.includes('window.__ARBOR_CONFIG.GEMINI_API_KEY') ? 'YES' : 'NO');
    console.log('[inject] Still has placeholder:', finalScript.includes('__GEMINI_API_KEY__') ? 'YES' : 'NO');
    
    if (!apiKey || apiKey.length < 10) {
      console.warn('[inject] WARNING: API key seems invalid!');
    }
    
    eval(finalScript);
    
    // Verify after eval
    if (typeof window.GEMINI_API_KEY !== 'undefined') {
      console.log('[inject] GEMINI_API_KEY variable exists, length:', window.GEMINI_API_KEY ? window.GEMINI_API_KEY.length : 0);
    }
  }, scriptContent, password, geminiApiKey);
  
  console.log('[inject] ✓ Automation script injected');
}

/**
 * Inline automation script (fallback if external file not found)
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
  
  var tickCounter = 0;
  setInterval(function() {
    try {
      tickCounter++;
      
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
            txt.includes('skip') || txt.includes('continue') || 
            txt.includes('begin') || txt.includes('next')) {
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
  
  // ============================================================
  // AUDIO CAPTURE & PROCESSING
  // ============================================================
  
  var audioContext = null;
  var captureStream = null;
  var isCapturing = false;
  
  async function startAudioCapture() {
    if (isCapturing) return;
    
    try {
      console.log('[arbor] Starting audio capture...');
      
      // Get audio from virtual mic (PulseAudio will route speaker output here)
      captureStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        },
        video: false
      });
      
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      var source = audioContext.createMediaStreamSource(captureStream);
      
      // Create processor for capturing audio data
      var bufferSize = 4096;
      var pcmBuffer = [];
      var SAMPLES_PER_CHUNK = audioContext.sampleRate * 2; // 2 seconds
      
      // Use AudioWorklet if available, fallback to ScriptProcessor
      if (audioContext.audioWorklet) {
        var workletCode = 'class PCMProcessor extends AudioWorkletProcessor { process(inputs){ if(inputs[0]&&inputs[0][0]) this.port.postMessage(inputs[0][0]); return true;} } registerProcessor("pcm-processor", PCMProcessor);';
        var blob = new Blob([workletCode], { type: 'application/javascript' });
        var url = URL.createObjectURL(blob);
        
        await audioContext.audioWorklet.addModule(url);
        var workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        
        workletNode.port.onmessage = function(ev) {
          var f32 = ev.data;
          for (var i = 0; i < f32.length; i++) {
            var s = Math.max(-1, Math.min(1, f32[i]));
            pcmBuffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
          }
          
          if (pcmBuffer.length >= SAMPLES_PER_CHUNK) {
            sendAudioChunk(pcmBuffer.slice(0, SAMPLES_PER_CHUNK), audioContext.sampleRate);
            pcmBuffer = pcmBuffer.slice(SAMPLES_PER_CHUNK);
          }
        };
        
        source.connect(workletNode);
        workletNode.connect(audioContext.destination);
      }
      
      isCapturing = true;
      console.log('[arbor] ✓ Audio capture started');
      
    } catch (e) {
      console.error('[arbor] Audio capture failed:', e.message);
    }
  }
  
  function sendAudioChunk(pcmData, sampleRate) {
    try {
      var pcm16 = new Int16Array(pcmData);
      var bytes = new Uint8Array(pcm16.buffer);
      var binary = '';
      for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      var base64 = btoa(binary);
      
      // Send to Node.js process
      if (window.__arborSendAudio) {
        window.__arborSendAudio(base64, sampleRate);
      }
    } catch (e) {
      console.error('[arbor] Send audio error:', e.message);
    }
  }
  
  // ============================================================
  // TTS PLAYBACK
  // ============================================================
  
  var ttsContext = null;
  var ttsQueue = [];
  var isPlayingTTS = false;
  
  window.__arborPlayTTS = function(base64Audio, sampleRate) {
    try {
      if (!ttsContext) {
        ttsContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Decode base64 to PCM
      var binary = atob(base64Audio);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      var pcm16 = new Int16Array(bytes.buffer);
      var float32 = new Float32Array(pcm16.length);
      for (var i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }
      
      // Create audio buffer and play
      var buffer = ttsContext.createBuffer(1, float32.length, sampleRate || 24000);
      buffer.getChannelData(0).set(float32);
      
      ttsQueue.push(buffer);
      playNextTTS();
      
    } catch (e) {
      console.error('[arbor] TTS playback error:', e.message);
    }
  };
  
  function playNextTTS() {
    if (isPlayingTTS || ttsQueue.length === 0) return;
    
    isPlayingTTS = true;
    var buffer = ttsQueue.shift();
    
    var source = ttsContext.createBufferSource();
    source.buffer = buffer;
    
    // Boost volume
    var gain = ttsContext.createGain();
    gain.gain.value = 5.0;
    source.connect(gain);
    gain.connect(ttsContext.destination);
    
    source.onended = function() {
      isPlayingTTS = false;
      playNextTTS();
    };
    
    source.start(0);
  }
  
  // ============================================================
  // INITIALIZE
  // ============================================================
  
  // Start audio capture after a delay
  setTimeout(startAudioCapture, 5000);
  
  console.log('[arbor] ✓ Automation script initialized');
})();
`;
}

module.exports = {
  navigateToInterview,
  setupAudioDevices,
  injectAutomation,
};

