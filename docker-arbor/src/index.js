/**
 * Interview Bot - Main Entry Point
 * 
 * Orchestrates the interview automation:
 * 1. Launches headless browser via Puppeteer
 * 2. Sets up virtual audio capture/playback
 * 3. Connects to LLM for real-time conversation
 */

const { launchBrowser, closeBrowser } = require('./browser/puppeteer-launcher');
const { navigateToInterview, injectAutomation, setupAudioDevices } = require('./browser/page-controller');
const { createLLMClient } = require('./llm/client');
const { createConversation } = require('./llm/conversation');

// Environment variables
const INTERVIEW_URL = process.env.INTERVIEW_URL;
const INTERVIEW_PASSWORD = process.env.INTERVIEW_PASSWORD || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TIMEOUT_SECONDS = parseInt(process.env.TIMEOUT_SECONDS || '1800', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Logger utility
const logger = {
  debug: (...args) => LOG_LEVEL === 'debug' && console.log('[DEBUG]', ...args),
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};

// Health check server
const http = require('http');
let isHealthy = false;

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(isHealthy ? 200 : 503);
    res.end(JSON.stringify({ 
      status: isHealthy ? 'ok' : 'starting',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

healthServer.listen(3000, () => {
  logger.info('Health check server listening on port 3000');
});

// Main function
async function main() {
  logger.info('=== Interview Bot Starting ===');
  logger.info(`Interview URL: ${INTERVIEW_URL || '<not set>'}`);
  logger.info(`Timeout: ${TIMEOUT_SECONDS} seconds`);
  
  // Validate required environment variables
  if (!INTERVIEW_URL) {
    logger.error('INTERVIEW_URL environment variable is required');
    process.exit(1);
  }
  
  if (!GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY environment variable is required');
    process.exit(1);
  }
  
  let browser = null;
  let page = null;
  let llmClient = null;
  let timeoutId = null;
  
  try {
    // Set up timeout
    timeoutId = setTimeout(() => {
      logger.warn(`Interview timeout reached (${TIMEOUT_SECONDS}s), shutting down...`);
      cleanup();
      process.exit(0);
    }, TIMEOUT_SECONDS * 1000);
    
    // Launch browser
    logger.info('Launching browser...');
    browser = await launchBrowser();
    page = await browser.newPage();
    
    // Set up audio devices in browser context
    logger.info('Setting up audio devices...');
    await setupAudioDevices(page, INTERVIEW_URL);
    
    // Navigate to interview
    logger.info(`Navigating to interview: ${INTERVIEW_URL}`);
    await navigateToInterview(page, INTERVIEW_URL);
    
    // Create LLM client its kind of experimental so dont mind, not used
    logger.info('Creating LLM client...');
    llmClient = createLLMClient({
      apiKey: GEMINI_API_KEY,
      logger,
    });
    
    // Create conversation manager
    const conversation = createConversation({
      llmClient,
      logger,
    });
    
    // Inject automation script
    logger.info('Injecting automation script...');
    await injectAutomation(page, {
      password: INTERVIEW_PASSWORD,
      geminiApiKey: GEMINI_API_KEY,
      conversation,
      logger,
    });
    
    // Mark as healthy
    isHealthy = true;
    logger.info('✓ Interview bot is running');
    
    // Keep process alive
    await new Promise((resolve) => {
      // Handle page close
      page.on('close', () => {
        logger.info('Page closed');
        resolve();
      });
      
      // Handle browser disconnect
      browser.on('disconnected', () => {
        logger.info('Browser disconnected');
        resolve();
      });
    });
    
  } catch (error) {
    logger.error('Fatal error:', error.message);
    logger.debug(error.stack);
  } finally {
    await cleanup();
  }
  
  async function cleanup() {
    logger.info('Cleaning up...');
    isHealthy = false;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    if (llmClient) {
      try {
        llmClient.close();
      } catch (e) {
        logger.debug('Error closing LLM client:', e.message);
      }
    }
    
    if (browser) {
      try {
        await closeBrowser(browser);
      } catch (e) {
        logger.debug('Error closing browser:', e.message);
      }
    }
    
    healthServer.close();
  }
}

// Handle process signals
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error.message);
  logger.debug(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logger.error('Main process error:', error.message);
  process.exit(1);
});

