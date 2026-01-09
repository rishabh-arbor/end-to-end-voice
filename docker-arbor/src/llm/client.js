/**
 * LLM Client Module
 * 
 * Handles WebSocket connection to Gemini Live API for real-time
 * speech-to-speech conversation
 */

const WebSocket = require('ws');

const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

/**
 * Create a new LLM client
 * @param {object} options
 * @returns {object} LLM client instance
 */
function createLLMClient(options = {}) {
  const {
    apiKey,
    model = 'models/gemini-2.0-flash-exp',
    voiceName = 'Puck',
    logger = console,
  } = options;
  
  if (!apiKey) {
    throw new Error('API key is required');
  }
  
  let ws = null;
  let isReady = false;
  let isConnecting = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY_MS = 3000;
  
  // Event handlers
  let onTranscription = null;
  let onAudioResponse = null;
  let onTextResponse = null;
  let onError = null;
  let onReady = null;
  
  /**
   * Connect to the Gemini WebSocket API
   */
  async function connect() {
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
      
      ws.on('open', () => {
        logger.info('[llm] WebSocket connected');
        
        // Send setup message
        const setupMessage = {
          setup: {
            model: model,
            generation_config: {
              response_modalities: ['AUDIO', 'TEXT'],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voice_name: voiceName
                  }
                }
              }
            },
            // Enable input audio transcription
            input_audio_transcription: {},
          }
        };
        
        ws.send(JSON.stringify(setupMessage));
        logger.debug('[llm] Setup message sent');
      });
      
      ws.on('message', (data) => {
        handleMessage(data);
        
        // Resolve connection promise on setup complete
        if (isReady && isConnecting) {
          isConnecting = false;
          reconnectAttempts = 0;
          resolve();
        }
      });
      
      ws.on('error', (error) => {
        logger.error('[llm] WebSocket error:', error.message);
        if (onError) onError(error);
        
        if (isConnecting) {
          isConnecting = false;
          reject(error);
        }
      });
      
      ws.on('close', (code, reason) => {
        logger.info('[llm] WebSocket closed:', code, reason?.toString());
        isReady = false;
        isConnecting = false;
        
        // Attempt reconnection
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          logger.info(`[llm] Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    });
  }
  
  /**
   * Handle incoming WebSocket message
   */
  function handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      // Setup complete
      if (message.setupComplete) {
        isReady = true;
        logger.info('[llm] ✓ Setup complete, ready for conversation');
        if (onReady) onReady();
        return;
      }
      
      // Handle server content
      if (message.serverContent) {
        const serverContent = message.serverContent;
        
        // Input transcription (what the user said)
        if (serverContent.inputTranscription) {
          const text = serverContent.inputTranscription.text || 
                      serverContent.inputTranscription.transcript || '';
          if (text && onTranscription) {
            onTranscription(text, 'input');
          }
        }
        
        // Model response
        if (serverContent.modelTurn) {
          const parts = serverContent.modelTurn.parts || [];
          
          for (const part of parts) {
            // Audio response
            if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
              if (onAudioResponse) {
                onAudioResponse(part.inlineData.data, 24000);
              }
            }
            
            // Text response
            if (part.text) {
              if (onTextResponse) {
                onTextResponse(part.text);
              }
            }
          }
        }
        
        // Output transcription (what the model said)
        if (serverContent.outputTranscription) {
          const text = serverContent.outputTranscription.text || 
                      serverContent.outputTranscription.transcript || '';
          if (text && onTranscription) {
            onTranscription(text, 'output');
          }
        }
      }
      
    } catch (error) {
      logger.error('[llm] Failed to parse message:', error.message);
    }
  }
  
  /**
   * Send audio data to the LLM
   * @param {string} base64Audio - Base64 encoded PCM audio
   * @param {number} sampleRate - Audio sample rate
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
          data: base64Audio
        }]
      }
    };
    
    ws.send(JSON.stringify(message));
    return true;
  }
  
  /**
   * Send text message to the LLM
   * @param {string} text - Text to send
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
          parts: [{ text: text }]
        }],
        turnComplete: true
      }
    };
    
    ws.send(JSON.stringify(message));
    return true;
  }
  
  /**
   * Request TTS for given text
   * @param {string} text - Text to speak
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
          parts: [{ text: `Please say the following out loud: ${text}` }]
        }],
        turnComplete: true
      }
    };
    
    ws.send(JSON.stringify(message));
    return true;
  }
  
  /**
   * Close the WebSocket connection
   */
  function close() {
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnection
    
    if (ws) {
      ws.close();
      ws = null;
    }
    
    isReady = false;
    isConnecting = false;
    logger.info('[llm] Connection closed');
  }
  
  /**
   * Set event handlers
   */
  function on(event, handler) {
    switch (event) {
      case 'transcription':
        onTranscription = handler;
        break;
      case 'audio':
        onAudioResponse = handler;
        break;
      case 'text':
        onTextResponse = handler;
        break;
      case 'error':
        onError = handler;
        break;
      case 'ready':
        onReady = handler;
        break;
    }
  }
  
  return {
    connect,
    sendAudio,
    sendText,
    speak,
    close,
    on,
    isReady: () => isReady,
  };
}

module.exports = {
  createLLMClient,
};

