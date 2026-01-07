# End-to-End Voice Interview Automation - Architecture Document

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Audio Flow Diagram](#audio-flow-diagram)
4. [Core Components](#core-components)
5. [File Structure](#file-structure)
6. [Detailed Component Breakdown](#detailed-component-breakdown)
7. [Gemini API Integration](#gemini-api-integration)
8. [Audio Routing Configuration](#audio-routing-configuration)
9. [Key Code Sections](#key-code-sections)
10. [Configuration Options](#configuration-options)
11. [Troubleshooting Guide](#troubleshooting-guide)
12. [API Reference](#api-reference)

---

## Overview

This project automates voice interviews on the Arbor platform. An AI agent listens to the interviewer (Umi), generates intelligent responses using Google's Gemini API, and speaks back through text-to-speech.

### Core Flow
```
Umi Speaks → Speaker Audio Capture (System Audio) → Gemini STT → LLM Response → Gemini TTS → Uplink to Umi
```

### Key Technologies
- **Electron**: Desktop application framework
- **Gemini Live API**: Real-time STT (Speech-to-Text) and TTS (Text-to-Speech)
- **Gemini Text API**: LLM for generating interview responses
- **Web Audio API**: Audio processing and routing
- **LiveKit**: WebRTC-based real-time communication (used by Arbor)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ELECTRON APPLICATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │   Main Process   │    │  Preload Script  │    │ Renderer Process │       │
│  │ (electron-main)  │───▶│(electron-preload)│───▶│   (Arbor Page)   │       │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘       │
│           │                                              │                   │
│           │ injects automationCode                       │                   │
│           ▼                                              ▼                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      AUTOMATION CODE (injected)                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │    │
│  │  │ Audio       │  │ Gemini STT  │  │ LLM Response│  │ Gemini TTS │  │    │
│  │  │ Capture     │  │ WebSocket   │  │ Generator   │  │ WebSocket  │  │    │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘  │    │
│  │         │                │                │               │         │    │
│  │         └────────────────┴────────────────┴───────────────┘         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket
                                      ▼
                    ┌─────────────────────────────────────┐
                    │         GEMINI LIVE API             │
                    │  (generativelanguage.googleapis.com)│
                    │                                     │
                    │  • STT: BidiGenerateContent         │
                    │  • TTS: BidiGenerateContent         │
                    │  • LLM: generateContent             │
                    └─────────────────────────────────────┘
```

---

## Audio Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AUDIO FLOW                                        │
└─────────────────────────────────────────────────────────────────────────────┘

                        ┌─────────────────┐
                        │   Umi (Arbor)   │
                        │   Interviewer   │
                        └────────┬────────┘
                                 │
                                 │ WebRTC Audio
                                 ▼
                    ┌────────────────────────┐
                    │  System Audio Output   │
                    │  (MacBook Speakers)    │
                    └────────────┬───────────┘
                                 │
                                 │ Routed via Multi-Output Device
                                 ▼
                    ┌────────────────────────┐
                    │   BlackHole 2ch        │
                    │  (Virtual Audio Input) │
                    └────────────┬───────────┘
                                 │
                                 │ getUserMedia (BlackHole device)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        UMI AUDIO CAPTURE PIPELINE                            │
│                                                                              │
│  MediaStream ──▶ AudioContext ──▶ MediaStreamSource ──▶ AudioWorklet        │
│                      │                                       │               │
│                      │                                       │ PCM chunks    │
│                      ▼                                       ▼               │
│               AnalyserNode                           Gemini STT WebSocket    │
│            (level monitoring)                               │               │
│                                                             │               │
│                                                             ▼               │
│                                                    inputTranscription       │
│                                                             │               │
│                                                             ▼               │
│                                                   [🔊 UMI VOICE] logs       │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ Transcribed text
                                 ▼
                    ┌────────────────────────┐
                    │   Response Timer       │
                    │   (5 second silence)   │
                    └────────────┬───────────┘
                                 │
                                 │ fullQuestionBuffer
                                 ▼
                    ┌────────────────────────┐
                    │   Gemini LLM API       │
                    │  (generateContent)     │
                    └────────────┬───────────┘
                                 │
                                 │ Response text
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TTS OUTPUT PIPELINE                                │
│                                                                              │
│  Gemini TTS WebSocket ──▶ Base64 PCM ──▶ AudioBuffer ──▶ BufferSource       │
│                                                              │               │
│                                              ┌───────────────┼───────────┐   │
│                                              │               │           │   │
│                                              ▼               ▼           │   │
│                                    audioContext.dest   MediaStreamDest  │   │
│                                    (MacBook Speakers)        │           │   │
│                                              │               │           │   │
│                                              ▼               ▼           │   │
│                                         User hears    uplinkDestination │   │
│                                         the response        │           │   │
│                                                             │           │   │
└─────────────────────────────────────────────────────────────┼───────────────┘
                                                              │
                                                              ▼
                                              ┌────────────────────────┐
                                              │  Interview getUserMedia │
                                              │   (intercepted stream)  │
                                              └────────────┬───────────┘
                                                           │
                                                           ▼
                                              ┌────────────────────────┐
                                              │   Umi hears response   │
                                              └────────────────────────┘
```

---

## Core Components

### 1. Audio Capture System

#### Speaker Audio Capture (`captureUmiFromSpeakers`)
Captures Umi's voice from system audio (speakers) using BlackHole or getDisplayMedia. **No DOM APIs are used** - only system-level audio capture.

**Method 1: BlackHole (Primary)**
- Requires Multi-Output Device setup (MacBook Speakers + BlackHole 2ch)
- System audio is routed to both speakers (for user) and BlackHole (for capture)
- BlackHole appears as an audio input device

**Method 2: getDisplayMedia (Fallback)**
- Browser API for system audio capture
- Requires user permission
- Captures all system audio output

```javascript
function captureUmiFromSpeakers() {
  return new Promise(function(resolve) {
    // Try BlackHole first (requires Multi-Output Device setup)
    startStream({ 
      label: 'umi', 
      matcher: function(d) { 
        return d.label.toLowerCase().includes('blackhole'); 
      }
    }).then(function(stream) {
      console.log('[audio][umi] ✓ BlackHole stream obtained');
      resolve(stream);
    }).catch(function(err) {
      // Fallback: getDisplayMedia for system audio
      navigator.mediaDevices.getDisplayMedia({ 
        audio: true, 
        video: false 
      }).then(resolve);
    });
  });
}
```

#### User Microphone Capture
Captures user's microphone for the interview platform with noise gate.

```javascript
startStream({ 
  label: 'user', 
  matcher: function(d) { 
    return d.label.toLowerCase().includes('mic'); 
  }
})
```

### 2. Virtual Mic Mixer (Uplink System)

The uplink mixer combines:
1. User's microphone (gated)
2. TTS audio output

This mixed stream is provided to the interview platform via intercepted `getUserMedia`.

```javascript
// Uplink audio graph:
// 
//  Physical Mic ──▶ Compressor ──▶ Analyser ──▶ Gate ──▶ uplinkDestination
//                                                              ▲
//  TTS Audio ──▶ MediaStreamSource ────────────────────────────┘
```

### 3. Gemini STT (Speech-to-Text)

WebSocket connection to Gemini Live API for real-time transcription.

**Endpoint**: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`

**Setup Message**:
```javascript
{
  setup: {
    model: 'models/gemini-2.0-flash-exp',
    generation_config: {
      response_modalities: ['TEXT']
    },
    input_audio_transcription: {}
  }
}
```

**Audio Input Format**:
```javascript
{
  realtimeInput: {
    mediaChunks: [{
      mimeType: 'audio/pcm;rate=48000',  // Native sample rate
      data: base64EncodedPCM
    }]
  }
}
```

**Response Format**:
```javascript
{
  serverContent: {
    inputTranscription: {
      text: "Transcribed text here"
    }
  }
}
```

### 4. LLM Response Generator

Uses Gemini Text API to generate interview responses.

**Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`

**System Prompt**:
```
You are an interview candidate. Answer in 1-2 short sentences MAX. 
Be direct and natural. No markdown.
```

**Request Format**:
```javascript
{
  contents: [{
    role: 'user',
    parts: [{ text: question }]
  }],
  systemInstruction: {
    parts: [{ text: systemPrompt }]
  },
  generationConfig: {
    maxOutputTokens: 150,
    temperature: 0.7
  }
}
```

### 5. Gemini TTS (Text-to-Speech)

WebSocket connection for real-time speech synthesis.

**Setup Message**:
```javascript
{
  setup: {
    model: 'models/gemini-2.0-flash-exp',
    generation_config: {
      response_modalities: ['AUDIO'],
      speech_config: {
        voice_config: {
          prebuilt_voice_config: {
            voice_name: 'Aoede'  // Female voice
          }
        }
      }
    }
  }
}
```

**Text Input**:
```javascript
{
  clientContent: {
    turns: [{
      role: 'user',
      parts: [{ text: responseText }]
    }],
    turnComplete: true
  }
}
```

**Audio Output Format**:
- Codec: PCM 16-bit signed
- Sample Rate: 24000 Hz
- Channels: 1 (mono)
- Encoding: Base64

---

## File Structure

```
arbor-end-to-end-customer/
├── electron-main.js        # Main Electron process + automation code
├── electron-preload.js     # Preload script for IPC
├── electron-renderer.js    # Renderer utilities
├── gemini.js              # Gemini API helper functions
├── interview-click.js     # Click automation utilities
├── interview-monitor.js   # Interview state monitoring
├── interview-type.js      # Typing automation
├── capture-chats.js       # Chat capture utilities
├── wav-encoder.js         # WAV encoding utilities
├── package.json           # Dependencies
├── secrets.local.json     # API keys (gitignored)
├── .gitignore
├── README.md
├── README-ELECTRON.md
├── VOICE_MODE_SETUP.md
└── ARCHITECTURE.md        # This document
```

---

## Detailed Component Breakdown

### electron-main.js

This is the main file containing all automation logic. It's structured as:

#### 1. Initialization (Lines 1-30)
```javascript
const { app, BrowserWindow, session, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// Load secrets from secrets.local.json
function loadSecrets() {
  const secretsPath = path.join(__dirname, 'secrets.local.json');
  if (fs.existsSync(secretsPath)) {
    const json = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    Object.entries(json).forEach(([k, v]) => {
      if (!process.env[k]) process.env[k] = String(v);
    });
  }
}
loadSecrets();
```

#### 2. Window Creation (Lines 31-100)
```javascript
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      enableRemoteModule: true
    }
  });
  
  // Auto-grant media permissions
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(true);
    }
  });
}
```

#### 3. Automation Code Injection (Lines 101-900)

The `automationCode` string is injected into the renderer process:

```javascript
const automationCode = `
(function() {
  // === UPLINK MIXER SETUP ===
  // === GEMINI STT FUNCTIONS ===
  // === LLM RESPONSE GENERATOR ===
  // === GEMINI TTS FUNCTIONS ===
  // === AUDIO CAPTURE PIPELINE ===
  // === AUTO-CLICK AUTOMATION ===
})();
`;

mainWindow.webContents.executeJavaScript(automationCode);
```

### Key Automation Sections

#### Uplink Mixer (Virtual Microphone)
```javascript
var uplinkAudioContext = null;
var uplinkDestination = null;  // MediaStreamDestination
var uplinkMicGate = null;      // GainNode for noise gate

async function ensureUplinkMixer() {
  uplinkAudioContext = new AudioContext();
  uplinkDestination = uplinkAudioContext.createMediaStreamDestination();
  uplinkMicGate = uplinkAudioContext.createGain();
  uplinkMicGate.gain.value = 0.0;  // Start closed
  
  // Audio chain: Mic → Compressor → Analyser → Gate → Destination
  var physicalMic = await navigator.mediaDevices.getUserMedia({ audio: true });
  var micSource = uplinkAudioContext.createMediaStreamSource(physicalMic);
  var compressor = uplinkAudioContext.createDynamicsCompressor();
  var analyser = uplinkAudioContext.createAnalyser();
  
  micSource.connect(compressor);
  compressor.connect(analyser);
  compressor.connect(uplinkMicGate);
  uplinkMicGate.connect(uplinkDestination);
}
```

#### Noise Gate Logic
```javascript
// RMS-based noise gate with hysteresis
var OPEN_THRESH = 0.015;   // Open when RMS > this
var CLOSE_THRESH = 0.008;  // Close when RMS < this
var gateOpen = false;

setInterval(function() {
  analyser.getFloatTimeDomainData(timeData);
  var sum = 0;
  for (var i = 0; i < timeData.length; i++) {
    sum += timeData[i] * timeData[i];
  }
  var rms = Math.sqrt(sum / timeData.length);
  
  if (!gateOpen && rms > OPEN_THRESH) {
    gateOpen = true;
    uplinkMicGate.gain.value = 1.0;
  } else if (gateOpen && rms < CLOSE_THRESH) {
    gateOpen = false;
    uplinkMicGate.gain.value = 0.0;
  }
}, 50);
```

#### getUserMedia Interception
```javascript
// Intercept page's getUserMedia to provide our mixed stream
var origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async function(constraints) {
  if (constraints && constraints.audio) {
    await ensureUplinkMixer();
    if (uplinkDestination && uplinkDestination.stream) {
      console.log('[uplink] Supplying mixed mic stream');
      return uplinkDestination.stream;
    }
  }
  return origGetUserMedia(constraints);
};
```

#### Response Timer Logic
```javascript
var fullQuestionBuffer = '';
var responseTimer = null;

// On each transcription chunk:
if (hasRealContent && !userIsSpeaking) {
  fullQuestionBuffer += chunk + ' ';
  
  if (responseTimer) clearTimeout(responseTimer);
  responseTimer = setTimeout(function() {
    var question = fullQuestionBuffer.trim();
    if (question.length > 0) {
      fullQuestionBuffer = '';
      handleUmiQuestion(question);
    }
  }, 5000);  // 5 second silence = Umi finished speaking
}
```

#### TTS to Uplink Routing
```javascript
var ttsMediaDest = null;
var ttsToUplinkSource = null;

function playNextAudioChunk() {
  // Play to speakers
  gainNode.connect(audioContext.destination);
  
  // Also route to uplink for Umi
  if (uplinkReady && uplinkAudioContext && uplinkDestination) {
    if (!ttsMediaDest) {
      ttsMediaDest = audioContext.createMediaStreamDestination();
    }
    gainNode.connect(ttsMediaDest);
    
    if (!ttsToUplinkSource) {
      ttsToUplinkSource = uplinkAudioContext.createMediaStreamSource(ttsMediaDest.stream);
      ttsToUplinkSource.connect(uplinkDestination);
    }
  }
}
```

---

## Gemini API Integration

### API Endpoints

| Purpose | Endpoint | Protocol |
|---------|----------|----------|
| STT | `wss://generativelanguage.googleapis.com/ws/.../BidiGenerateContent` | WebSocket |
| TTS | `wss://generativelanguage.googleapis.com/ws/.../BidiGenerateContent` | WebSocket |
| LLM | `https://generativelanguage.googleapis.com/v1beta/models/.../generateContent` | HTTPS POST |

### Authentication

All endpoints use API key authentication:
```
?key=YOUR_GEMINI_API_KEY
```

### Models Used

- **STT/TTS**: `models/gemini-2.0-flash-exp`
- **LLM**: `models/gemini-2.0-flash-exp`

### WebSocket Message Flow

#### STT Flow
```
Client                              Server
   │                                   │
   │──── setup (model config) ────────▶│
   │                                   │
   │◀─── setupComplete ───────────────│
   │                                   │
   │──── realtimeInput (audio) ───────▶│
   │──── realtimeInput (audio) ───────▶│
   │                                   │
   │◀─── serverContent.inputTranscription
   │◀─── serverContent.inputTranscription
   │                                   │
```

#### TTS Flow
```
Client                              Server
   │                                   │
   │──── setup (model + voice) ───────▶│
   │                                   │
   │◀─── setupComplete ───────────────│
   │                                   │
   │──── clientContent (text) ────────▶│
   │                                   │
   │◀─── serverContent.modelTurn (audio chunks)
   │◀─── serverContent.modelTurn (audio chunks)
   │◀─── serverContent.turnComplete ──│
   │                                   │
```

---

## Audio Routing Configuration

### macOS Setup (Required for BlackHole fallback)

1. **Install BlackHole 2ch** (virtual audio device)
2. **Create Multi-Output Device** in Audio MIDI Setup:
   - MacBook Air Speakers ✓
   - BlackHole 2ch ✓
3. **Set system output** to Multi-Output Device

### Audio Contexts

The system uses multiple AudioContexts:

| Context | Purpose | Sample Rate |
|---------|---------|-------------|
| `uplinkAudioContext` | Mic mixing + TTS routing | 48000 Hz |
| `audioContext` (TTS) | TTS playback | 24000 Hz (native) |
| `audioContext` (STT) | STT capture | 48000 Hz (native) |

### Sample Rate Handling

```javascript
// STT: Use native sample rate
var audioContext = new AudioContext();  // 48000 Hz typically
var mimeType = 'audio/pcm;rate=' + audioContext.sampleRate;

// TTS: Gemini outputs 24000 Hz
var pcmRate = 24000;
var audioBuffer = audioContext.createBuffer(1, float32.length, pcmRate);
```

---

## Configuration Options

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `INTERVIEW_PASSWORD` | Arbor interview password | Yes |
| `OPENAI_API_KEY` | OpenAI API key (unused) | No |
| `ENABLE_STT` | Enable STT (set to "1") | No |

### secrets.local.json

```json
{
  "GEMINI_API_KEY": "AIza...",
  "INTERVIEW_PASSWORD": "your_password",
  "ENABLE_STT": "1"
}
```

### Tunable Parameters

| Parameter | Location | Default | Description |
|-----------|----------|---------|-------------|
| Response Timer | Line ~723 | 5000ms | Silence duration before responding |
| Noise Gate Open | Line ~175 | 0.015 | RMS threshold to open mic |
| Noise Gate Close | Line ~176 | 0.008 | RMS threshold to close mic |
| TTS Volume | Line ~523 | 10.0 | TTS playback volume multiplier |
| LLM Max Tokens | Line ~350 | 150 | Max response length |
| LLM Temperature | Line ~351 | 0.7 | Response creativity |

---

## Troubleshooting Guide

### Issue: No Umi transcriptions

**Symptoms**: `[audio][umi] level ~ -160.0 dB`

**Causes & Solutions**:
1. **BlackHole not receiving audio**
   - Verify Multi-Output Device is set as system output
   - Check Audio MIDI Setup: Multi-Output Device should include both MacBook Speakers and BlackHole 2ch
   - Look for: `[audio][umi] ✓ BlackHole stream obtained`
   - If BlackHole fails, check: `[audio][umi] ⚠️ BlackHole failed`

2. **getDisplayMedia permission denied**
   - Browser will prompt for screen/audio capture permission
   - Grant permission when prompted
   - Check for: `[audio][umi] ✓ getDisplayMedia stream obtained`

3. **Gemini API key missing**
   - Check `secrets.local.json`
   - Look for: `[gemini-stt] No Gemini API key found`

4. **WebSocket connection failed**
   - Check: `[gemini-stt][umi] ws closed: 1007`
   - Verify API key is valid

### Issue: Transcriptions are gibberish (wrong language)

**Cause**: Sample rate mismatch

**Solution**: Ensure native sample rate is used:
```javascript
var audioContext = new AudioContext();  // Don't force sample rate
var mimeType = 'audio/pcm;rate=' + audioContext.sampleRate;
```

### Issue: Umi can't hear the agent

**Symptoms**: TTS plays but Umi doesn't respond

**Cause**: TTS not routed to uplink

**Solution**: Check for:
```
[tts] ✓ TTS audio routed to uplink for Umi
```

If missing, verify `ttsToUplinkSource` is connected to `uplinkDestination`.

### Issue: Agent interrupts Umi

**Cause**: Response timer too short

**Solution**: Increase timer from 3000 to 5000+:
```javascript
responseTimer = setTimeout(function() {
  // ...
}, 5000);  // 5 seconds
```

### Issue: Agent responds to user's voice

**Cause**: User's echo captured as Umi's voice

**Solution**: Filter when user is speaking:
```javascript
var userIsSpeaking = uplinkMicGate.gain.value > 0.1;
if (userIsSpeaking) {
  console.log('[filter] Ignoring (user speaking)');
  return;
}
```

### Debug Logging

Key log prefixes:
- `[audio][umi]` - Umi audio capture
- `[audio][user]` - User mic capture
- `[gemini-stt]` - STT WebSocket
- `[llm]` - LLM response generation
- `[tts]` - TTS playback
- `[uplink]` - Mic mixer
- `[filter]` - Transcription filtering
- `[🔊 UMI VOICE]` - Umi's transcribed speech

---

## API Reference

### startGemini(label, logTag)
Creates a Gemini STT WebSocket connection.

**Parameters**:
- `label`: 'umi' or 'user'
- `logTag`: Display prefix for logs

**Returns**: `{ ws, isReady() }`

### generateLLMResponse(question)
Generates an LLM response to the question.

**Parameters**:
- `question`: String - Umi's question

**Returns**: Promise<String> - Response text

### speakResponse(text)
Speaks text using Gemini TTS.

**Parameters**:
- `text`: String - Text to speak

### playAudioBase64(base64Data, sampleRate)
Plays base64-encoded PCM audio.

**Parameters**:
- `base64Data`: String - Base64 encoded PCM
- `sampleRate`: Number - Sample rate (default 24000)

### ensureUplinkMixer()
Initializes the virtual microphone mixer.

**Returns**: Promise<void>

### captureUmiFromSpeakers()
Captures Umi's audio from system speakers (system audio) using BlackHole or getDisplayMedia. **No DOM APIs are used.**

**Returns**: Promise<MediaStream>

**Methods**:
1. **BlackHole** (primary): Requires Multi-Output Device setup
2. **getDisplayMedia** (fallback): Browser system audio capture

---

## Version History

| Date | Changes |
|------|---------|
| 2026-01-06 | Initial release with Gemini STT/TTS integration |
| 2026-01-06 | Added LiveKit audio capture (bypasses BlackHole) |
| 2026-01-06 | Fixed TTS routing to uplink via MediaStreamDestination |
| 2026-01-06 | Increased response timer to 5 seconds |
| 2026-01-06 | **Changed to speaker-only capture** - Removed DOM-based LiveKit capture, now uses BlackHole/getDisplayMedia for system audio only |

---

## License

Proprietary - Arbor Internal Use Only

