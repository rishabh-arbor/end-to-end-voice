/**
 * Interview Bot - Main Entry Point
 * 
 * @module index
 * @description Orchestrates the interview automation by composing and coordinating
 *              all system components. Implements dependency injection for testability
 *              and follows SOLID principles for maintainability.
 * 
 * Architecture Overview:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                     Interview Bot                           │
 * ├─────────────────────────────────────────────────────────────┤
 * │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
 * │  │ Config  │    │ Logger  │    │ Health  │    │ Browser │  │
 * │  └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
 * │       │              │              │              │        │
 * │       └──────────────┴──────────────┴──────────────┘        │
 * │                          │                                  │
 * │                    ┌─────┴─────┐                            │
 * │                    │    App    │                            │
 * │                    └─────┬─────┘                            │
 * │                          │                                  │
 * │              ┌───────────┴───────────┐                      │
 * │              │                       │                      │
 * │        ┌─────┴─────┐          ┌──────┴──────┐               │
 * │        │ LLM Client│          │ Conversation │               │
 * │        └───────────┘          └─────────────┘               │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Each module has one reason to change
 * - Open/Closed: Extensible via configuration and composition
 * - Liskov Substitution: All modules implement consistent interfaces
 * - Interface Segregation: Modules expose minimal required APIs
 * - Dependency Inversion: High-level modules depend on abstractions
 * 
 * @example
 * // The application starts automatically via main()
 * // Environment variables configure behavior:
 * // - INTERVIEW_URL: Target interview URL (required)
 * // - GEMINI_API_KEY: API key for LLM (required)
 * // - TIMEOUT_SECONDS: Auto-shutdown timeout
 * // - LOG_LEVEL: Logging verbosity (debug|info|warn|error)
 */

'use strict';

// ============================================================
// IMPORTS
// ============================================================

const { config, validateConfig } = require('./config');
const { createLogger } = require('./utils/logger');
const { createHealthServer } = require('./services/health-server');
const { launchBrowser, closeBrowser } = require('./browser/puppeteer-launcher');
const { navigateToInterview, injectAutomation, setupAudioDevices } = require('./browser/page-controller');
const { createLLMClient } = require('./llm/client');
const { createConversation } = require('./llm/conversation');

// ============================================================
// APPLICATION STATE
// ============================================================

/**
 * @typedef {Object} AppState
 * @property {Object|null} browser - Puppeteer browser instance
 * @property {Object|null} page - Puppeteer page instance
 * @property {Object|null} llmClient - LLM client instance
 * @property {Object|null} conversation - Conversation manager instance
 * @property {Object|null} healthServer - Health server instance
 * @property {NodeJS.Timeout|null} timeoutId - Timeout timer ID
 * @property {boolean} isShuttingDown - Whether shutdown is in progress
 */

/**
 * Application state container
 * @type {AppState}
 */
const state = {
  browser: null,
  page: null,
  llmClient: null,
  conversation: null,
  healthServer: null,
  timeoutId: null,
  isShuttingDown: false,
};

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Creates and initializes the logger instance
 * 
 * @private
 * @returns {Object} Logger instance
 */
function initializeLogger() {
  return createLogger({
    level: config.logLevel,
    prefix: '[App]',
    timestamps: true,
  });
}

/**
 * Creates and starts the health check server
 * 
 * @private
 * @async
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} Health server instance
 */
async function initializeHealthServer(logger) {
  const healthServer = createHealthServer({
    port: config.healthPort,
    logger,
    metadata: {
      version: require('../package.json').version,
      interview: config.interview.url ? 'configured' : 'not configured',
    },
  });
  
  await healthServer.start();
  return healthServer;
}

/**
 * Launches the browser and creates a new page
 * 
 * @private
 * @async
 * @param {Object} logger - Logger instance
 * @returns {Promise<{browser: Object, page: Object}>} Browser and page instances
 */
async function initializeBrowser(logger) {
  logger.info('Launching browser...');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  return { browser, page };
}

/**
 * Creates the LLM client instance
 * 
 * @private
 * @param {Object} logger - Logger instance
 * @returns {Object} LLM client instance
 */
function initializeLLMClient(logger) {
  logger.info('Creating LLM client...');
  return createLLMClient({
    apiKey: config.gemini.apiKey,
    model: config.gemini.model,
    voiceName: config.gemini.voiceName,
    logger,
  });
}

/**
 * Creates the conversation manager instance
 * 
 * @private
 * @param {Object} llmClient - LLM client instance
 * @param {Object} logger - Logger instance
 * @returns {Object} Conversation manager instance
 */
function initializeConversation(llmClient, logger) {
  return createConversation({
    llmClient,
    logger,
    responseDelayMs: 5000,
    cooldownMs: 15000,
  });
}

// ============================================================
// MAIN APPLICATION FLOW
// ============================================================

/**
 * Main application entry point
 * Initializes all components and starts the interview automation
 * 
 * @async
 * @returns {Promise<void>}
 */
async function main() {
  const logger = initializeLogger();
  
  // Display startup banner
  logger.info('═══════════════════════════════════════════');
  logger.info('   Interview Bot Starting');
  logger.info('═══════════════════════════════════════════');
  logger.info(`Interview URL: ${config.interview.url || '<not set>'}`);
  logger.info(`Timeout: ${config.interview.timeoutSeconds} seconds`);
  logger.info(`Log Level: ${config.logLevel}`);
  
  try {
    // Validate configuration
    validateConfig(config);
    
    // Initialize health server
    state.healthServer = await initializeHealthServer(logger);
    
    // Set up auto-shutdown timeout
    setupTimeout(logger);
    
    // Initialize browser
    const { browser, page } = await initializeBrowser(logger);
    state.browser = browser;
    state.page = page;
    
    // Set up audio devices
    logger.info('Setting up audio devices...');
    await setupAudioDevices(page, config.interview.url, { logger });
    
    // Navigate to interview
    logger.info(`Navigating to interview: ${config.interview.url}`);
    await navigateToInterview(page, config.interview.url, { logger });
    
    // Initialize LLM client (experimental, not actively used in current flow)
    state.llmClient = initializeLLMClient(logger);
    
    // Initialize conversation manager
    state.conversation = initializeConversation(state.llmClient, logger);
    
    // Inject automation script
    logger.info('Injecting automation script...');
    await injectAutomation(page, {
      password: config.interview.password,
      geminiApiKey: config.gemini.apiKey,
      conversation: state.conversation,
      logger,
    });
    
    // Mark as healthy and ready
    state.healthServer.setReady(true);
    logger.info('═══════════════════════════════════════════');
    logger.info('   ✓ Interview bot is running');
    logger.info('═══════════════════════════════════════════');
    
    // Wait for completion
    await waitForCompletion(logger);
    
  } catch (error) {
    logger.error('Fatal error:', error.message);
    logger.debug(error.stack);
    process.exitCode = 1;
  } finally {
    await cleanup(logger);
  }
}

/**
 * Sets up the auto-shutdown timeout
 * 
 * @private
 * @param {Object} logger - Logger instance
 */
function setupTimeout(logger) {
  state.timeoutId = setTimeout(() => {
    logger.warn(`Interview timeout reached (${config.interview.timeoutSeconds}s), shutting down...`);
    process.exit(0);
  }, config.interview.timeoutSeconds * 1000);
}

/**
 * Waits for the interview to complete or browser to close
 * 
 * @private
 * @async
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
async function waitForCompletion(logger) {
  return new Promise((resolve) => {
    // Handle page close
    if (state.page) {
      state.page.on('close', () => {
        logger.info('Page closed');
        resolve();
      });
    }
    
    // Handle browser disconnect
    if (state.browser) {
      state.browser.on('disconnected', () => {
        logger.info('Browser disconnected');
        resolve();
      });
    }
  });
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Cleans up all resources and shuts down gracefully
 * 
 * @private
 * @async
 * @param {Object} [logger=console] - Logger instance
 * @returns {Promise<void>}
 */
async function cleanup(logger = console) {
  if (state.isShuttingDown) {
    return;
  }
  
  state.isShuttingDown = true;
  logger.info('Cleaning up...');
  
  // Mark as unhealthy
  if (state.healthServer) {
    state.healthServer.setReady(false);
  }
  
  // Clear timeout
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
  
  // Close LLM client
  if (state.llmClient) {
    try {
      state.llmClient.close();
    } catch (error) {
      logger.debug('Error closing LLM client:', error.message);
    }
    state.llmClient = null;
  }
  
  // Close browser
  if (state.browser) {
    try {
      await closeBrowser(state.browser);
    } catch (error) {
      logger.debug('Error closing browser:', error.message);
    }
    state.browser = null;
    state.page = null;
  }
  
  // Stop health server
  if (state.healthServer) {
    await state.healthServer.stop();
    state.healthServer = null;
  }
  
  logger.info('Cleanup complete');
}

// ============================================================
// SIGNAL HANDLERS
// ============================================================

/**
 * Handles graceful shutdown on SIGTERM signal
 */
process.on('SIGTERM', () => {
  console.log('[INFO] Received SIGTERM, shutting down...');
  process.exit(0);
});

/**
 * Handles graceful shutdown on SIGINT signal (Ctrl+C)
 */
process.on('SIGINT', () => {
  console.log('[INFO] Received SIGINT, shutting down...');
  process.exit(0);
});

/**
 * Handles uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught exception:', error.message);
  console.error(error.stack);
  process.exit(1);
});

/**
 * Handles unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled rejection:', reason);
  process.exit(1);
});

// ============================================================
// APPLICATION STARTUP
// ============================================================

// Start the application
main().catch((error) => {
  console.error('[ERROR] Main process error:', error.message);
  process.exit(1);
});

// ============================================================
// MODULE EXPORTS (for testing)
// ============================================================

module.exports = {
  main,
  cleanup,
  state,
};
