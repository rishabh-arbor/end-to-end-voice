/**
 * Configuration Module
 * 
 * @module config
 * @description Centralizes all configuration management following the Single Responsibility Principle.
 *              Handles environment variables, validation, and default values.
 * 
 * @example
 * const config = require('./config');
 * console.log(config.interview.url);
 * console.log(config.gemini.apiKey);
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Only handles configuration
 * - Open/Closed: Easy to extend with new config sections
 * - Dependency Inversion: Other modules depend on this abstraction, not process.env directly
 */

'use strict';

/**
 * @typedef {Object} InterviewConfig
 * @property {string} url - The interview URL to automate
 * @property {string} password - Optional password for the interview
 * @property {number} timeoutSeconds - Maximum duration before auto-shutdown
 */

/**
 * @typedef {Object} GeminiConfig
 * @property {string} apiKey - Gemini API key for LLM access
 * @property {string} model - Gemini model to use
 * @property {string} voiceName - Voice for TTS output
 */

/**
 * @typedef {Object} AudioConfig
 * @property {number} sampleRate - Input audio sample rate (Hz)
 * @property {number} ttsSampleRate - TTS output sample rate (Hz)
 * @property {number} chunkDurationMs - Audio chunk duration for streaming
 */

/**
 * @typedef {Object} AppConfig
 * @property {InterviewConfig} interview - Interview-related settings
 * @property {GeminiConfig} gemini - Gemini API settings
 * @property {AudioConfig} audio - Audio processing settings
 * @property {string} logLevel - Logging verbosity (debug|info|warn|error)
 * @property {number} healthPort - Health check server port
 */

/**
 * Validates required environment variables
 * @private
 * @param {string[]} required - List of required variable names
 * @throws {Error} If any required variable is missing
 */
function validateRequired(required) {
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Parses an integer from environment variable with fallback
 * @private
 * @param {string} value - Environment variable value
 * @param {number} defaultValue - Default if parsing fails
 * @returns {number} Parsed integer or default
 */
function parseIntEnv(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Builds the application configuration from environment variables
 * @returns {AppConfig} Complete application configuration
 */
function buildConfig() {
  return {
    /**
     * Interview configuration
     * @type {InterviewConfig}
     */
    interview: {
      url: process.env.INTERVIEW_URL || '',
      password: process.env.INTERVIEW_PASSWORD || '',
      timeoutSeconds: parseIntEnv(process.env.TIMEOUT_SECONDS, 1800),
    },
    
    /**
     * Gemini API configuration
     * @type {GeminiConfig}
     */
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'models/gemini-2.0-flash-live-001',
      voiceName: process.env.GEMINI_VOICE || 'Puck',
    },
    
    /**
     * Audio processing configuration
     * @type {AudioConfig}
     */
    audio: {
      sampleRate: parseIntEnv(process.env.AUDIO_SAMPLE_RATE, 16000),
      ttsSampleRate: parseIntEnv(process.env.TTS_SAMPLE_RATE, 24000),
      chunkDurationMs: parseIntEnv(process.env.AUDIO_CHUNK_DURATION_MS, 100),
    },
    
    /**
     * General application settings
     */
    logLevel: process.env.LOG_LEVEL || 'info',
    healthPort: parseIntEnv(process.env.HEALTH_PORT, 3000),
    
    /**
     * PulseAudio configuration
     */
    pulseAudio: {
      server: process.env.PULSE_SERVER || 'unix:/run/pulse/native',
      runtimeDir: process.env.XDG_RUNTIME_DIR || '/run/pulse',
    },
  };
}

/**
 * Validates the configuration for required values
 * @param {AppConfig} config - Configuration to validate
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config) {
  const errors = [];
  
  if (!config.interview.url) {
    errors.push('INTERVIEW_URL is required');
  }
  
  if (!config.gemini.apiKey) {
    errors.push('GEMINI_API_KEY is required');
  }
  
  if (config.interview.timeoutSeconds < 60) {
    errors.push('TIMEOUT_SECONDS must be at least 60');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Creates a frozen (immutable) configuration object
 * @returns {Readonly<AppConfig>} Immutable configuration
 */
function createConfig() {
  const config = buildConfig();
  
  // Deep freeze to prevent modifications
  Object.freeze(config);
  Object.freeze(config.interview);
  Object.freeze(config.gemini);
  Object.freeze(config.audio);
  Object.freeze(config.pulseAudio);
  
  return config;
}

// Export singleton configuration
const config = createConfig();

module.exports = {
  config,
  validateConfig,
  buildConfig,
  
  // Export types for documentation
  /** @type {InterviewConfig} */
  InterviewConfig: null,
  /** @type {GeminiConfig} */
  GeminiConfig: null,
  /** @type {AudioConfig} */
  AudioConfig: null,
  /** @type {AppConfig} */
  AppConfig: null,
};

