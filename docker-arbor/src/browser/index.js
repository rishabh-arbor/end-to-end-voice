/**
 * Browser Module Index
 * 
 * Exports all browser-related functionality
 */

const { launchBrowser, closeBrowser, DEFAULT_OPTIONS } = require('./puppeteer-launcher');
const { navigateToInterview, setupAudioDevices, injectAutomation } = require('./page-controller');

module.exports = {
  launchBrowser,
  closeBrowser,
  DEFAULT_OPTIONS,
  navigateToInterview,
  setupAudioDevices,
  injectAutomation,
};

