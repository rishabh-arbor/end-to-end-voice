# Linux Server Deployment - Essential Problems & Solutions

## Overview

This Electron application is designed for **macOS desktop use** with GUI, audio devices, and system-level audio routing. Deploying to a **headless Linux server** presents significant challenges.

---

## Critical Problems

### 1. **No Display Server (Headless Environment)**

**Problem**: 
- Linux servers typically run without a GUI (X11/Wayland)
- Electron requires a display server to render windows
- BrowserWindow cannot be created without a display

**Symptoms**:
```
Error: Cannot open display
Error: No display specified
```

**Solutions**:

#### Option A: Virtual Display (Xvfb)
```bash
# Install Xvfb (X Virtual Framebuffer)
sudo apt-get install xvfb

# Run Electron with virtual display
xvfb-run -a -s "-screen 0 1280x800x24" npm run electron-dev -- <interview-url>
```

#### Option B: X11 Forwarding (SSH)
```bash
# Enable X11 forwarding in SSH
ssh -X user@server

# Set DISPLAY variable
export DISPLAY=:0.0
```

#### Option C: VNC Server
```bash
# Install VNC server
sudo apt-get install tigervnc-standalone-server

# Start VNC
vncserver :1 -geometry 1280x800

# Connect via VNC client
```

**Recommendation**: Use **Xvfb** for headless automation.

---

### 2. **Audio Device Availability**

**Problem**:
- Linux servers have **no physical speakers/microphones**
- System audio routing doesn't exist
- BlackHole (macOS) doesn't exist on Linux

**Current Dependencies**:
- **BlackHole 2ch**: macOS-only virtual audio device
- **Multi-Output Device**: macOS Audio MIDI Setup feature
- **System audio capture**: Requires physical audio hardware

**Solutions**:

#### Option A: PulseAudio Virtual Sink (Linux equivalent of BlackHole)
```bash
# Install PulseAudio
sudo apt-get install pulseaudio pulseaudio-utils

# Create null sink (virtual audio device)
pactl load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual Speaker"

# Route system audio to null sink
pactl set-default-sink virtual_speaker

# Capture from null sink
pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic source_properties=device.description="Virtual Mic"
```

**Code Changes Required**:
```javascript
// In electron-main.js, update device matcher:
matcher: function(d) { 
  return d.label.toLowerCase().includes('virtual') || 
         d.label.toLowerCase().includes('null-sink') ||
         d.label.toLowerCase().includes('remap');
}
```

#### Option B: JACK Audio (More advanced)
```bash
# Install JACK
sudo apt-get install jackd2

# Start JACK daemon
jackd -R -d alsa -d hw:0
```

#### Option C: ALSA Loopback
```bash
# Load ALSA loopback module
sudo modprobe snd-aloop

# Configure ALSA to use loopback
# Edit /etc/asound.conf or ~/.asoundrc
```

**Recommendation**: Use **PulseAudio null sink** (simplest).

---

### 3. **getDisplayMedia API Limitations**

**Problem**:
- `navigator.mediaDevices.getDisplayMedia()` requires:
  - User interaction (cannot be automated)
  - Browser permission dialog
  - Physical display (won't work headless)

**Current Code**:
```javascript
navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })
```

**Solutions**:

#### Option A: Use PulseAudio null sink (recommended)
- Don't rely on `getDisplayMedia`
- Use PulseAudio virtual devices instead

#### Option B: Electron's `desktopCapturer` API
```javascript
// In main process (electron-main.js)
const { desktopCapturer } = require('electron');

const sources = await desktopCapturer.getSources({
  types: ['screen'],
  thumbnailSize: { width: 0, height: 0 }
});

// Find audio source
const audioSource = sources.find(s => s.name.includes('audio'));
```

**Note**: `desktopCapturer` may not capture system audio on Linux without additional setup.

---

### 4. **Electron Resource Usage**

**Problem**:
- Electron is **heavy** for server environments:
  - Full Chromium browser engine
  - GUI rendering (even if headless)
  - Memory: ~200-500MB per instance
  - CPU: Continuous rendering

**Impact**:
- High memory usage
- CPU overhead
- Not ideal for multiple concurrent interviews

**Solutions**:

#### Option A: Use Headless Browser (Puppeteer/Playwright)
```javascript
// Instead of Electron, use Puppeteer
const puppeteer = require('puppeteer');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.goto(interviewUrl);

// Inject automation code
await page.evaluate(automationCode);
```

**Benefits**:
- Lighter weight (~50-100MB)
- Better for server environments
- No display required

**Drawbacks**:
- Need to rewrite audio capture logic
- Web Audio API still works
- Need alternative for system audio capture

#### Option B: Keep Electron but optimize
```javascript
// In electron-main.js
mainWindow = new BrowserWindow({
  show: false,  // Don't show window
  width: 1280,
  height: 800,
  webPreferences: {
    // ... existing config
  }
});
```

---

### 5. **Audio Capture Permissions**

**Problem**:
- Linux requires explicit permissions for audio capture
- PulseAudio may restrict access
- SELinux/AppArmor may block audio access

**Solutions**:

```bash
# Add user to audio group
sudo usermod -a -G audio $USER

# Configure PulseAudio permissions
# Edit /etc/pulse/default.pa or ~/.config/pulse/default.pa
```

**Code Changes**:
```javascript
// Request permissions explicitly
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('Audio permission granted');
  })
  .catch(err => {
    console.error('Audio permission denied:', err);
  });
```

---

### 6. **Sample Rate & Audio Format Compatibility**

**Problem**:
- Linux audio systems may use different sample rates
- PulseAudio default: 44100 Hz (not 48000 Hz)
- Format differences (ALSA vs PulseAudio)

**Solutions**:

```bash
# Configure PulseAudio sample rate
# Edit /etc/pulse/daemon.conf
default-sample-rate = 48000
```

**Code Changes**:
```javascript
// Detect and adapt to system sample rate
var audioContext = new AudioContext();
console.log('System sample rate:', audioContext.sampleRate);

// Use detected rate for Gemini
var mimeType = 'audio/pcm;rate=' + audioContext.sampleRate;
```

---

### 7. **Network & Firewall**

**Problem**:
- Server may have restricted outbound connections
- WebSocket connections to Gemini API
- HTTPS connections

**Solutions**:

```bash
# Allow outbound HTTPS/WebSocket
sudo ufw allow out 443/tcp
sudo ufw allow out 80/tcp

# Test connectivity
curl https://generativelanguage.googleapis.com
```

---

### 8. **Process Management**

**Problem**:
- Electron processes need to stay alive
- No GUI to monitor
- Crash recovery needed

**Solutions**:

#### Use systemd service
```ini
# /etc/systemd/system/arbor-interview.service
[Unit]
Description=Arbor Interview Automation
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/app
Environment="DISPLAY=:99"
Environment="GEMINI_API_KEY=your-key"
ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1280x800x24" /usr/bin/npm run electron-dev -- <url>
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### Use PM2
```bash
npm install -g pm2

pm2 start npm --name "arbor-interview" -- run electron-dev -- <url>
pm2 save
pm2 startup
```

---

## Recommended Architecture for Linux Server

### Option 1: Electron with Xvfb + PulseAudio (Minimal Changes)

**Setup**:
```bash
# Install dependencies
sudo apt-get install xvfb pulseaudio pulseaudio-utils

# Create PulseAudio null sink
pactl load-module module-null-sink sink_name=virtual_speaker
pactl set-default-sink virtual_speaker
pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic

# Run with Xvfb
xvfb-run -a -s "-screen 0 1280x800x24" npm run electron-dev -- <url>
```

**Code Changes**:
- Update device matcher to find "virtual" or "null-sink"
- Remove BlackHole-specific code
- Keep existing Electron code

**Pros**: Minimal code changes
**Cons**: Still heavy (Electron)

---

### Option 2: Puppeteer + PulseAudio (Recommended)

**Setup**:
```bash
# Install Puppeteer dependencies
sudo apt-get install chromium-browser

# Setup PulseAudio (same as above)
```

**Code Changes**:
- Rewrite `electron-main.js` to use Puppeteer
- Keep audio capture logic
- Use Puppeteer's `page.evaluate()` for injection

**Pros**: Lighter, better for servers
**Cons**: Significant rewrite needed

---

### Option 3: Docker Container

**Dockerfile**:
```dockerfile
FROM node:18

# Install dependencies
RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    pulseaudio-utils \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Setup PulseAudio
RUN pactl load-module module-null-sink sink_name=virtual_speaker && \
    pactl set-default-sink virtual_speaker && \
    pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["xvfb-run", "-a", "-s", "-screen 0 1280x800x24", "npm", "run", "electron-dev", "--", "$INTERVIEW_URL"]
```

**Run**:
```bash
docker build -t arbor-interview .
docker run -e GEMINI_API_KEY=xxx -e INTERVIEW_URL=xxx arbor-interview
```

---

## Essential Code Changes Required

### 1. Update Audio Device Detection

**Current (macOS)**:
```javascript
matcher: function(d) { 
  return d.label.toLowerCase().includes('blackhole'); 
}
```

**Linux (PulseAudio)**:
```javascript
matcher: function(d) { 
  return d.label.toLowerCase().includes('virtual') || 
         d.label.toLowerCase().includes('null-sink') ||
         d.label.toLowerCase().includes('remap') ||
         d.label.toLowerCase().includes('monitor');
}
```

### 2. Remove macOS-Specific Code

```javascript
// Remove or conditionally disable:
// - BlackHole references
// - Multi-Output Device setup
// - macOS Audio MIDI Setup references
```

### 3. Add Linux Audio Setup Check

```javascript
// Check if PulseAudio null sink exists
async function checkLinuxAudioSetup() {
  var devices = await navigator.mediaDevices.enumerateDevices();
  var hasVirtual = devices.some(d => 
    d.label.toLowerCase().includes('virtual') ||
    d.label.toLowerCase().includes('null-sink')
  );
  
  if (!hasVirtual) {
    console.error('[audio] PulseAudio null sink not found!');
    console.error('[audio] Run: pactl load-module module-null-sink sink_name=virtual_speaker');
  }
}
```

### 4. Handle Headless Display

```javascript
// In electron-main.js
if (process.env.DISPLAY) {
  mainWindow = new BrowserWindow({ /* ... */ });
} else {
  console.error('No DISPLAY found. Use Xvfb or set DISPLAY variable.');
  process.exit(1);
}
```

---

## Testing Checklist

- [ ] Xvfb/X11 display server working
- [ ] PulseAudio null sink created and accessible
- [ ] Audio devices enumerated correctly
- [ ] Audio capture working (check RMS levels)
- [ ] Gemini API connectivity (WebSocket)
- [ ] TTS audio routing to virtual sink
- [ ] Process stays alive (systemd/PM2)
- [ ] Crash recovery working

---

## Performance Considerations

| Component | macOS Desktop | Linux Server (Electron) | Linux Server (Puppeteer) |
|-----------|---------------|-------------------------|-------------------------|
| Memory | ~200MB | ~300-500MB | ~50-100MB |
| CPU | Low-Medium | Medium-High | Low |
| Display | Native | Xvfb overhead | None (headless) |
| Audio | BlackHole | PulseAudio | PulseAudio |
| Scalability | 1 instance | Limited | Better |

---

## Conclusion

**Primary Challenges**:
1. ✅ **Display**: Use Xvfb
2. ✅ **Audio**: Use PulseAudio null sink
3. ⚠️ **Weight**: Consider Puppeteer instead of Electron
4. ✅ **Permissions**: Configure audio group
5. ✅ **Process**: Use systemd/PM2

**Recommended Path**: 
- Start with **Electron + Xvfb + PulseAudio** (minimal changes)
- Migrate to **Puppeteer** if you need better scalability

