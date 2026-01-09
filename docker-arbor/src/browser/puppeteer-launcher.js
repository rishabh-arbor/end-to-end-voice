/**
 * Puppeteer Launcher - Launches headless Chrome with appropriate settings
 */

const puppeteer = require('puppeteer-core');

// Check if headless mode should be disabled
const HEADLESS = process.env.HEADLESS !== 'false' && !process.argv.includes('--no-headless');

// Determine executable path based on platform
function getExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/usr/bin/chromium';
}

// Default browser launch options
const DEFAULT_OPTIONS = {
  headless: HEADLESS,
  executablePath: getExecutablePath(),
  args: [
    // Required for Docker
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    
    // Audio settings - use REAL PulseAudio devices (not fake)
    '--use-fake-ui-for-media-stream',      // Auto-allow mic/camera permissions (but use real devices)
    '--autoplay-policy=no-user-gesture-required',
    '--alsa-output-device=default',
    '--alsa-input-device=default',
    
    // Performance optimizations (disable GPU only in headless)
    HEADLESS ? '--disable-gpu' : '',
    '--disable-software-rasterizer',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio=false',  // Don't mute audio (we need it for capture)
    '--no-first-run',
    
    // Window size and position
    '--window-size=1920,1080',
    '--window-position=0,0',
    
    // For VNC display
    '--start-maximized',
    
    // CRITICAL: Disable WebRTC audio processing that filters loopback
    '--disable-features=WebRtcAecDump,AudioServiceOutOfProcess',
    '--disable-rtc-smoothness-algorithm',
    '--disable-webrtc-hw-encoding',
    '--disable-webrtc-hw-decoding',
    // Disable echo cancellation, noise suppression, auto gain
    '--enable-features=WebRtcHideLocalIpsWithMdns',
  ].filter(Boolean),
  defaultViewport: {
    width: 1920,
    height: 1080,
  },
  // Increase timeouts for slower environments
  timeout: 60000,
};

/**
 * Launch a new browser instance
 * @param {object} options - Additional launch options
 * @returns {Promise<Browser>}
 */
async function launchBrowser(options = {}) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    args: [...DEFAULT_OPTIONS.args, ...(options.args || [])],
  };
  
  console.log('[browser] Launching browser with executable:', mergedOptions.executablePath);
  console.log('[browser] Headless:', mergedOptions.headless);
  
  const browser = await puppeteer.launch(mergedOptions);
  
  console.log('[browser] ✓ Browser launched successfully');
  
  // Log browser version
  const version = await browser.version();
  console.log('[browser] Version:', version);
  
  return browser;
}

/**
 * Close browser instance gracefully
 * @param {Browser} browser
 */
async function closeBrowser(browser) {
  if (!browser) return;
  
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      await page.close().catch(() => {});
    }
    await browser.close();
    console.log('[browser] ✓ Browser closed');
  } catch (error) {
    console.error('[browser] Error closing browser:', error.message);
    // Force kill if graceful close fails
    const browserProcess = browser.process();
    if (browserProcess) {
      browserProcess.kill('SIGKILL');
    }
  }
}

module.exports = {
  launchBrowser,
  closeBrowser,
  DEFAULT_OPTIONS,
};

