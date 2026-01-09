/**
 * Utilities Module Index
 * 
 * @module utils
 * @description Re-exports all utility modules for convenient importing.
 * 
 * @example
 * const { createLogger, defaultLogger } = require('./utils');
 */

'use strict';

const logger = require('./logger');

module.exports = {
  ...logger,
};

