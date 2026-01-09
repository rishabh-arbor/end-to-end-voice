/**
 * LLM Client Module
 * 
 * @module llm/client
 * @description Handles WebSocket connection to Gemini Live API for real-time
 *              speech-to-speech conversation. Implements a robust connection
 *              management system with automatic reconnection.
 * 
 * @example
 * const { createLLMClient } = require('./llm/client');
 * 
 * const client = createLLMClient({
 *   apiKey: 'your-api-key',
 *   model: 'models/gemini-2.0-flash-live-001',
 *   voiceName: 'Puck',
 * });
 * 
 * client.on('transcription', (text, type) => console.log('Heard:', text));
 * client.on('audio', (base64Audio, sampleRate) => playAudio(base64Audio));
 * 
 * await client.connect();
 * client.sendAudio(base64PCM, 16000);
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Only handles LLM WebSocket communication
 * - Open/Closed: Event handlers allow extension without modification
 * - Interface Segregation: Clean public API (connect, send*, close, on)
 * - Dependency Inversion: Logger injected as dependency
 */

'use strict';

const WebSocket = require('ws');

/**
 * Gemini WebSocket API endpoint for bidirectional streaming
 * @constant {string}
 */
const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

/**
 * Default configuration values
 * @constant {Object}
 */
const DEFAULTS = {
  MODEL: 'models/gemini-2.0-flash-live-001',
  VOICE_NAME: 'Puck',
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY_MS: 3000,
  TTS_SAMPLE_RATE: 24000,
};

/**
 * @typedef {Object} LLMClientOptions
 * @property {string} apiKey - Required. Gemini API key
 * @property {string} [model='models/gemini-2.0-flash-live-001'] - Gemini model identifier
 * @property {string} [voiceName='Puck'] - Voice for TTS responses
 * @property {Object} [logger=console] - Logger instance for output
 * @property {number} [maxReconnectAttempts=5] - Maximum reconnection attempts
 * @property {number} [reconnectDelayMs=3000] - Delay between reconnection attempts
 */

/**
 * @typedef {Object} LLMClient
 * @property {Function} connect - Establish WebSocket connection
 * @property {Function} sendAudio - Send audio data for transcription
 * @property {Function} sendText - Send text message to LLM
 * @property {Function} speak - Request TTS for given text
 * @property {Function} close - Close the connection
 * @property {Function} on - Register event handler
 * @property {Function} isReady - Check if client is ready
 */

/**
 * Supported event types for the LLM client
 * @readonly
 * @enum {string}
 */
const EventType = {
  /** Fired when transcription is received (input or output) */
  TRANSCRIPTION: 'transcription',
  /** Fired when audio response is received */
  AUDIO: 'audio',
  /** Fired when text response is received */
  TEXT: 'text',
  /** Fired on WebSocket error */
  ERROR: 'error',
  /** Fired when connection is ready */
  READY: 'ready',
};

/**
 * Creates a new LLM client instance
 * 
 * @param {LLMClientOptions} options - Client configuration
 * @returns {LLMClient} LLM client instance
 * @throws {Error} If apiKey is not provided
 * 
 * @example
 * const client = createLLMClient({
 *   apiKey: process.env.GEMINI_API_KEY,
 *   logger: myLogger,
 * });
 */
function createLLMClient(options = {}) {
  // ============================================================
  // CONFIGURATION & STATE
  // ============================================================
  
  const {
    apiKey,
    model = DEFAULTS.MODEL,
    voiceName = DEFAULTS.VOICE_NAME,
    logger = console,
    maxReconnectAttempts = DEFAULTS.MAX_RECONNECT_ATTEMPTS,
    reconnectDelayMs = DEFAULTS.RECONNECT_DELAY_MS,
  } = options;
  
  // Validate required options
  if (!apiKey) {
    throw new Error('LLMClient: apiKey is required');
  }
  
  /** @type {WebSocket|null} */
  let ws = null;
  
  /** @type {boolean} */
  let isReady = false;
  
  /** @type {boolean} */
  let isConnecting = false;
  
  /** @type {number} */
  let reconnectAttempts = 0;
  
  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  
  /**
   * Event handler storage
   * @private
   * @type {Object.<string, Function|null>}
   */
  const handlers = {
    [EventType.TRANSCRIPTION]: null,
    [EventType.AUDIO]: null,
    [EventType.TEXT]: null,
    [EventType.ERROR]: null,
    [EventType.READY]: null,
  };
  
  /**
   * Safely invokes an event handler if registered
   * @private
   * @param {string} eventType - Event type from EventType enum
   * @param {...any} args - Arguments to pass to handler
   */
  function emit(eventType, ...args) {
    const handler = handlers[eventType];
    if (typeof handler === 'function') {
      try {
        handler(...args);
      } catch (error) {
        logger.error(`[llm] Event handler error for '${eventType}':`, error.message);
      }
    }
  }
  
  // ============================================================
  // CONNECTION MANAGEMENT
  // ============================================================
  
  /**
   * Establishes WebSocket connection to Gemini API
   * 
   * @async
   * @returns {Promise<void>} Resolves when connection is ready
   * @throws {Error} If connection fails
   * 
   * @example
   * await client.connect();
   * console.log('Connected and ready');
   */
  async function connect() {
    // Prevent duplicate connections
    if (ws && ws.readyState === WebSocket.OPEN) {
      logger.debug('[llm] Already connected');
      return;
    }
    
    if (isConnecting) {
      logger.debug('[llm] Connection in progress');
      return;
    }
    
    isConnecting = true;
    
    const url = `${GEMINI_WS_URL}?key=${encodeURIComponent(apiKey)}`;
    
    return new Promise((resolve, reject) => {
      logger.info('[llm] Connecting to Gemini...');
      
      ws = new WebSocket(url);
      
      ws.on('open', handleOpen);
      ws.on('message', (data) => handleMessage(data, resolve));
      ws.on('error', (error) => handleError(error, reject));
      ws.on('close', handleClose);
    });
  }
  
  /**
   * Handles WebSocket open event
   * @private
   */
  function handleOpen() {
    logger.info('[llm] WebSocket connected');
    sendSetupMessage();
  }
  
  /**
   * Sends the initial setup message to configure the session
   * @private
   */
  function sendSetupMessage() {
    const setupMessage = {
      setup: {
        model: model,
        generation_config: {
          response_modalities: ['AUDIO', 'TEXT'],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: voiceName,
              },
            },
          },
        },
        // Enable input audio transcription for STT
        input_audio_transcription: {},
      },
    };
    
    ws.send(JSON.stringify(setupMessage));
    logger.debug('[llm] Setup message sent');
  }
  
  /**
   * Handles WebSocket error event
   * @private
   * @param {Error} error - WebSocket error
   * @param {Function} [reject] - Promise reject function
   */
  function handleError(error, reject) {
    logger.error('[llm] WebSocket error:', error.message);
    emit(EventType.ERROR, error);
    
    if (isConnecting && reject) {
      isConnecting = false;
      reject(error);
    }
  }
  
  /**
   * Handles WebSocket close event
   * @private
   * @param {number} code - Close code
   * @param {Buffer} reason - Close reason
   */
  function handleClose(code, reason) {
    logger.info('[llm] WebSocket closed:', code, reason?.toString());
    isReady = false;
    isConnecting = false;
    
    // Attempt reconnection if not intentionally closed
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      logger.info(`[llm] Reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
      setTimeout(connect, reconnectDelayMs);
    }
  }
  
  // ============================================================
  // MESSAGE HANDLING
  // ============================================================
  
  /**
   * Handles incoming WebSocket messages
   * @private
   * @param {Buffer} data - Raw message data
   * @param {Function} [resolve] - Promise resolve function for connection
   */
  function handleMessage(data, resolve) {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle setup completion
      if (message.setupComplete) {
        handleSetupComplete(resolve);
        return;
      }
      
      // Handle server content
      if (message.serverContent) {
        handleServerContent(message.serverContent);
      }
      
    } catch (error) {
      logger.error('[llm] Failed to parse message:', error.message);
    }
  }
  
  /**
   * Handles setup completion message
   * @private
   * @param {Function} [resolve] - Promise resolve function
   */
  function handleSetupComplete(resolve) {
    isReady = true;
    logger.info('[llm] ✓ Setup complete, ready for conversation');
    emit(EventType.READY);
    
    if (isConnecting && resolve) {
      isConnecting = false;
      reconnectAttempts = 0;
      resolve();
    }
  }
  
  /**
   * Handles server content messages (transcriptions, responses)
   * @private
   * @param {Object} serverContent - Server content object
   */
  function handleServerContent(serverContent) {
    // Input transcription (what the user said)
    if (serverContent.inputTranscription) {
      const text = serverContent.inputTranscription.text || 
                   serverContent.inputTranscription.transcript || '';
      if (text) {
        emit(EventType.TRANSCRIPTION, text, 'input');
      }
    }
    
    // Model response (turn)
    if (serverContent.modelTurn) {
      handleModelTurn(serverContent.modelTurn);
    }
    
    // Output transcription (what the model said)
    if (serverContent.outputTranscription) {
      const text = serverContent.outputTranscription.text || 
                   serverContent.outputTranscription.transcript || '';
      if (text) {
        emit(EventType.TRANSCRIPTION, text, 'output');
      }
    }
  }
  
  /**
   * Handles model turn content (audio/text responses)
   * @private
   * @param {Object} modelTurn - Model turn object
   */
  function handleModelTurn(modelTurn) {
    const parts = modelTurn.parts || [];
    
    for (const part of parts) {
      // Audio response
      if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
        emit(EventType.AUDIO, part.inlineData.data, DEFAULTS.TTS_SAMPLE_RATE);
      }
      
      // Text response
      if (part.text) {
        emit(EventType.TEXT, part.text);
      }
    }
  }
  
  // ============================================================
  // PUBLIC METHODS - SENDING DATA
  // ============================================================
  
  /**
   * Sends audio data to the LLM for transcription and processing
   * 
   * @param {string} base64Audio - Base64 encoded PCM audio data
   * @param {number} [sampleRate=16000] - Audio sample rate in Hz
   * @returns {boolean} True if sent successfully, false otherwise
   * 
   * @example
   * const success = client.sendAudio(base64PCM, 16000);
   * if (!success) {
   *   console.log('Client not ready');
   * }
   */
  function sendAudio(base64Audio, sampleRate = 16000) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !isReady) {
      logger.debug('[llm] Not ready to send audio');
      return false;
    }
    
    const message = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: `audio/pcm;rate=${sampleRate}`,
          data: base64Audio,
        }],
      },
    };
    
    ws.send(JSON.stringify(message));
    return true;
  }
  
  /**
   * Sends a text message to the LLM
   * 
   * @param {string} text - Text message to send
   * @returns {boolean} True if sent successfully, false otherwise
   * 
   * @example
   * client.sendText('What is the weather like?');
   */
  function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !isReady) {
      logger.debug('[llm] Not ready to send text');
      return false;
    }
    
    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }],
        }],
        turnComplete: true,
      },
    };
    
    ws.send(JSON.stringify(message));
    return true;
  }
  
  /**
   * Requests the LLM to speak the given text (TTS)
   * 
   * @param {string} text - Text to convert to speech
   * @returns {boolean} True if request sent successfully
   * 
   * @example
   * client.speak('Hello, how can I help you today?');
   */
  function speak(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !isReady) {
      logger.debug('[llm] Not ready to speak');
      return false;
    }
    
    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text: `Please say the following out loud: ${text}` }],
        }],
        turnComplete: true,
      },
    };
    
    ws.send(JSON.stringify(message));
    return true;
  }
  
  // ============================================================
  // PUBLIC METHODS - LIFECYCLE
  // ============================================================
  
  /**
   * Closes the WebSocket connection gracefully
   * Prevents automatic reconnection after close
   * 
   * @example
   * client.close();
   * console.log('Connection closed');
   */
  function close() {
    // Prevent reconnection attempts
    reconnectAttempts = maxReconnectAttempts;
    
    if (ws) {
      ws.close();
      ws = null;
    }
    
    isReady = false;
    isConnecting = false;
    logger.info('[llm] Connection closed');
  }
  
  /**
   * Registers an event handler for the specified event type
   * 
   * @param {string} event - Event type (transcription|audio|text|error|ready)
   * @param {Function} handler - Event handler function
   * 
   * @example
   * // Handle transcriptions
   * client.on('transcription', (text, type) => {
   *   console.log(`[${type}] ${text}`);
   * });
   * 
   * // Handle audio responses
   * client.on('audio', (base64Audio, sampleRate) => {
   *   playAudio(base64Audio, sampleRate);
   * });
   * 
   * // Handle errors
   * client.on('error', (error) => {
   *   console.error('LLM error:', error);
   * });
   */
  function on(event, handler) {
    if (event in handlers) {
      handlers[event] = handler;
    } else {
      logger.warn(`[llm] Unknown event type: ${event}`);
    }
  }
  
  /**
   * Checks if the client is ready to send/receive data
   * 
   * @returns {boolean} True if connected and setup complete
   * 
   * @example
   * if (client.isReady()) {
   *   client.sendAudio(audioData, 16000);
   * }
   */
  function isClientReady() {
    return isReady;
  }
  
  // ============================================================
  // RETURN PUBLIC API
  // ============================================================
  
  return {
    connect,
    sendAudio,
    sendText,
    speak,
    close,
    on,
    isReady: isClientReady,
  };
}

module.exports = {
  createLLMClient,
  EventType,
  DEFAULTS,
};
