# Interview Bot - Docker Edition

A fully containerized interview bot that automates voice interviews using:
- **Puppeteer** for headless browser automation
- **PulseAudio** for virtual audio routing
- **Gemini Live API** for real-time speech-to-speech conversation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DOCKER CONTAINER                            │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   AUDIO LAYER (PulseAudio)                 │ │
│  │                                                            │ │
│  │   ┌──────────────────┐        ┌──────────────────┐         │ │
│  │   │ virtual_speaker  │◄──────►│   virtual_mic    │         │ │
│  │   │   (output)       │loopback│    (input)       │         │ │
│  │   └────────▲─────────┘        └────────│─────────┘         │ │
│  │            │                           │                   │ │
│  └────────────│───────────────────────────│───────────────────┘ │
│               │ TTS Output                │ Audio Capture       │
│               │                           │                     │
│  ┌────────────│───────────────────────────│───────────────────┐ │
│  │            │       APPLICATION LAYER   │                   │ │
│  │   ┌────────┴────────┐         ┌────────▼────────┐          │ │
│  │   │  TTS Playback   │         │  Audio Capture  │          │ │
│  │   │  (Web Audio)    │         │  (getUserMedia) │          │ │
│  │   └────────▲────────┘         └────────│────────┘          │ │
│  │            │                           │                   │ │
│  │   ┌────────┴───────────────────────────▼────────┐          │ │
│  │   │              LLM CLIENT (Gemini)            │          │ │
│  │   │  • Sends audio via WebSocket                │          │ │
│  │   │  • Receives audio/text response             │          │ │
│  │   │  • Manages conversation state               │          │ │
│  │   └─────────────────────▲───────────────────────┘          │ │
│  └─────────────────────────│──────────────────────────────────┘ │
│                            │                                    │
│  ┌─────────────────────────│──────────────────────────────────┐ │
│  │                         │   BROWSER LAYER (Puppeteer)      │ │
│  │   ┌─────────────────────┴─────────────────────────┐        │ │
│  │   │              Headless Chrome                  │        │ │
│  │   │  ┌─────────────────────────────────────────┐  │        │ │
│  │   │  │          Interview Page                 │  │        │ │
│  │   │  │  Interviewer Audio ──► virtual_speaker  │  │        │ │
│  │   │  │  Your Response    ◄── virtual_speaker   │  │        │ │
│  │   │  └─────────────────────────────────────────┘  │        │ │
│  │   └───────────────────────────────────────────────┘        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ WebSocket / HTTPS
                               ▼
                    ┌───────────────────┐
                    │    Gemini API     │
                    └───────────────────┘
```

## Quick Start

### 1. Set up environment variables

Create a `.env` file:

```bash
# Required
GEMINI_API_KEY=your-gemini-api-key
INTERVIEW_URL=https://interview-site.com/session/abc123

# Optional
INTERVIEW_PASSWORD=your-password
AUDIO_SAMPLE_RATE=16000
TTS_SAMPLE_RATE=24000
LOG_LEVEL=info
TIMEOUT_SECONDS=1800
```

### 2. Build and run with Docker Compose

```bash
# Build the container
docker-compose build

# Run the interview bot
docker-compose up

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### 3. Or run directly with Docker

```bash
# Build
docker build -t interview-bot .

# Run
docker run -it --rm \
  -e GEMINI_API_KEY=your-key \
  -e INTERVIEW_URL=https://interview.example.com/abc \
  --shm-size=2g \
  interview-bot
```

## File Structure

```
docker-arbor/
├── Dockerfile              # Container definition
├── docker-compose.yml      # Orchestration config
├── docker-entrypoint.sh    # PulseAudio setup script
├── package.json            # Node.js dependencies
├── README.md               # This file
│
├── src/
│   ├── index.js            # Main entry point
│   │
│   ├── browser/
│   │   ├── puppeteer-launcher.js  # Browser launch config
│   │   └── page-controller.js     # Page navigation & injection
│   │
│   ├── audio/
│   │   ├── capture.js      # Audio capture from virtual_mic
│   │   ├── playback.js     # Audio playback to virtual_speaker
│   │   └── processor.js    # Audio format conversion
│   │
│   └── llm/
│       ├── client.js       # Gemini WebSocket client
│       └── conversation.js # Conversation state management
│
└── scripts/
    └── injected-automation.js  # Script injected into interview page
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | ✅ | - | Your Gemini API key |
| `INTERVIEW_URL` | ✅ | - | URL of the interview session |
| `INTERVIEW_PASSWORD` | ❌ | - | Password for the interview (if required) |
| `AUDIO_SAMPLE_RATE` | ❌ | 16000 | Input audio sample rate (Hz) |
| `TTS_SAMPLE_RATE` | ❌ | 24000 | TTS output sample rate (Hz) |
| `LOG_LEVEL` | ❌ | info | Logging level (debug, info, warn, error) |
| `TIMEOUT_SECONDS` | ❌ | 1800 | Max interview duration (30 min) |
| `DEBUG` | ❌ | 0 | Enable debug mode (1 to enable) |

## How It Works

### Audio Flow

1. **Capture Interviewer Audio**
   - Interview page plays audio → `virtual_speaker`
   - PulseAudio loopback → `virtual_mic`
   - `getUserMedia()` captures from `virtual_mic`
   - Audio is sent to Gemini for transcription

2. **Generate Response**
   - Gemini transcribes interviewer's question
   - LLM generates a response
   - Gemini converts response to speech (TTS)

3. **Play Response**
   - TTS audio received from Gemini
   - Played via Web Audio API → `virtual_speaker`
   - Interview page hears the response via its mic input

### Automation Features

- **Auto-fill password**: Detects and fills password fields
- **Auto-click buttons**: Clicks "Get Started", "Continue", etc.
- **Language selection**: Auto-selects English if dropdown present
- **Turn management**: Waits for interviewer to finish before responding
- **Cooldown period**: Prevents echo/feedback loops

## Troubleshooting

### Container won't start

Check Docker logs:
```bash
docker-compose logs
```

### Audio not working

Verify PulseAudio setup:
```bash
docker-compose exec interview-bot pactl list sinks short
docker-compose exec interview-bot pactl list sources short
```

### Browser issues

Enable debug logging:
```bash
LOG_LEVEL=debug docker-compose up
```

### Out of memory

Increase shared memory:
```yaml
# In docker-compose.yml
shm_size: '4gb'
```

## Health Check

The container exposes a health endpoint:

```bash
curl http://localhost:3000/health
```

Returns:
```json
{"status": "ok", "timestamp": "2024-01-15T10:30:00.000Z"}
```

## License

MIT

