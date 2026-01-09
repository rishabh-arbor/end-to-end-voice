/**
 * Audio Capture Module
 * 
 * Handles capturing audio from the virtual microphone (PulseAudio)
 * The virtual mic receives audio from the interview page via the loopback
 */

/**
 * Create an audio capture handler for use in browser context
 * This returns a string that can be evaluated in the page
 */
function getAudioCaptureScript(options = {}) {
  const {
    sampleRate = 16000,
    chunkDurationMs = 2000,
  } = options;
  
  return `
(function() {
  var SAMPLE_RATE = ${sampleRate};
  var CHUNK_DURATION_MS = ${chunkDurationMs};
  
  var audioContext = null;
  var mediaStream = null;
  var workletNode = null;
  var pcmBuffer = [];
  var isCapturing = false;
  var onAudioChunk = null;
  
  async function initCapture(callback) {
    if (isCapturing) return;
    
    onAudioChunk = callback;
    
    try {
      console.log('[capture] Requesting microphone access...');
      
      // Request audio from virtual mic (set up by PulseAudio)
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          // Don't force sample rate - use device native
        },
        video: false
      });
      
      // Create audio context
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      var source = audioContext.createMediaStreamSource(mediaStream);
      
      console.log('[capture] Audio context sample rate:', audioContext.sampleRate);
      
      // Calculate samples per chunk
      var samplesPerChunk = Math.floor(audioContext.sampleRate * CHUNK_DURATION_MS / 1000);
      
      // Create AudioWorklet processor
      var workletCode = [
        'class PCMCaptureProcessor extends AudioWorkletProcessor {',
        '  process(inputs, outputs, parameters) {',
        '    if (inputs[0] && inputs[0][0]) {',
        '      this.port.postMessage({ samples: inputs[0][0] });',
        '    }',
        '    return true;',
        '  }',
        '}',
        'registerProcessor("pcm-capture-processor", PCMCaptureProcessor);'
      ].join('\\n');
      
      var blob = new Blob([workletCode], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      
      await audioContext.audioWorklet.addModule(url);
      workletNode = new AudioWorkletNode(audioContext, 'pcm-capture-processor');
      
      // Handle incoming audio samples
      workletNode.port.onmessage = function(event) {
        var samples = event.data.samples;
        
        // Convert Float32 to Int16
        for (var i = 0; i < samples.length; i++) {
          var s = Math.max(-1, Math.min(1, samples[i]));
          pcmBuffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
        }
        
        // Check if we have enough samples for a chunk
        if (pcmBuffer.length >= samplesPerChunk) {
          var chunk = pcmBuffer.slice(0, samplesPerChunk);
          pcmBuffer = pcmBuffer.slice(samplesPerChunk);
          
          // Send chunk to callback
          if (onAudioChunk) {
            onAudioChunk(chunk, audioContext.sampleRate);
          }
        }
      };
      
      // Connect nodes
      source.connect(workletNode);
      
      // Don't connect to destination (we don't want to play captured audio)
      // workletNode.connect(audioContext.destination);
      
      isCapturing = true;
      console.log('[capture] ✓ Audio capture started');
      
    } catch (error) {
      console.error('[capture] Failed to init audio capture:', error.message);
      throw error;
    }
  }
  
  function stopCapture() {
    if (!isCapturing) return;
    
    isCapturing = false;
    
    if (workletNode) {
      workletNode.disconnect();
      workletNode = null;
    }
    
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    
    if (mediaStream) {
      mediaStream.getTracks().forEach(function(track) {
        track.stop();
      });
      mediaStream = null;
    }
    
    pcmBuffer = [];
    console.log('[capture] Audio capture stopped');
  }
  
  function getStats() {
    return {
      isCapturing: isCapturing,
      sampleRate: audioContext ? audioContext.sampleRate : null,
      bufferLength: pcmBuffer.length,
    };
  }
  
  // Expose to window
  window.__arborAudioCapture = {
    init: initCapture,
    stop: stopCapture,
    getStats: getStats,
  };
  
  console.log('[capture] Audio capture module loaded');
})();
`;
}

/**
 * Convert PCM Int16 array to base64 string
 */
function pcmToBase64(pcmArray) {
  const int16Array = new Int16Array(pcmArray);
  const bytes = new Uint8Array(int16Array.buffer);
  
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  
  return Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Convert base64 string to PCM Int16 array
 */
function base64ToPcm(base64String) {
  const binary = Buffer.from(base64String, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  
  return new Int16Array(bytes.buffer);
}

module.exports = {
  getAudioCaptureScript,
  pcmToBase64,
  base64ToPcm,
};

