/**
 * Logger Module
 * 
 * @module utils/logger
 * @description Provides a configurable logging abstraction following SOLID principles.
 *              Implements the Dependency Inversion Principle by providing an interface
 *              that other modules depend on, rather than directly using console.
 * 
 * @example
 * const { createLogger } = require('./utils/logger');
 * const logger = createLogger({ level: 'debug', prefix: 'MyModule' });
 * logger.info('Application started');
 * logger.debug('Debug details:', { foo: 'bar' });
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Only handles logging
 * - Open/Closed: Easy to extend with new log levels or transports
 * - Interface Segregation: Simple interface (debug, info, warn, error)
 * - Dependency Inversion: Modules depend on logger interface, not console
 */

'use strict';

/**
 * Log levels in order of severity
 * @readonly
 * @enum {number}
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

/**
 * Maps string log level to numeric value
 * @private
 * @param {string} level - Log level string
 * @returns {number} Numeric log level
 */
function parseLogLevel(level) {
  const normalized = (level || 'info').toUpperCase();
  return LogLevel[normalized] ?? LogLevel.INFO;
}

/**
 * @typedef {Object} LoggerOptions
 * @property {string} [level='info'] - Minimum log level to output
 * @property {string} [prefix=''] - Prefix for all log messages
 * @property {boolean} [timestamps=true] - Include timestamps in output
 * @property {boolean} [colors=true] - Use ANSI colors in output
 */

/**
 * @typedef {Object} Logger
 * @property {Function} debug - Log debug message
 * @property {Function} info - Log info message
 * @property {Function} warn - Log warning message
 * @property {Function} error - Log error message
 * @property {Function} child - Create child logger with additional prefix
 */

/**
 * ANSI color codes for terminal output
 * @private
 */
const Colors = {
  RESET: '\x1b[0m',
  DIM: '\x1b[2m',
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
};

/**
 * Formats a timestamp for log output
 * @private
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Creates a new logger instance
 * 
 * @param {LoggerOptions} [options={}] - Logger configuration
 * @returns {Logger} Logger instance
 * 
 * @example
 * // Basic usage
 * const logger = createLogger({ level: 'info' });
 * logger.info('Hello world');
 * 
 * @example
 * // With prefix
 * const logger = createLogger({ level: 'debug', prefix: '[Browser]' });
 * logger.debug('Launching browser...');
 */
function createLogger(options = {}) {
  const {
    level = 'info',
    prefix = '',
    timestamps = true,
    colors = process.stdout.isTTY !== false,
  } = options;
  
  const minLevel = parseLogLevel(level);
  
  /**
   * Formats and outputs a log message
   * @private
   * @param {number} msgLevel - Message log level
   * @param {string} levelName - Level name for display
   * @param {string} color - ANSI color code
   * @param {any[]} args - Message arguments
   */
  function log(msgLevel, levelName, color, args) {
    if (msgLevel < minLevel) return;
    
    const parts = [];
    
    // Add timestamp
    if (timestamps) {
      parts.push(colors ? `${Colors.DIM}${getTimestamp()}${Colors.RESET}` : getTimestamp());
    }
    
    // Add level
    const levelStr = `[${levelName}]`;
    parts.push(colors ? `${color}${levelStr}${Colors.RESET}` : levelStr);
    
    // Add prefix
    if (prefix) {
      parts.push(prefix);
    }
    
    // Determine output function
    const outputFn = msgLevel >= LogLevel.ERROR ? console.error :
                     msgLevel >= LogLevel.WARN ? console.warn :
                     console.log;
    
    outputFn(...parts, ...args);
  }
  
  /**
   * Logger instance
   * @type {Logger}
   */
  const logger = {
    /**
     * Log a debug message (only shown when level is 'debug')
     * @param {...any} args - Message arguments
     */
    debug: (...args) => log(LogLevel.DEBUG, 'DEBUG', Colors.CYAN, args),
    
    /**
     * Log an info message
     * @param {...any} args - Message arguments
     */
    info: (...args) => log(LogLevel.INFO, 'INFO', Colors.GREEN, args),
    
    /**
     * Log a warning message
     * @param {...any} args - Message arguments
     */
    warn: (...args) => log(LogLevel.WARN, 'WARN', Colors.YELLOW, args),
    
    /**
     * Log an error message
     * @param {...any} args - Message arguments
     */
    error: (...args) => log(LogLevel.ERROR, 'ERROR', Colors.RED, args),
    
    /**
     * Create a child logger with an additional prefix
     * @param {string} childPrefix - Additional prefix for child logger
     * @returns {Logger} Child logger instance
     * 
     * @example
     * const parentLogger = createLogger({ prefix: '[App]' });
     * const childLogger = parentLogger.child('[Browser]');
     * childLogger.info('Message'); // Outputs: [App] [Browser] Message
     */
    child: (childPrefix) => createLogger({
      level,
      prefix: prefix ? `${prefix} ${childPrefix}` : childPrefix,
      timestamps,
      colors,
    }),
    
    /**
     * Get the current log level
     * @returns {string} Current log level name
     */
    getLevel: () => level,
  };
  
  return logger;
}

/**
 * Default logger instance using environment configuration
 * @type {Logger}
 */
const defaultLogger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
});

module.exports = {
  createLogger,
  defaultLogger,
  LogLevel,
  
  // Re-export for convenience
  debug: defaultLogger.debug,
  info: defaultLogger.info,
  warn: defaultLogger.warn,
  error: defaultLogger.error,
};

