/**
 * Health Check Server Module
 * 
 * @module services/health-server
 * @description Provides a lightweight HTTP server for health checks and readiness probes.
 *              Used by container orchestrators (Docker, Kubernetes) to monitor service status.
 * 
 * @example
 * const { createHealthServer } = require('./services/health-server');
 * 
 * const healthServer = createHealthServer({ port: 3000 });
 * healthServer.start();
 * 
 * // Later, when the app is ready
 * healthServer.setReady(true);
 * 
 * // Shutdown
 * healthServer.stop();
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Only handles health check endpoints
 * - Open/Closed: Can add new endpoints without modifying existing code
 * - Dependency Inversion: Logger injected as dependency
 */

'use strict';

const http = require('http');

/**
 * @typedef {Object} HealthServerOptions
 * @property {number} [port=3000] - Port to listen on
 * @property {Object} [logger=console] - Logger instance
 * @property {Object} [metadata={}] - Additional metadata to include in health response
 */

/**
 * @typedef {Object} HealthResponse
 * @property {'ok'|'starting'|'unhealthy'} status - Health status
 * @property {string} timestamp - ISO timestamp
 * @property {number} uptime - Server uptime in seconds
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} HealthServer
 * @property {Function} start - Start the server
 * @property {Function} stop - Stop the server
 * @property {Function} setReady - Set the ready state
 * @property {Function} isReady - Check if server is ready
 */

/**
 * Creates a new health check server instance
 * 
 * @param {HealthServerOptions} [options={}] - Server configuration
 * @returns {HealthServer} Health server instance
 * 
 * @example
 * const server = createHealthServer({ port: 3000 });
 * server.start();
 */
function createHealthServer(options = {}) {
  const {
    port = 3000,
    logger = console,
    metadata = {},
  } = options;
  
  /**
   * Server ready state
   * @type {boolean}
   */
  let isServerReady = false;
  
  /**
   * HTTP server instance
   * @type {http.Server|null}
   */
  let server = null;
  
  /**
   * Server start timestamp
   * @type {number}
   */
  const startTime = Date.now();
  
  /**
   * Builds the health response object
   * 
   * @private
   * @returns {HealthResponse} Health response object
   */
  function buildHealthResponse() {
    return {
      status: isServerReady ? 'ok' : 'starting',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      ...(Object.keys(metadata).length > 0 && { metadata }),
    };
  }
  
  /**
   * Handles incoming HTTP requests
   * 
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  function handleRequest(req, res) {
    // Set CORS headers for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    switch (req.url) {
      case '/health':
      case '/healthz':
        handleHealthCheck(req, res);
        break;
        
      case '/ready':
      case '/readiness':
        handleReadinessCheck(req, res);
        break;
        
      case '/live':
      case '/liveness':
        handleLivenessCheck(req, res);
        break;
        
      default:
        handleNotFound(req, res);
    }
  }
  
  /**
   * Handles health check endpoint
   * Returns 200 if ready, 503 if still starting
   * 
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  function handleHealthCheck(req, res) {
    const response = buildHealthResponse();
    const statusCode = isServerReady ? 200 : 503;
    
    res.writeHead(statusCode);
    res.end(JSON.stringify(response, null, 2));
  }
  
  /**
   * Handles readiness check endpoint
   * Returns 200 only if the service is ready to accept traffic
   * 
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  function handleReadinessCheck(req, res) {
    const statusCode = isServerReady ? 200 : 503;
    res.writeHead(statusCode);
    res.end(JSON.stringify({
      ready: isServerReady,
      timestamp: new Date().toISOString(),
    }));
  }
  
  /**
   * Handles liveness check endpoint
   * Returns 200 if the server is running (regardless of ready state)
   * 
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  function handleLivenessCheck(req, res) {
    res.writeHead(200);
    res.end(JSON.stringify({
      alive: true,
      timestamp: new Date().toISOString(),
    }));
  }
  
  /**
   * Handles 404 Not Found
   * 
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  function handleNotFound(req, res) {
    res.writeHead(404);
    res.end(JSON.stringify({
      error: 'Not Found',
      path: req.url,
      availableEndpoints: ['/health', '/ready', '/live'],
    }));
  }
  
  // ============================================================
  // PUBLIC API
  // ============================================================
  
  /**
   * Starts the health check server
   * 
   * @returns {Promise<void>} Resolves when server is listening
   * 
   * @example
   * await healthServer.start();
   * console.log('Health server running');
   */
  function start() {
    return new Promise((resolve, reject) => {
      if (server) {
        logger.warn('[health] Server already running');
        resolve();
        return;
      }
      
      server = http.createServer(handleRequest);
      
      server.on('error', (error) => {
        logger.error('[health] Server error:', error.message);
        reject(error);
      });
      
      server.listen(port, () => {
        logger.info(`[health] Health check server listening on port ${port}`);
        logger.info(`[health] Endpoints: /health, /ready, /live`);
        resolve();
      });
    });
  }
  
  /**
   * Stops the health check server gracefully
   * 
   * @returns {Promise<void>} Resolves when server is closed
   * 
   * @example
   * await healthServer.stop();
   * console.log('Health server stopped');
   */
  function stop() {
    return new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      
      server.close((error) => {
        if (error) {
          logger.debug('[health] Error closing server:', error.message);
        }
        server = null;
        logger.info('[health] Health server stopped');
        resolve();
      });
    });
  }
  
  /**
   * Sets the ready state of the server
   * When ready is true, /health and /ready will return 200
   * 
   * @param {boolean} ready - New ready state
   * 
   * @example
   * // Application is ready to serve traffic
   * healthServer.setReady(true);
   * 
   * // Application is shutting down
   * healthServer.setReady(false);
   */
  function setReady(ready) {
    isServerReady = Boolean(ready);
    logger.debug(`[health] Ready state: ${isServerReady}`);
  }
  
  /**
   * Checks if the server is in ready state
   * 
   * @returns {boolean} Current ready state
   * 
   * @example
   * if (healthServer.isReady()) {
   *   console.log('Server is ready');
   * }
   */
  function isReady() {
    return isServerReady;
  }
  
  // ============================================================
  // RETURN PUBLIC API
  // ============================================================
  
  return {
    start,
    stop,
    setReady,
    isReady,
  };
}

module.exports = {
  createHealthServer,
};

