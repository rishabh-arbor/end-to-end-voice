/**
 * Services Module Index
 * 
 * @module services
 * @description Re-exports all service modules for convenient importing.
 * 
 * @example
 * const { createHealthServer } = require('./services');
 */

'use strict';

const healthServer = require('./health-server');

module.exports = {
  ...healthServer,
};

