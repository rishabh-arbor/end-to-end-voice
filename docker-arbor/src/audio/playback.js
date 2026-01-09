/**
 * Audio Playback Module
 * 
 * Handles playing TTS audio to the virtual speaker (PulseAudio)
 * The audio will be looped back to the virtual mic for the interview page to hear
 */

/**
 * Create an audio playback handler for use in browser context
 * This returns a string that can be evaluated in the page
 */
function getAudioPlaybackScript(options = {}) {
  const {
    defaultSampleRate = 24000,
    volumeBoost = 5.0,
  } = options;
  
  return `
(function() {
  var DEFAULT_SAMPLE_RATE = ${defaultSampleRate};
  var VOLUME_BOOST = ${volumeBoost};
  
  var audioContext = null;
  var playbackQueue = [];
  var isPlaying = false;
  var onPlaybackStart = null;
  var onPlaybackEnd = null;
  
  function ensureContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }
  
  function queueAudio(base64Data, sampleRate) {
    try {
      var ctx = ensureContext();
      sampleRate = sampleRate || DEFAULT_SAMPLE_RATE;
      
      // Decode base64 to raw bytes
      var binary = atob(base64Data);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      // Convert Int16 PCM to Float32
      var pcm16 = new Int16Array(bytes.buffer);
      var float32 = new Float32Array(pcm16.length);
      for (var i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }
      
      // Create audio buffer
      var buffer = ctx.createBuffer(1, float32.length, sampleRate);
      buffer.getChannelData(0).set(float32);
      
      // Add to queue
      playbackQueue.push({
        buffer: buffer,
        sampleRate: sampleRate,
      });
      
      // Start playback if not already playing
      playNextChunk();
      
    } catch (error) {
      console.error('[playback] Failed to queue audio:', error.message);
    }
  }
  
  function playNextChunk() {
    if (isPlaying || playbackQueue.length === 0) return;
    
    isPlaying = true;
    var item = playbackQueue.shift();
    
    if (onPlaybackStart && playbackQueue.length === 0) {
      onPlaybackStart();
    }
    
    var ctx = ensureContext();
    var source = ctx.createBufferSource();
    source.buffer = item.buffer;
    
    // Apply volume boost
    var gainNode = ctx.createGain();
    gainNode.gain.value = VOLUME_BOOST;
    
    // Connect: source -> gain -> destination (virtual speaker)
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    source.onended = function() {
      isPlaying = false;
      
      if (playbackQueue.length === 0) {
        if (onPlaybackEnd) {
          onPlaybackEnd();
        }
      } else {
        playNextChunk();
      }
    };
    
    source.start(0);
    console.log('[playback] Playing audio chunk (' + item.buffer.length + ' samples)');
  }
  
  function clearQueue() {
    playbackQueue = [];
    console.log('[playback] Queue cleared');
  }
  
  function setCallbacks(callbacks) {
    if (callbacks.onStart) onPlaybackStart = callbacks.onStart;
    if (callbacks.onEnd) onPlaybackEnd = callbacks.onEnd;
  }
  
  function getStats() {
    return {
      isPlaying: isPlaying,
      queueLength: playbackQueue.length,
      sampleRate: audioContext ? audioContext.sampleRate : null,
    };
  }
  
  // Expose to window
  window.__arborAudioPlayback = {
    queue: queueAudio,
    clear: clearQueue,
    setCallbacks: setCallbacks,
    getStats: getStats,
  };
  
  // Alias for compatibility
  window.__arborPlayTTS = queueAudio;
  
  console.log('[playback] Audio playback module loaded');
})();
`;
}

module.exports = {
  getAudioPlaybackScript,
};

