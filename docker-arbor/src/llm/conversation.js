/**
 * Conversation Manager Module
 * 
 * Manages the conversation state between the interview page
 * and the LLM, handling:
 * - Audio capture -> LLM
 * - LLM response -> TTS playback
 * - Turn management and interruption handling
 */

/**
 * Create a conversation manager
 * @param {object} options
 * @returns {object} Conversation manager instance
 */
function createConversation(options = {}) {
  const {
    llmClient,
    logger = console,
    responseDelayMs = 5000,  // Wait before generating response
    cooldownMs = 15000,      // Cooldown after TTS finishes
  } = options;
  
  // Conversation state
  const history = [];
  let transcriptBuffer = '';
  let isWaitingForResponse = false;
  let isTTSPlaying = false;
  let responseTimer = null;
  let cooldownTimer = null;
  
  // Stats
  let totalTurns = 0;
  let startTime = Date.now();
  
  /**
   * Initialize the conversation
   */
  async function init() {
    if (!llmClient) {
      logger.error('[conversation] No LLM client provided');
      return;
    }
    
    // Set up LLM event handlers
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
  
  /**
   * Handle incoming audio from the interview page
   * @param {string} base64Audio - Base64 encoded PCM audio
   * @param {number} sampleRate - Audio sample rate
   */
  async function sendAudio(base64Audio, sampleRate) {
    // Skip if we're in cooldown or TTS is playing
    if (isTTSPlaying || isWaitingForResponse) {
      logger.debug('[conversation] Skipping audio (TTS/cooldown active)');
      return;
    }
    
    // Forward to LLM for transcription
    if (llmClient && llmClient.isReady()) {
      llmClient.sendAudio(base64Audio, sampleRate);
    }
  }
  
  /**
   * Handle transcription from LLM
   */
  function handleTranscription(text, type) {
    if (!text || !text.trim()) return;
    
    // Skip own output transcription
    if (type === 'output') {
      logger.debug('[conversation] Output transcription:', text.slice(0, 50));
      return;
    }
    
    // Skip if TTS is playing (avoid echo)
    if (isTTSPlaying || isWaitingForResponse) {
      logger.debug('[conversation] Skipping transcription (TTS/cooldown):', text.slice(0, 30));
      return;
    }
    
    logger.info('[conversation] 📝 Interviewer:', text);
    
    // Add to transcript buffer
    transcriptBuffer += ' ' + text;
    
    // Reset response timer
    if (responseTimer) {
      clearTimeout(responseTimer);
    }
    
    // Wait for silence before responding
    responseTimer = setTimeout(() => {
      const question = transcriptBuffer.trim();
      
      if (question.length > 0) {
        logger.info('[conversation] ⏱️ Processing question:', question.slice(0, 80));
        generateResponse(question);
        transcriptBuffer = '';
      }
    }, responseDelayMs);
  }
  
  /**
   * Generate and speak a response to the question
   */
  async function generateResponse(question) {
    if (isWaitingForResponse) {
      logger.debug('[conversation] Already waiting for response');
      return;
    }
    
    isWaitingForResponse = true;
    isTTSPlaying = true;
    
    // Add to history
    history.push({
      role: 'interviewer',
      text: question,
      timestamp: Date.now(),
    });
    
    try {
      // Ask LLM to respond
      // The LLM is already connected for speech-to-speech
      // We just need to prompt it to respond
      const responseText = `Based on the interviewer's question: "${question}", please provide a concise and natural interview response.`;
      
      if (llmClient && llmClient.isReady()) {
        llmClient.sendText(responseText);
        totalTurns++;
      }
      
    } catch (error) {
      logger.error('[conversation] Failed to generate response:', error.message);
      isWaitingForResponse = false;
      isTTSPlaying = false;
    }
  }
  
  /**
   * Handle audio response from LLM
   */
  function handleAudioResponse(base64Audio, sampleRate) {
    logger.debug('[conversation] 🔊 Received audio response');
    
    // This will be forwarded to the page for playback
    // The page controller should call __arborPlayTTS
    if (options.onAudioResponse) {
      options.onAudioResponse(base64Audio, sampleRate);
    }
  }
  
  /**
   * Handle text response from LLM
   */
  function handleTextResponse(text) {
    if (!text) return;
    
    logger.info('[conversation] 💬 Response:', text.slice(0, 100));
    
    // Add to history
    history.push({
      role: 'candidate',
      text: text,
      timestamp: Date.now(),
    });
    
    // Start cooldown after response
    startCooldown();
  }
  
  /**
   * Start cooldown period after TTS finishes
   */
  function startCooldown() {
    logger.debug('[conversation] Starting cooldown...');
    
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
    }
    
    cooldownTimer = setTimeout(() => {
      isTTSPlaying = false;
      isWaitingForResponse = false;
      transcriptBuffer = '';
      logger.info('[conversation] ✓ Cooldown complete, ready for next question');
    }, cooldownMs);
  }
  
  /**
   * Handle LLM error
   */
  function handleError(error) {
    logger.error('[conversation] LLM error:', error.message);
    isWaitingForResponse = false;
    isTTSPlaying = false;
  }
  
  /**
   * Mark TTS playback as complete
   */
  function markPlaybackComplete() {
    logger.debug('[conversation] TTS playback complete');
    startCooldown();
  }
  
  /**
   * Interrupt current conversation turn
   */
  function interrupt() {
    logger.info('[conversation] Interrupting current turn');
    
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
    }
    
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
    
    transcriptBuffer = '';
    isWaitingForResponse = false;
    isTTSPlaying = false;
  }
  
  /**
   * Get conversation history
   */
  function getHistory() {
    return [...history];
  }
  
  /**
   * Get conversation stats
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
   * Clean up resources
   */
  function destroy() {
    if (responseTimer) clearTimeout(responseTimer);
    if (cooldownTimer) clearTimeout(cooldownTimer);
    
    if (llmClient) {
      llmClient.close();
    }
    
    logger.info('[conversation] Conversation destroyed');
  }
  
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

