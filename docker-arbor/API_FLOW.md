# Interview Bot - Complete API Flow

## Overview
This document describes the complete API flow from Docker container startup to real-time conversation between the bot and Umi (the interviewer).

---

## 1. Container Startup & Initialization

### 1.1 Docker Entrypoint (`docker-entrypoint.sh`)
```
┌─────────────────────────────────────────────────────────┐
│ 1. Start Xvfb (virtual display)                         │
│ 2. Start PulseAudio daemon                              │
│ 3. Create virtual_speaker (sink)                        │
│ 4. Create virtual_mic (source from virtual_speaker)     │
│ 5. Start VNC server (port 5900)                         │
│ 6. Start noVNC web server (port 6080)                  │
│ 7. Execute main application (src/index.js)              │
└─────────────────────────────────────────────────────────┘
```

**PulseAudio Setup:**
- **virtual_speaker**: Audio sink (where TTS audio is played)
- **virtual_mic**: Audio source (monitors virtual_speaker, what browser captures)
- **module-remap-source**: Creates virtual_mic from virtual_speaker.monitor

---

## 2. Application Initialization (`src/index.js`)

### 2.1 Main Flow
```
main()
  ├─> initializeLogger()
  ├─> validateConfig()
  ├─> initializeHealthServer() → HTTP server on port 3000
  ├─> setupTimeout() → Auto-shutdown after timeout
  ├─> initializeBrowser() → Launch Chromium via Puppeteer
  ├─> setupAudioDevices() → Grant audio permissions
  ├─> navigateToInterview() → Navigate to interview URL
  ├─> initializeLLMClient() → Create Gemini WebSocket client
  ├─> initializeConversation() → Create conversation manager
  └─> injectAutomation() → Inject browser automation script
```

### 2.2 Health Server
- **Port**: 3000
- **Endpoints**:
  - `GET /health` → Health check status
  - `GET /ready` → Readiness status

---

## 3. Browser Launch (`src/browser/puppeteer-launcher.js`)

### 3.1 Chromium Configuration
```
Launch Chromium with:
  - Headless: false (for VNC viewing)
  - Audio: Enabled
  - WebRTC: Enabled
  - Flags:
    --use-fake-ui-for-media-stream (auto-grant permissions)
    --disable-features=WebRtcAecDump,AudioServiceOutOfProcess
    --disable-rtc-smoothness-algorithm
    --disable-webrtc-hw-encoding
    --disable-webrtc-hw-decoding
```

---

## 4. Page Navigation (`src/browser/page-controller.js`)

### 4.1 Navigation Flow
```
navigateToInterview()
  ├─> setupConsoleForwarding() → Forward console.log to Node.js
  ├─> setupErrorHandling() → Forward page errors
  └─> page.goto(url) → Navigate to interview URL
```

### 4.2 Audio Device Setup
```
setupAudioDevices()
  └─> page.grantPermissions(['microphone', 'camera'])
      → Grant permissions for interview domain
```

---

## 5. Script Injection (`src/browser/page-controller.js`)

### 5.1 Injection Process
```
injectAutomation()
  ├─> Read injected-automation.js file
  ├─> Replace placeholders:
  │   - __PASSWORD__ → config.interview.password
  │   - __GEMINI_API_KEY__ → config.gemini.apiKey
  ├─> Expose Node.js bridge functions:
  │   - window.__arborLog() → Log from browser to Node.js
  │   - window.__arborPlayAudio() → Play TTS via paplay
  │   - window.__arborPlayTTSToWebRTC() → Inject TTS into WebRTC
  └─> page.evaluate() → Execute script in browser context
```

---

## 6. Browser-Side Automation (`scripts/injected-automation.js`)

### 6.1 Initialization
```
Script starts:
  ├─> Auto-click automation (Get Started, Continue buttons)
  ├─> Fill password field
  ├─> Select language (English)
  ├─> Intercept getUserMedia() → Force virtual_mic device
  ├─> Intercept RTCPeerConnection → Capture WebRTC tracks
  └─> Wait for interview to be ready
```

### 6.2 Audio Capture Setup
```
startAudioCapture()
  ├─> navigator.mediaDevices.getUserMedia({ audio: true })
  │   └─> Intercepted → Forces virtual_mic device
  ├─> Create AudioContext (sampleRate: 44100)
  ├─> Create AudioWorkletNode (capture-processor.js)
  ├─> Connect microphone stream → Worklet
  └─> Worklet processes audio → PCM → Base64 → Send to STT
```

**Audio Flow (Capture):**
```
Umi speaks → Browser WebRTC captures → virtual_mic (PulseAudio)
  → AudioContext → AudioWorklet → PCM (16-bit, 44100Hz)
  → Base64 encode → Send to Gemini STT WebSocket
```

---

## 7. Gemini API Connections

### 7.1 STT (Speech-to-Text) WebSocket
```
Location: scripts/injected-automation.js

Connection:
  ws://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=API_KEY

Setup Message:
{
  "setup": {
    "model": "models/gemini-2.0-flash-live-001",
    "generation_config": {
      "response_modalities": ["TEXT"],  // STT only, no audio response
      "input_audio_transcription": {}
    }
  }
}

Audio Message Format:
{
  "audio": {
    "data": "<base64-encoded-PCM>",
    "format": "pcm",
    "sampleRate": 44100
  }
}

Response:
{
  "serverContent": {
    "inputTranscription": {
      "text": "transcribed text here"
    }
  }
}
```

### 7.2 TTS (Text-to-Speech) WebSocket
```
Location: scripts/injected-automation.js

Connection: Same endpoint as STT, but separate WebSocket instance

Setup Message:
{
  "setup": {
    "model": "models/gemini-2.0-flash-live-001",
    "generation_config": {
      "response_modalities": ["AUDIO", "TEXT"],
      "speech_config": {
        "voice_config": {
          "prebuilt_voice_config": {
            "voice_name": "Puck"
          }
        }
      }
    }
  }
}

Text Message Format:
{
  "text": "Response text to convert to speech"
}

Response:
{
  "serverContent": {
    "modelTurn": {
      "parts": [
        {
          "inlineData": {
            "mimeType": "audio/pcm",
            "data": "<base64-encoded-PCM>"
          }
        }
      ]
    }
  }
}
```

---

## 8. Conversation Flow

### 8.1 Umi Speaks → Bot Listens
```
┌─────────────────────────────────────────────────────────┐
│ 1. Umi speaks in browser                                 │
│ 2. Browser WebRTC captures audio from virtual_mic        │
│ 3. AudioWorklet processes audio chunks (2s each)         │
│ 4. PCM → Base64 → Send to STT WebSocket                 │
│ 5. Gemini transcribes → Returns text                    │
│ 6. Script logs: "📝 Interviewer: <transcription>"        │
│ 7. Conversation manager accumulates transcript          │
│ 8. After 5s silence → Generate response                 │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Bot Responds → Umi Hears
```
┌─────────────────────────────────────────────────────────┐
│ 1. Conversation manager creates response prompt         │
│ 2. Send text to TTS WebSocket                           │
│ 3. Gemini generates audio response (PCM, 24000Hz)      │
│ 4. Script receives base64 audio chunks                 │
│ 5. Queue audio chunks for sequential playback          │
│ 6. Play via paplay → virtual_speaker                   │
│ 7. PulseAudio loopback: virtual_speaker → virtual_mic  │
│ 8. Browser WebRTC captures from virtual_mic            │
│ 9. Umi hears the response                               │
└─────────────────────────────────────────────────────────┘
```

**Audio Flow (Playback):**
```
Gemini TTS → Base64 PCM (24000Hz) → Decode → paplay
  → virtual_speaker (PulseAudio sink)
  → virtual_speaker.monitor (PulseAudio source)
  → virtual_mic (remap-source)
  → Browser WebRTC input
  → Umi hears response
```

---

## 9. Conversation Manager (`src/llm/conversation.js`)

### 9.1 State Management
```
State Variables:
  - transcriptBuffer: Accumulates interviewer speech
  - isWaitingForResponse: Prevents duplicate responses
  - isTTSPlaying: Prevents echo from speaker
  - history: Conversation turn history
  - responseTimer: Triggers response after silence
  - cooldownTimer: Prevents immediate re-response
```

### 9.2 Turn-Taking Logic
```
1. Interviewer speaks → Transcription received
2. Reset responseTimer
3. Accumulate transcriptBuffer
4. After 5s silence → responseTimer fires
5. Generate response → Send to TTS WebSocket
6. TTS audio received → Play via paplay
7. After playback → 15s cooldown
8. Ready for next question
```

### 9.3 Response Generation
```
generateResponse(question)
  ├─> createResponsePrompt(question)
  │   └─> Returns: "Based on the interviewer's question: \"{question}\", 
  │                 please provide a concise and natural interview response."
  ├─> llmClient.sendText(prompt)
  └─> Wait for audio response
```

---

## 10. Audio Playback (`scripts/injected-automation.js`)

### 10.1 Playback Queue
```
playAudioBase64(base64Data, sampleRate)
  ├─> Push to playbackQueue
  └─> If not playing → playNextFromQueue()

playNextFromQueue()
  ├─> Decode base64 → PCM buffer
  ├─> PRIMARY: paplay → virtual_speaker
  │   └─> window.__arborPlayAudio(pcmData, sampleRate)
  │       → Node.js spawns: paplay --device=virtual_speaker
  ├─> FALLBACK: WebRTC injection (if paplay fails)
  │   └─> window.__arborPlayTTSToWebRTC(pcmData, sampleRate)
  │       → Replace WebRTC audio track with TTS audio
  └─> After playback → Continue queue or start cooldown
```

### 10.2 Node.js Bridge (`src/browser/page-controller.js`)
```
window.__arborPlayAudio exposed via:
  page.exposeFunction('__arborPlayAudio', async (base64Data, sampleRate) => {
    const pcmBuffer = Buffer.from(base64Data, 'base64');
    const child = spawn('paplay', [
      '--device=virtual_speaker',
      '--rate=' + sampleRate,
      '--format=s16le',
      '--channels=1'
    ]);
    child.stdin.write(pcmBuffer);
    child.stdin.end();
  });
```

---

## 11. WebRTC Interception (`scripts/injected-automation.js`)

### 11.1 getUserMedia Interception
```
Original: navigator.mediaDevices.getUserMedia()
Intercepted to:
  1. Enumerate devices → Find virtual_mic
  2. Force deviceId: { exact: virtual_mic.deviceId }
  3. Disable audio processing:
     - echoCancellation: false
     - noiseSuppression: false
     - autoGainControl: false
  4. Call original getUserMedia with modified constraints
  5. Capture audio track for potential replacement
```

### 11.2 RTCPeerConnection Interception
```
Intercept:
  - RTCPeerConnection.prototype.addTrack
  - RTCPeerConnection.prototype.addTransceiver
  - RTCPeerConnection.prototype.setLocalDescription

Purpose:
  - Capture WebRTC audio tracks
  - Optionally inject TTS audio into WebRTC stream
  - Monitor WebRTC connection state
```

---

## 12. Error Handling & Recovery

### 12.1 WebSocket Reconnection
```
STT/TTS WebSocket closes:
  ├─> Attempt reconnection (max 5 attempts)
  ├─> Delay: 3s between attempts
  └─> If all fail → Log error, continue with existing connection
```

### 12.2 Audio Capture Errors
```
Audio capture fails:
  ├─> Log error
  ├─> Attempt to restart capture
  └─> If persistent → Continue without capture (bot won't hear)
```

### 12.3 TTS Playback Errors
```
paplay fails:
  ├─> Fallback to WebRTC injection
  └─> If both fail → Log error, continue
```

---

## 13. Complete End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    INTERVIEW BOT FLOW                           │
└─────────────────────────────────────────────────────────────────┘

START
  │
  ├─> Docker starts → PulseAudio setup → Browser launch
  │
  ├─> Navigate to interview URL
  │
  ├─> Inject automation script
  │
  ├─> Auto-click: Get Started → Password → Language → Start Interview
  │
  ├─> Interview ready → Start audio capture
  │
  └─> LOOP: Conversation
      │
      ├─> [Umi speaks]
      │   │
      │   ├─> Browser captures from virtual_mic
      │   │
      │   ├─> AudioWorklet → PCM → Base64
      │   │
      │   ├─> STT WebSocket → Gemini API
      │   │
      │   ├─> Gemini transcribes → Returns text
      │   │
      │   └─> Conversation manager accumulates transcript
      │
      ├─> [5s silence detected]
      │   │
      │   ├─> Generate response prompt
      │   │
      │   ├─> TTS WebSocket → Gemini API
      │   │
      │   ├─> Gemini generates audio response
      │   │
      │   ├─> Receive base64 audio chunks
      │   │
      │   ├─> Queue for playback
      │   │
      │   ├─> paplay → virtual_speaker
      │   │
      │   ├─> PulseAudio loopback → virtual_mic
      │   │
      │   ├─> Browser WebRTC captures → Umi hears
      │   │
      │   └─> 15s cooldown → Ready for next question
      │
      └─> [Repeat until interview ends or timeout]
```

---

## 14. Key APIs Used

### 14.1 Google Gemini Live API
- **Endpoint**: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`
- **Authentication**: Query parameter `?key=API_KEY`
- **Protocol**: WebSocket (bidirectional)
- **Models**:
  - STT: `models/gemini-2.0-flash-live-001` (TEXT response)
  - TTS: `models/gemini-2.0-flash-live-001` (AUDIO + TEXT response)
- **Voice**: `Puck` (prebuilt voice)

### 14.2 PulseAudio
- **virtual_speaker**: Sink for TTS playback
- **virtual_mic**: Source for browser capture (monitors virtual_speaker)
- **Commands**: `paplay`, `pactl`

### 14.3 Puppeteer
- **Browser**: Chromium (headless: false)
- **Page**: Single page for interview
- **API**: `page.goto()`, `page.evaluate()`, `page.exposeFunction()`

### 14.4 WebRTC
- **getUserMedia**: Capture audio from virtual_mic
- **RTCPeerConnection**: LiveKit WebRTC for interview audio
- **AudioTrack**: Microphone input track

---

## 15. Data Formats

### 15.1 Audio Format (Capture)
- **Format**: PCM (16-bit signed integer, little-endian)
- **Sample Rate**: 44100 Hz
- **Channels**: 1 (mono)
- **Chunk Duration**: 2000ms
- **Encoding**: Base64 for WebSocket transmission

### 15.2 Audio Format (Playback)
- **Format**: PCM (16-bit signed integer, little-endian)
- **Sample Rate**: 24000 Hz (from Gemini TTS)
- **Channels**: 1 (mono)
- **Encoding**: Base64 from Gemini API

### 15.3 WebSocket Messages
- **Format**: JSON
- **Setup**: `{ setup: { ... } }`
- **Audio**: `{ audio: { data: "<base64>", format: "pcm", sampleRate: 44100 } }`
- **Text**: `{ text: "..." }`
- **Response**: `{ serverContent: { ... } }`

---

## 16. Configuration

### 16.1 Environment Variables
```bash
INTERVIEW_URL=https://interview-staging.findarbor.com/interview/...
INTERVIEW_PASSWORD=...
GEMINI_API_KEY=...
TIMEOUT_SECONDS=3600
LOG_LEVEL=info
HEALTH_PORT=3000
```

### 16.2 Timing Configuration
- **Response Delay**: 5000ms (wait for silence before responding)
- **Cooldown**: 15000ms (wait after TTS playback)
- **Audio Chunk**: 2000ms
- **Auto-click Interval**: 2000ms

---

## 17. Troubleshooting Points

### 17.1 Audio Not Flowing
- Check PulseAudio: `pactl list sources short` → Should see `virtual_mic`
- Check browser device: Logs should show "✓ Found virtual_mic"
- Check loopback: `pactl list modules short | grep loopback`

### 17.2 WebSocket Issues
- Check API key: Logs should show "API key length: 39"
- Check connection: Logs should show "WebSocket connected"
- Check setup: Logs should show "Setup complete"

### 17.3 TTS Not Playing
- Check paplay: Logs should show "PRIMARY: Playing via paplay"
- Check queue: Logs should show "playNextFromQueue called"
- Check PulseAudio sink: `pactl list sinks short` → Should see `virtual_speaker`

---

## Summary

The interview bot orchestrates a complex real-time audio conversation:
1. **Captures** Umi's speech via browser WebRTC → PulseAudio virtual_mic
2. **Transcribes** via Gemini STT WebSocket
3. **Generates** response via Gemini TTS WebSocket
4. **Plays** TTS via paplay → PulseAudio virtual_speaker
5. **Loops back** audio via PulseAudio → virtual_mic → Browser WebRTC → Umi hears

The entire flow is automated, with the bot handling turn-taking, silence detection, and audio routing to create a seamless interview experience.

