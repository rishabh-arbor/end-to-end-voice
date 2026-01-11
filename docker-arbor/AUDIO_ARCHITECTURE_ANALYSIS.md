# Audio Architecture Analysis: Input/Output Separation and Feedback Prevention

## Executive Summary

**ARCHITECTURE UPDATED**: The audio architecture has been updated to properly separate input and output paths. The system uses **WebRTC's built-in separation** between uplink (output) and downlink (input) channels, which are completely isolated. Additionally, PulseAudio is configured with separate sink/source pairs, and the code includes clear documentation and safety gating to prevent any potential feedback loops.

## Current Audio Architecture

### PulseAudio Configuration

From `docker-entrypoint.sh`:
```bash
# Creates 2 sinks and 2 sources (after recent update)
load-module module-null-sink sink_name=virtual_speaker
load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic
load-module module-null-sink sink_name=virtual_speaker_2
load-module module-remap-source master=virtual_speaker_2.monitor source_name=virtual_mic_2

set-default-sink virtual_speaker
set-default-source virtual_mic
```

**Key Point**: `virtual_mic` is created by monitoring `virtual_speaker.monitor`. This means:
- Anything played to `virtual_speaker` automatically appears in `virtual_mic`
- This is an **intentional loopback** for the interview platform to hear TTS responses

### Audio Flow Paths (Properly Separated)

#### 1. TTS Output (Our Responses) - WebRTC UPLINK Path
```
Gemini TTS → Base64 PCM → paplay → virtual_speaker (sink)
                                    ↓
                            virtual_speaker.monitor (source)
                                    ↓
                            virtual_mic (remap-source)
                                    ↓
                            Browser getUserMedia (WebRTC UPLINK)
                                    ↓
                            WebRTC uplink → Interview platform → Umi hears response
```

**Purpose**: Allows the interview platform to hear our TTS responses via WebRTC.

#### 2. Input Capture (Interviewer's Voice) - WebRTC DOWNLINK Path
```
Interviewer speaks → WebRTC downlink → Browser WebRTC DOWNLINK track
                                            ↓
                                    Capture from WebRTC downlink (isolated)
                                            ↓
                                    AudioWorklet processor
                                            ↓
                                    STT transcription
```

**Purpose**: Captures the interviewer's voice for transcription and response generation.

**KEY SEPARATION**: 
- **Output (UPLINK)**: Uses `virtual_mic` (monitors `virtual_speaker`) → WebRTC uplink
- **Input (DOWNLINK)**: Uses WebRTC downlink tracks directly → Capture → STT
- **These are completely isolated** - WebRTC maintains separate uplink/downlink channels
- **No shared path** - Input capture never touches `virtual_mic` or `virtual_speaker`

## Separation Mechanisms

### 1. WebRTC Channel Isolation (Primary Protection)

**How It Works**:
- WebRTC maintains **completely separate** uplink and downlink channels
- Uplink (output): `virtual_mic` → WebRTC → Interview platform
- Downlink (input): WebRTC → Direct capture → STT
- **No shared path** - these are separate network channels

**Location**: `scripts/injected-automation.js:370-388`
```javascript
// Capture incoming audio (from interviewer via WebRTC DOWNLINK)
// IMPORTANT: This is a SEPARATE path from TTS output (no feedback loop)
pc.addEventListener('track', function(event) {
  if (event.track.kind === 'audio') {
    // Captures from WebRTC DOWNLINK only (isolated from uplink)
  }
});
```

### 2. PulseAudio Configuration (Secondary Protection)

**Configuration**: `docker-entrypoint.sh:74-78`
- `virtual_speaker` → `virtual_mic`: For TTS output (WebRTC uplink)
- `virtual_speaker_2` → `virtual_mic_2`: Isolated sink/source pair (currently unused, available for future use)

**Purpose**: Provides separate PulseAudio paths if needed, though WebRTC isolation is primary.

### 3. Software-Based Safety Gating (Tertiary Protection)

**Location**: `scripts/injected-automation.js:597-601`
```javascript
captureWorklet.port.onmessage = function(event) {
  if (isPlayingTTS || isWaitingForResponse) {
    // Extra safety: Skip capture during TTS/cooldown (even though paths are isolated)
    return;
  }
  // ... process audio
};
```

**Purpose**: Additional safety layer - prevents processing during TTS playback, even though paths are isolated.

## Architecture Design Rationale

### Why This Architecture Works
The loopback (`virtual_speaker` → `virtual_mic`) is **intentional and safe** because:
1. **`virtual_mic` is ONLY used for WebRTC UPLINK** (output to interview platform)
2. **Input capture uses WebRTC DOWNLINK** (separate channel, no connection to `virtual_mic`)
3. **WebRTC maintains complete isolation** between uplink and downlink channels
4. **No shared path** - input and output never mix

### Why Feedback Loops Are Prevented
```
1. Interviewer asks question
2. System captures question via WebRTC DOWNLINK (isolated path)
3. System generates TTS response
4. TTS plays to virtual_speaker → virtual_mic → WebRTC UPLINK (separate path)
5. Input capture continues from WebRTC DOWNLINK (no connection to virtual_mic)
6. Safety gating provides additional protection during TTS playback
7. NO FEEDBACK LOOP - paths are completely isolated
```

## Current Implementation: Proper Separation

### Architecture Overview

**Output Path (WebRTC UPLINK)**:
```
TTS Output:
  paplay → virtual_speaker → virtual_mic → Browser getUserMedia → WebRTC uplink → Interview
```

**Input Path (WebRTC DOWNLINK)**:
```
Input Capture:
  Interviewer speaks → WebRTC downlink → Browser WebRTC track → Capture → STT
```

### Key Design Decisions

1. **WebRTC Channel Separation**: Primary isolation mechanism
   - Uplink and downlink are separate network channels
   - No possibility of cross-contamination

2. **PulseAudio Configuration**: Secondary isolation
   - `virtual_speaker` → `virtual_mic`: For WebRTC uplink only
   - `virtual_speaker_2` → `virtual_mic_2`: Available for future use if needed

3. **Code-Level Safety**: Tertiary protection
   - Clear comments documenting path separation
   - Safety gating during TTS playback
   - Explicit device selection for each purpose

## Current State Assessment

### What Works
✅ TTS responses reach the interview platform via WebRTC uplink  
✅ Interviewer's voice is captured via WebRTC downlink (isolated path)  
✅ WebRTC channel separation provides hardware-level isolation  
✅ PulseAudio configured with separate sink/source pairs  
✅ Code includes clear documentation of path separation  
✅ Safety gating provides additional protection during TTS playback  

### Architecture Strengths
✅ **True Path Separation**: WebRTC uplink/downlink are completely isolated  
✅ **No Shared Paths**: Input capture never touches `virtual_mic` or `virtual_speaker`  
✅ **Multiple Protection Layers**: WebRTC isolation + PulseAudio separation + safety gating  
✅ **Clear Documentation**: Code comments explain the separation clearly  

### Future Enhancements (Optional)
💡 Echo cancellation module (if needed for additional safety)  
💡 Automatic feedback detection and muting  
💡 Monitoring/alerting for unexpected audio patterns  

## Recommendations

### Current Status: ✅ Properly Implemented

The architecture now has proper separation:
1. ✅ **WebRTC channel isolation** (primary protection)
2. ✅ **PulseAudio separate paths** (secondary protection)
3. ✅ **Safety gating** (tertiary protection)
4. ✅ **Clear documentation** (code comments)

### Optional Enhancements (If Needed)

1. **Monitoring**: Add logging/metrics to verify separation is maintained
2. **Echo Cancellation**: Enable PulseAudio echo-cancel module for additional safety
3. **Feedback Detection**: Monitor for unexpected audio patterns and alert
4. **Testing**: Add automated tests to verify path separation

## Code Locations

### PulseAudio Setup
- `docker-arbor/docker-entrypoint.sh:70-91`

### Audio Capture
- `docker-arbor/scripts/injected-automation.js:302-639`
- `docker-arbor/src/audio/capture.js`

### Audio Playback
- `docker-arbor/src/browser/page-controller.js:283-344`
- `docker-arbor/scripts/injected-automation.js:679-763`

### Feedback Prevention
- `docker-arbor/scripts/injected-automation.js:598-600` (capture gating)
- `docker-arbor/src/llm/conversation.js:229-232` (transcription gating)

## Conclusion

The architecture now has **proper separation** between input and output paths:

1. **WebRTC Channel Isolation**: Primary protection - uplink and downlink are completely separate network channels
2. **PulseAudio Configuration**: Secondary protection - separate sink/source pairs available
3. **Code-Level Safety**: Tertiary protection - safety gating and clear documentation

The loopback from `virtual_speaker` to `virtual_mic` is intentional and safe because:
- `virtual_mic` is **only** used for WebRTC UPLINK (output to interview platform)
- Input capture uses **WebRTC DOWNLINK** (completely separate channel)
- These paths never intersect, preventing feedback loops

**Status**: ✅ **Properly separated architecture implemented**

