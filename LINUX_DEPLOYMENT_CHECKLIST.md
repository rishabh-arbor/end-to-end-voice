# Linux Deployment Checklist - Add/Remove Items

## ✅ ADD (Install/Setup)

### System Packages
- [ ] **Xvfb** - Virtual display server (replaces macOS display)
- [ ] **PulseAudio** - Audio system (replaces macOS Audio MIDI Setup)
- [ ] **PulseAudio utils** - Command-line tools for audio
- [ ] **Chromium** - Browser engine for Electron
- [ ] **Audio libraries** - libasound2, libnss3, etc.

### Audio Configuration
- [ ] **PulseAudio null sink** - Virtual audio output device (replaces BlackHole)
- [ ] **PulseAudio remap source** - Virtual audio input device (replaces BlackHole input)
- [ ] **Audio group membership** - Add user to `audio` group

### Process Management
- [ ] **systemd service file** - OR
- [ ] **PM2** - Process manager

### Environment Setup
- [ ] **DISPLAY variable** - Set to `:99` for Xvfb
- [ ] **PULSE_RUNTIME_PATH** - PulseAudio runtime path
- [ ] **Xvfb process** - Running on display :99

### Firewall Rules
- [ ] **Outbound HTTPS** - Port 443 for Gemini API
- [ ] **Outbound HTTP** - Port 80 (if needed)

---

## ❌ REMOVE (Not Needed on Linux)

### macOS-Specific Items
- [ ] **BlackHole 2ch** - Not available on Linux
- [ ] **Multi-Output Device** - macOS Audio MIDI Setup feature
- [ ] **Audio MIDI Setup configuration** - macOS-only
- [ ] **macOS system audio routing** - Different on Linux

### macOS Dependencies
- [ ] **BlackHole installation** - Not needed
- [ ] **Multi-Output Device setup** - Not needed
- [ ] **macOS audio permissions** - Different on Linux

---

## 🔄 REPLACE (Linux Equivalents)

| macOS Item | Linux Replacement |
|------------|-------------------|
| BlackHole 2ch | PulseAudio null sink |
| Multi-Output Device | PulseAudio sink routing |
| Audio MIDI Setup | PulseAudio CLI (`pactl`) |
| System Preferences → Sound | PulseAudio configuration |
| Native display | Xvfb (virtual display) |

---

## 📝 CONFIGURE (Settings to Change)

### Audio Device Names
- **macOS**: Looks for "blackhole"
- **Linux**: Looks for "virtual", "null-sink", "remap", "monitor"

### Display Server
- **macOS**: Native display
- **Linux**: Xvfb on `:99`

### Audio System
- **macOS**: CoreAudio
- **Linux**: PulseAudio

### Process Management
- **macOS**: Can run directly
- **Linux**: Needs systemd/PM2 for production

---

## 🚫 NO CODE CHANGES NEEDED

The code already handles platform detection automatically:
- Detects macOS vs Linux
- Uses appropriate audio device matcher
- Falls back to getDisplayMedia if needed

**You only need to:**
1. Install Linux packages
2. Setup PulseAudio virtual devices
3. Configure environment variables
4. Run with Xvfb

