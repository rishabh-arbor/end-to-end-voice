/**
 * Audio Processor Module
 * 
 * Handles audio format conversion and resampling
 */

/**
 * Resample audio data from one sample rate to another
 * Uses linear interpolation for simplicity
 * 
 * @param {Float32Array|Int16Array} samples - Input audio samples
 * @param {number} fromRate - Source sample rate
 * @param {number} toRate - Target sample rate
 * @returns {Float32Array} Resampled audio
 */
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) {
    return samples instanceof Float32Array ? samples : int16ToFloat32(samples);
  }
  
  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const output = new Float32Array(newLength);
  
  // Convert to Float32 if needed
  const input = samples instanceof Float32Array ? samples : int16ToFloat32(samples);
  
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const fraction = srcIndex - srcIndexFloor;
    
    // Linear interpolation
    output[i] = input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction;
  }
  
  return output;
}

/**
 * Convert Int16 PCM to Float32
 * @param {Int16Array} int16Data
 * @returns {Float32Array}
 */
function int16ToFloat32(int16Data) {
  const float32 = new Float32Array(int16Data.length);
  for (let i = 0; i < int16Data.length; i++) {
    float32[i] = int16Data[i] / 32768.0;
  }
  return float32;
}

/**
 * Convert Float32 to Int16 PCM
 * @param {Float32Array} float32Data
 * @returns {Int16Array}
 */
function float32ToInt16(float32Data) {
  const int16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

/**
 * Calculate RMS (Root Mean Square) level of audio
 * @param {Float32Array|Int16Array} samples
 * @returns {number} RMS level (0-1 for Float32, 0-32768 for Int16)
 */
function calculateRMS(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Convert RMS level to decibels
 * @param {number} rms - RMS level
 * @returns {number} Level in dB
 */
function rmsToDb(rms) {
  return 20 * Math.log10(rms + 1e-8);
}

/**
 * Simple Voice Activity Detection (VAD)
 * Returns true if audio chunk appears to contain speech
 * 
 * @param {Float32Array|Int16Array} samples
 * @param {object} options
 * @returns {boolean}
 */
function detectVoiceActivity(samples, options = {}) {
  const {
    threshold = -40, // dB threshold
  } = options;
  
  // Convert to Float32 if needed
  const float32 = samples instanceof Float32Array ? samples : int16ToFloat32(samples);
  
  const rms = calculateRMS(float32);
  const db = rmsToDb(rms);
  
  return db > threshold;
}

/**
 * Apply gain to audio samples
 * @param {Float32Array} samples
 * @param {number} gain - Gain multiplier
 * @returns {Float32Array}
 */
function applyGain(samples, gain) {
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    output[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return output;
}

/**
 * Mix two audio streams together
 * @param {Float32Array} audio1
 * @param {Float32Array} audio2
 * @param {number} mix - Mix ratio (0 = all audio1, 1 = all audio2)
 * @returns {Float32Array}
 */
function mixAudio(audio1, audio2, mix = 0.5) {
  const length = Math.max(audio1.length, audio2.length);
  const output = new Float32Array(length);
  
  for (let i = 0; i < length; i++) {
    const s1 = i < audio1.length ? audio1[i] : 0;
    const s2 = i < audio2.length ? audio2[i] : 0;
    output[i] = s1 * (1 - mix) + s2 * mix;
  }
  
  return output;
}

/**
 * Encode audio as base64 string
 * @param {Int16Array} pcmData
 * @returns {string}
 */
function encodeBase64(pcmData) {
  const bytes = new Uint8Array(pcmData.buffer);
  let binary = '';
  const chunkSize = 8192;
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  
  return Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Decode base64 string to audio
 * @param {string} base64
 * @returns {Int16Array}
 */
function decodeBase64(base64) {
  const binary = Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  
  return new Int16Array(bytes.buffer);
}

module.exports = {
  resample,
  int16ToFloat32,
  float32ToInt16,
  calculateRMS,
  rmsToDb,
  detectVoiceActivity,
  applyGain,
  mixAudio,
  encodeBase64,
  decodeBase64,
};

