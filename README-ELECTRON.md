# Electron Interview Automation

Cross-platform interview automation with real-time audio capture and Gemini AI responses.

## Features

- ✅ **Cross-platform** (Mac, Windows, Linux)
- ✅ **Real-time audio capture** (no virtual audio device needed)
- ✅ **Auto-fill** password and language
- ✅ **Auto-progress** through interview screens
- ✅ **Gemini AI** generates responses
- ✅ **Human-like typing** with randomization
- ✅ **Auto-submit** responses

## Installation

```bash
npm install
```

## Configuration

Edit `secrets.local.json`:

```json
{
  "GEMINI_API_KEY": "your-key-here",
  "GEMINI_MODEL": "auto",
  "AUTO_GEMINI": "1",
  "AUTO_SUBMIT": "1",
  "AUTO_PROGRESS": "1",
  "INTERVIEW_PASSWORD": "test",
  "INTERVIEW_URL": "https://interview-staging.findarbor.com/interview/YOUR_ID"
}
```

## Usage

### Run with interview URL

```bash
npm run electron https://interview-staging.findarbor.com/interview/YOUR_ID
```

### Run with URL from secrets.local.json

```bash
npm run electron
```

### Run in debug mode (shows DevTools)

```bash
npm run electron-dev https://interview-staging.findarbor.com/interview/YOUR_ID
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON APP                             │
│                                                             │
│  Embedded Browser                                           │
│       │                                                     │
│       ├─▶ Shows interview                                   │
│       ├─▶ desktopCapturer API → Captures Umi's audio       │
│       ├─▶ Detects Umi's questions                          │
│       ├─▶ Calls Gemini (via IPC)                           │
│       ├─▶ Types response (human-like)                      │
│       └─▶ Auto-submits                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Automation Flow

1. **Load interview** in embedded browser
2. **Auto-fill** password ("test")
3. **Auto-select** language (English)
4. **Click** "Start"/"Continue" buttons
5. **Detect** Umi's questions (text ending with "?")
6. **Capture** audio in real-time (optional)
7. **Call** Gemini with question
8. **Type** response with human-like speed (50-80ms per char)
9. **Submit** via Enter key
10. **Repeat** for all questions

## Audio Capture

The Electron app uses `desktopCapturer` API to capture audio directly from the browser tab—**no virtual audio device needed**.

Future: integrate real-time STT (Whisper/Deepgram) to transcribe Umi's voice in addition to text detection.

## Differences from Puppeteer Version

| Feature | Puppeteer | Electron |
|---------|-----------|----------|
| OS Support | Mac/Linux/Win | Mac/Linux/Win |
| Audio Capture | Needs BlackHole (Mac only) | Built-in `desktopCapturer` |
| Setup | Complex (virtual audio) | Simple (`npm install`) |
| Distribution | Run script | Packaged app |
| Performance | External browser | Embedded browser |

## Building Standalone App (Optional)

To package as a standalone executable:

```bash
npm install --save-dev electron-builder
npx electron-builder --mac
# or
npx electron-builder --win
npx electron-builder --linux
```

This creates a double-click app users can run without Node/npm.

