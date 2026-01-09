// Quick test to verify Puppeteer works
const puppeteer = require('puppeteer-core');

async function test() {
  console.log('Testing Puppeteer launch...');
  
  // Find Chrome on macOS
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  
  let executablePath;
  for (const p of chromePaths) {
    try {
      require('fs').accessSync(p);
      executablePath = p;
      break;
    } catch {}
  }
  
  if (!executablePath) {
    console.error('Chrome not found! Install Google Chrome.');
    process.exit(1);
  }
  
  console.log('Using Chrome:', executablePath);
  
  const browser = await puppeteer.launch({
    headless: false,  // Show browser for testing
    executablePath,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });
  
  const page = await browser.newPage();
  console.log('Browser launched!');
  
  // Navigate to a test page
  await page.goto('https://www.google.com');
  console.log('Navigated to Google');
  
  // Keep browser open for 10 seconds
  console.log('Browser will close in 10 seconds...');
  await new Promise(r => setTimeout(r, 10000));
  
  await browser.close();
  console.log('Test complete!');
}

test().catch(console.error);
