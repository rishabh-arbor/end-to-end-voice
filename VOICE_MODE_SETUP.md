# Voice Mode Setup

## Overview
The Electron app now captures **desktop loopback audio** (what the browser is playing) and sends it to OpenAI Whisper for speech-to-text transcription. This enables full voice-only interview automation.

## Setup Steps

### 1. Get an OpenAI API Key
1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key (starts with `sk-...`)

### 2. Configure secrets.local.json
Add your OpenAI API key to `secrets.local.json`:

```json
{
  "GEMINI_API_KEY": "AIzaSy...",
  "GEMINI_MODEL": "auto",
  "AUTO_GEMINI": "1",
  "AUTO_SUBMIT": "1",
  "AUTO_PROGRESS": "1",
  "INTERVIEW_PASSWORD": "test",
  "OPENAI_API_KEY": "sk-YOUR-ACTUAL-KEY-HERE",
  "ENABLE_STT": "1"
}
```

### 3. Run the Interview
```bash
npm run electron-dev https://interview-staging.findarbor.com/interview/YOUR-INTERVIEW-ID
```

## How It Works

1. **Audio Capture**: 
   - **Default**: Captures microphone audio (your responses)
   - **For System Audio**: Route browser audio through a virtual device like [BlackHole](https://github.com/ExistentialAudio/BlackHole) (macOS) or VB-Cable (Windows)
2. **Audio Processing**: 
   - 16kHz sample rate with noise suppression
   - Buffers 3 seconds of audio
   - Encodes to WAV format
3. **Speech-to-Text**: Sends WAV to OpenAI Whisper API every 3 seconds
4. **Transcript Logging**: Displays transcribed text as `[umi-voice]` in console

### Optional: Capture Umi's Voice (System Audio)
If you want to transcribe what **Umi is saying** (not just your responses):
1. Install [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole/releases) on macOS
2. Create a Multi-Output Device in Audio MIDI Setup that includes both BlackHole and your speakers
3. Set macOS system output to this Multi-Output Device
4. The app will then capture what the browser is playing

## Console Output

You'll see logs like:
- `[audio] ✓ Desktop audio stream captured` - Audio capture started
- `[audio] Chunk #10: 2048 samples, level: -32.5 dB 🔊` - Audio level monitoring
- `[stt] Encoding 48000 samples to WAV...` - Preparing audio for STT
- `[stt] ✓ Transcript: Hi, I'm Umi. It's great to have you.` - Whisper transcription
- `[umi-voice] Hi, I'm Umi. It's great to have you.` - Detected Umi's voice

## Troubleshooting

### No audio capture
- Check macOS System Preferences → Security & Privacy → Screen Recording (Electron needs permission)
- Verify that the interview is actually playing audio

### STT disabled message
- Check that `OPENAI_API_KEY` is set correctly in `secrets.local.json`
- Ensure `ENABLE_STT: "1"` is present
- Restart the Electron app after changing secrets

### API errors
- Verify your OpenAI API key is valid and has credits
- Check network connection
- Look for HTTP error messages in console

## Cost Estimate
- Whisper API: ~$0.006 per minute of audio
- 5-minute interview ≈ $0.03
- Very affordable for testing!

## Next Steps
Once voice transcription is working, you can:
1. Feed `[umi-voice]` transcripts to Gemini (same as text mode)
2. Generate replies using the LLM
3. Type/submit responses automatically

