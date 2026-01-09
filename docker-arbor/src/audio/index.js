/**
 * Audio Module Index
 * 
 * Exports all audio-related functionality
 */

const { getAudioCaptureScript, pcmToBase64, base64ToPcm } = require('./capture');
const { getAudioPlaybackScript } = require('./playback');
const processor = require('./processor');

module.exports = {
  // Capture
  getAudioCaptureScript,
  pcmToBase64,
  base64ToPcm,
  
  // Playback
  getAudioPlaybackScript,
  
  // Processor utilities
  resample: processor.resample,
  int16ToFloat32: processor.int16ToFloat32,
  float32ToInt16: processor.float32ToInt16,
  calculateRMS: processor.calculateRMS,
  rmsToDb: processor.rmsToDb,
  detectVoiceActivity: processor.detectVoiceActivity,
  applyGain: processor.applyGain,
  mixAudio: processor.mixAudio,
  encodeBase64: processor.encodeBase64,
  decodeBase64: processor.decodeBase64,
};

