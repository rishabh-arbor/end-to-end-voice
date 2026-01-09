/**
 * Conversation Manager Module
 * 
 * @module llm/conversation
 * @description Manages the conversation state between the interview page and the LLM.
 *              Handles turn-taking, audio routing, and response timing.
 * 
 * @example
 * const { createConversation } = require('./llm/conversation');
 * 
 * const conversation = createConversation({
 *   llmClient,
 *   logger,
 *   responseDelayMs: 5000,
 *   cooldownMs: 15000,
 * });
 * 
 * await conversation.init();
 * conversation.sendAudio(base64Audio, 16000);
 * 
 * SOLID Principles Applied:
 * - Single Responsibility: Only manages conversation state and flow
 * - Open/Closed: Event handlers allow extension without modification
 * - Dependency Inversion: LLM client is injected as dependency
 */

'use strict';

/**
 * @typedef {Object} ConversationOptions
 * @property {Object} llmClient - LLM client instance (required)
 * @property {Object} [logger=console] - Logger instance
 * @property {number} [responseDelayMs=5000] - Delay before generating response (silence detection)
 * @property {number} [cooldownMs=15000] - Cooldown after TTS playback finishes
 * @property {Function} [onAudioResponse] - Callback for audio responses
 * @property {Function} [onTextResponse] - Callback for text responses
 */

/**
 * @typedef {Object} ConversationTurn
 * @property {'interviewer'|'candidate'} role - Who spoke this turn
 * @property {string} text - The spoken text
 * @property {number} timestamp - Unix timestamp when the turn occurred
 */

/**
 * @typedef {Object} ConversationStats
 * @property {number} totalTurns - Total number of conversation turns
 * @property {number} historyLength - Number of stored history entries
 * @property {boolean} isWaitingForResponse - Whether waiting for LLM response
 * @property {boolean} isTTSPlaying - Whether TTS is currently playing
 * @property {number} duration - Total conversation duration in ms
 */

/**
 * @typedef {Object} Conversation
 * @property {Function} init - Initialize the conversation
 * @property {Function} sendAudio - Send audio to LLM
 * @property {Function} markPlaybackComplete - Signal TTS playback is done
 * @property {Function} interrupt - Interrupt current turn
 * @property {Function} getHistory - Get conversation history
 * @property {Function} getStats - Get conversation statistics
 * @property {Function} destroy - Clean up resources
 */

/**
 * Creates a new conversation manager instance
 * 
 * @param {ConversationOptions} options - Configuration options
 * @returns {Conversation} Conversation manager instance
 * 
 * @example
 * const conversation = createConversation({
 *   llmClient: myLLMClient,
 *   responseDelayMs: 3000,
 * });
 */
function createConversation(options = {}) {
  // ============================================================
  // CONFIGURATION
  // ============================================================
  
  const {
    llmClient,
    logger = console,
    responseDelayMs = 5000,
    cooldownMs = 15000,
  } = options;
  
  // ============================================================
  // STATE
  // ============================================================
  
  /**
   * Conversation history
   * @type {ConversationTurn[]}
   */
  const history = [];
  
  /**
   * Buffer for accumulating transcript before processing
   * @type {string}
   */
  let transcriptBuffer = '';
  
  /**
   * Flag indicating we're waiting for LLM response
   * @type {boolean}
   */
  let isWaitingForResponse = false;
  
  /**
   * Flag indicating TTS is currently playing
   * @type {boolean}
   */
  let isTTSPlaying = false;
  
  /**
   * Timer for response generation delay
   * @type {NodeJS.Timeout|null}
   */
  let responseTimer = null;
  
  /**
   * Timer for post-TTS cooldown
   * @type {NodeJS.Timeout|null}
   */
  let cooldownTimer = null;
  
  /**
   * Total conversation turns completed
   * @type {number}
   */
  let totalTurns = 0;
  
  /**
   * Conversation start timestamp
   * @type {number}
   */
  const startTime = Date.now();
  
  // ============================================================
  // INITIALIZATION
  // ============================================================
  
  /**
   * Initializes the conversation by connecting to LLM and setting up handlers
   * 
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If LLM client is not provided
   * 
   * @example
   * await conversation.init();
   * console.log('Conversation ready');
   */
  async function init() {
    if (!llmClient) {
      logger.error('[conversation] No LLM client provided');
      throw new Error('LLM client is required for conversation');
    }
    
    // Register LLM event handlers
    llmClient.on('transcription', handleTranscription);
    llmClient.on('audio', handleAudioResponse);
    llmClient.on('text', handleTextResponse);
    llmClient.on('error', handleError);
    llmClient.on('ready', () => {
      logger.info('[conversation] LLM client ready');
    });
    
    // Connect to LLM
    await llmClient.connect();
    
    logger.info('[conversation] ✓ Conversation initialized');
  }
  
  // ============================================================
  // AUDIO INPUT HANDLING
  // ============================================================
  
  /**
   * Processes incoming audio from the interview page
   * Forwards audio to LLM for transcription unless blocked by TTS/cooldown
   * 
   * @async
   * @param {string} base64Audio - Base64 encoded PCM audio data
   * @param {number} sampleRate - Audio sample rate in Hz
   * @returns {Promise<void>}
   * 
   * @example
   * await conversation.sendAudio(audioData, 16000);
   */
  async function sendAudio(base64Audio, sampleRate) {
    // Skip if we're in TTS playback or cooldown (prevents echo)
    if (isTTSPlaying || isWaitingForResponse) {
      logger.debug('[conversation] Skipping audio (TTS/cooldown active)');
      return;
    }
    
    // Forward to LLM for transcription
    if (llmClient && llmClient.isReady()) {
      llmClient.sendAudio(base64Audio, sampleRate);
    }
  }
  
  // ============================================================
  // TRANSCRIPTION HANDLING
  // ============================================================
  
  /**
   * Handles transcription events from the LLM
   * Accumulates text and triggers response generation after silence
   * 
   * @private
   * @param {string} text - Transcribed text
   * @param {'input'|'output'} type - Transcription type
   */
  function handleTranscription(text, type) {
    if (!text || !text.trim()) return;
    
    // Skip our own output transcription (model's speech)
    if (type === 'output') {
      logger.debug('[conversation] Output transcription:', text.slice(0, 50));
      return;
    }
    
    // Skip if TTS is playing (avoid echo from speaker)
    if (isTTSPlaying || isWaitingForResponse) {
      logger.debug('[conversation] Skipping transcription (TTS/cooldown):', text.slice(0, 30));
      return;
    }
    
    logger.info('[conversation] 📝 Interviewer:', text);
    
    // Accumulate transcript
    transcriptBuffer += ' ' + text;
    
    // Reset response timer (extend silence wait)
    clearResponseTimer();
    
    // Start timer to process after silence
    responseTimer = setTimeout(() => {
      const question = transcriptBuffer.trim();
      
      if (question.length > 0) {
        logger.info('[conversation] ⏱️ Processing question:', question.slice(0, 80));
        generateResponse(question);
        transcriptBuffer = '';
      }
    }, responseDelayMs);
  }
  
  // ============================================================
  // RESPONSE GENERATION
  // ============================================================
  
  /**
   * Generates and speaks a response to the interviewer's question
   * 
   * @private
   * @async
   * @param {string} question - The question to respond to
   */
  async function generateResponse(question) {
    if (isWaitingForResponse) {
      logger.debug('[conversation] Already waiting for response');
      return;
    }
    
    isWaitingForResponse = true;
    isTTSPlaying = true;
    
    // Add interviewer turn to history
    addToHistory('interviewer', question);
    
    try {
      // Create response prompt
      const responsePrompt = createResponsePrompt(question);
      
      if (llmClient && llmClient.isReady()) {
        llmClient.sendText(responsePrompt);
        totalTurns++;
      }
      
    } catch (error) {
      logger.error('[conversation] Failed to generate response:', error.message);
      resetState();
    }
  }
  
  /**
   * Creates the prompt for response generation
   * 
   * @private
   * @param {string} question - Interviewer's question
   * @returns {string} Formatted prompt
   */
  function createResponsePrompt(question) {
    return `Based on the interviewer's question: "${question}", please provide a concise and natural interview response.`;
  }
  
  // ============================================================
  // RESPONSE HANDLING
  // ============================================================
  
  /**
   * Handles audio response from the LLM (TTS output)
   * 
   * @private
   * @param {string} base64Audio - Base64 encoded audio data
   * @param {number} sampleRate - Audio sample rate in Hz
   */
  function handleAudioResponse(base64Audio, sampleRate) {
    logger.debug('[conversation] 🔊 Received audio response');
    
    // Forward to registered callback
    if (typeof options.onAudioResponse === 'function') {
      options.onAudioResponse(base64Audio, sampleRate);
    }
  }
  
  /**
   * Handles text response from the LLM
   * 
   * @private
   * @param {string} text - Response text
   */
  function handleTextResponse(text) {
    if (!text) return;
    
    logger.info('[conversation] 💬 Response:', text.slice(0, 100));
    
    // Add candidate turn to history
    addToHistory('candidate', text);
    
    // Start cooldown after response
    startCooldown();
  }
  
  /**
   * Handles LLM errors
   * 
   * @private
   * @param {Error} error - The error object
   */
  function handleError(error) {
    logger.error('[conversation] LLM error:', error.message);
    resetState();
  }
  
  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  
  /**
   * Starts the cooldown period after TTS finishes
   * During cooldown, incoming audio is ignored to prevent echo
   * 
   * @private
   */
  function startCooldown() {
    logger.debug('[conversation] Starting cooldown...');
    
    clearCooldownTimer();
    
    cooldownTimer = setTimeout(() => {
      resetState();
      logger.info('[conversation] ✓ Cooldown complete, ready for next question');
    }, cooldownMs);
  }
  
  /**
   * Resets conversation state to ready
   * 
   * @private
   */
  function resetState() {
    isTTSPlaying = false;
    isWaitingForResponse = false;
    transcriptBuffer = '';
  }
  
  /**
   * Clears the response timer
   * 
   * @private
   */
  function clearResponseTimer() {
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
    }
  }
  
  /**
   * Clears the cooldown timer
   * 
   * @private
   */
  function clearCooldownTimer() {
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  }
  
  // ============================================================
  // HISTORY MANAGEMENT
  // ============================================================
  
  /**
   * Adds a turn to the conversation history
   * 
   * @private
   * @param {'interviewer'|'candidate'} role - Speaker role
   * @param {string} text - Spoken text
   */
  function addToHistory(role, text) {
    history.push({
      role,
      text,
      timestamp: Date.now(),
    });
  }
  
  // ============================================================
  // PUBLIC API
  // ============================================================
  
  /**
   * Signals that TTS playback has completed
   * This triggers the cooldown period
   * 
   * @example
   * // Called after audio playback finishes
   * conversation.markPlaybackComplete();
   */
  function markPlaybackComplete() {
    logger.debug('[conversation] TTS playback complete');
    startCooldown();
  }
  
  /**
   * Interrupts the current conversation turn
   * Clears timers and resets state
   * 
   * @example
   * // User interrupted, stop waiting
   * conversation.interrupt();
   */
  function interrupt() {
    logger.info('[conversation] Interrupting current turn');
    
    clearResponseTimer();
    clearCooldownTimer();
    
    transcriptBuffer = '';
    resetState();
  }
  
  /**
   * Returns a copy of the conversation history
   * 
   * @returns {ConversationTurn[]} Array of conversation turns
   * 
   * @example
   * const turns = conversation.getHistory();
   * turns.forEach(turn => console.log(`${turn.role}: ${turn.text}`));
   */
  function getHistory() {
    return [...history];
  }
  
  /**
   * Returns conversation statistics
   * 
   * @returns {ConversationStats} Current statistics
   * 
   * @example
   * const stats = conversation.getStats();
   * console.log(`Total turns: ${stats.totalTurns}`);
   */
  function getStats() {
    return {
      totalTurns,
      historyLength: history.length,
      isWaitingForResponse,
      isTTSPlaying,
      duration: Date.now() - startTime,
    };
  }
  
  /**
   * Cleans up resources and closes connections
   * 
   * @example
   * conversation.destroy();
   */
  function destroy() {
    clearResponseTimer();
    clearCooldownTimer();
    
    if (llmClient) {
      llmClient.close();
    }
    
    logger.info('[conversation] Conversation destroyed');
  }
  
  // ============================================================
  // RETURN PUBLIC API
  // ============================================================
  
  return {
    init,
    sendAudio,
    markPlaybackComplete,
    interrupt,
    getHistory,
    getStats,
    destroy,
  };
}

module.exports = {
  createConversation,
};

