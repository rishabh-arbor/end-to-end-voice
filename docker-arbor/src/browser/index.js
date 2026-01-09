/**
 * Browser Module Index
 * 
 * @module browser
 * @description Re-exports all browser-related modules for convenient importing.
 *              Provides unified access to browser launching, page control, and automation.
 * 
 * @example
 * const { launchBrowser, navigateToInterview, injectAutomation } = require('./browser');
 * 
 * const browser = await launchBrowser();
 * const page = await browser.newPage();
 * await navigateToInterview(page, url);
 */

'use strict';

const puppeteerLauncher = require('./puppeteer-launcher');
const pageController = require('./page-controller');

module.exports = {
  // From puppeteer-launcher
  launchBrowser: puppeteerLauncher.launchBrowser,
  closeBrowser: puppeteerLauncher.closeBrowser,
  DEFAULT_OPTIONS: puppeteerLauncher.DEFAULT_OPTIONS,
  
  // From page-controller
  navigateToInterview: pageController.navigateToInterview,
  setupAudioDevices: pageController.setupAudioDevices,
  injectAutomation: pageController.injectAutomation,
};
