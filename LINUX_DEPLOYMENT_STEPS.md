# Linux Deployment Steps - Complete Guide

## Prerequisites

- Ubuntu/Debian Linux server (or similar)
- Node.js 18+ installed
- Root/sudo access
- Internet connectivity for Gemini API

---

## Step 1: Install System Dependencies

### 1.1 Update System Packages
```bash
sudo apt-get update
sudo apt-get upgrade -y
```

### 1.2 Install Required Packages
```bash
# Xvfb (virtual display for Electron)
sudo apt-get install -y xvfb

# PulseAudio (virtual audio device)
sudo apt-get install -y pulseaudio pulseaudio-utils

# Chromium (for Electron/Puppeteer)
sudo apt-get install -y chromium-browser

# Additional dependencies
sudo apt-get install -y \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2
```

---

## Step 2: Setup PulseAudio Virtual Audio Device

### 2.1 Create Null Sink (Virtual Speaker)
```bash
# Load null sink module (creates virtual audio output)
pactl load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual Speaker"

# Set it as default output (optional - only if you want ALL system audio to go there)
# pactl set-default-sink virtual_speaker
```

### 2.2 Create Remap Source (Virtual Microphone)
```bash
# Create virtual microphone that captures from the null sink
pactl load-module module-remap-source \
    master=virtual_speaker.monitor \
    source_name=virtual_mic \
    source_properties=device.description="Virtual Microphone"
```

### 2.3 Verify Setup
```bash
# List audio sources (should see "Virtual Microphone")
pactl list sources short | grep virtual

# List audio sinks (should see "virtual_speaker")
pactl list sinks short | grep virtual
```

### 2.4 Make Persistent (Optional)
To make PulseAudio modules load on boot, edit `/etc/pulse/default.pa`:

```bash
sudo nano /etc/pulse/default.pa
```

Add at the end:
```
# Load virtual audio devices for interview automation
load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual Speaker"
load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic source_properties=device.description="Virtual Microphone"
```

---

## Step 3: Setup Application

### 3.1 Clone/Download Application
```bash
cd /opt  # or your preferred directory
git clone git@github.com:rishabh-arbor/end-to-end-voice.git
cd end-to-end-voice
```

### 3.2 Install Node Dependencies
```bash
npm install
```

### 3.3 Configure Environment Variables
```bash
# Create secrets file
nano secrets.local.json
```

Add:
```json
{
  "GEMINI_API_KEY": "your-gemini-api-key-here",
  "INTERVIEW_PASSWORD": "your-interview-password",
  "ENABLE_STT": "1"
}
```

Or set environment variables:
```bash
export GEMINI_API_KEY="your-gemini-api-key-here"
export INTERVIEW_PASSWORD="your-interview-password"
```

---

## Step 4: Test Audio Setup

### 4.1 Test Virtual Audio Device Detection
```bash
# Run a quick test to see if virtual devices are detected
node -e "
const { execSync } = require('child_process');
execSync('pactl list sources short | grep virtual', { encoding: 'utf8' });
console.log('Virtual audio device found!');
"
```

### 4.2 Test Electron with Virtual Display
```bash
# Test Electron can start with Xvfb
xvfb-run -a -s "-screen 0 1280x800x24" npm run electron-dev -- https://interview-staging.findarbor.com/interview/test
```

**Expected output**: Should see logs about audio capture and Gemini connection.

---

## Step 5: Setup Process Management

### Option A: systemd Service (Recommended)

#### 5.1 Create Service File
```bash
sudo nano /etc/systemd/system/arbor-interview.service
```

Add:
```ini
[Unit]
Description=Arbor Interview Automation
After=network.target sound.target

[Service]
Type=simple
User=your-username
Group=audio
WorkingDirectory=/opt/end-to-end-voice
Environment="DISPLAY=:99"
Environment="GEMINI_API_KEY=your-api-key"
Environment="INTERVIEW_PASSWORD=your-password"
Environment="PULSE_RUNTIME_PATH=/run/user/1000/pulse"
ExecStartPre=/usr/bin/Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset
ExecStart=/usr/bin/npm run electron-dev -- https://interview-staging.findarbor.com/interview/YOUR_INTERVIEW_ID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Important**: Replace:
- `your-username` with your Linux username
- `your-api-key` with your Gemini API key
- `your-password` with your interview password
- `YOUR_INTERVIEW_ID` with actual interview ID
- `/opt/end-to-end-voice` with your actual path
- `/run/user/1000/pulse` - check your user ID: `id -u`

#### 5.2 Enable and Start Service
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable arbor-interview.service

# Start service
sudo systemctl start arbor-interview.service

# Check status
sudo systemctl status arbor-interview.service

# View logs
sudo journalctl -u arbor-interview.service -f
```

### Option B: PM2 (Alternative)

#### 5.1 Install PM2
```bash
npm install -g pm2
```

#### 5.2 Create PM2 Ecosystem File
```bash
nano ecosystem.config.js
```

Add:
```javascript
module.exports = {
  apps: [{
    name: 'arbor-interview',
    script: 'npm',
    args: 'run electron-dev -- https://interview-staging.findarbor.com/interview/YOUR_INTERVIEW_ID',
    cwd: '/opt/end-to-end-voice',
    env: {
      DISPLAY: ':99',
      GEMINI_API_KEY: 'your-api-key',
      INTERVIEW_PASSWORD: 'your-password',
      PULSE_RUNTIME_PATH: '/run/user/1000/pulse'
    },
    interpreter: '/usr/bin/xvfb-run',
    interpreter_args: '-a -s "-screen 0 1280x800x24"',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M'
  }]
};
```

#### 5.3 Start with PM2
```bash
# Start Xvfb in background
Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &

# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions it prints
```

---

## Step 6: Configure Audio Routing

### 6.1 Route System Audio to Virtual Sink

For applications to send audio to the virtual sink:

```bash
# Set virtual_speaker as default (optional - affects all audio)
pactl set-default-sink virtual_speaker

# Or route specific application (better)
# Find application's sink input ID
pactl list sink-inputs

# Move specific application to virtual sink
pactl move-sink-input <SINK_INPUT_ID> virtual_speaker
```

### 6.2 Verify Audio Capture

Check if audio is being captured:
```bash
# Monitor PulseAudio
pactl subscribe | grep --line-buffered "sink-input\|source-output"
```

---

## Step 7: Firewall Configuration

### 7.1 Allow Outbound Connections
```bash
# Allow HTTPS (for Gemini API)
sudo ufw allow out 443/tcp

# Allow HTTP (if needed)
sudo ufw allow out 80/tcp

# Check firewall status
sudo ufw status
```

---

## Step 8: Troubleshooting

### 8.1 Check Virtual Display
```bash
# Verify Xvfb is running
ps aux | grep Xvfb

# Test display
DISPLAY=:99 xdpyinfo
```

### 8.2 Check Audio Devices
```bash
# List all audio sources
pactl list sources short

# Should see "virtual_mic" or similar
# If not, reload PulseAudio modules:
pactl unload-module module-remap-source
pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic
```

### 8.3 Check Application Logs

**systemd**:
```bash
sudo journalctl -u arbor-interview.service -n 100 -f
```

**PM2**:
```bash
pm2 logs arbor-interview
```

### 8.4 Common Issues

#### Issue: "Cannot open display"
**Solution**: Ensure Xvfb is running on display :99
```bash
Xvfb :99 -screen 0 1280x800x24 &
export DISPLAY=:99
```

#### Issue: "No audio devices found"
**Solution**: Check PulseAudio modules are loaded
```bash
pactl list modules | grep null-sink
pactl list modules | grep remap-source
```

#### Issue: "Permission denied" for audio
**Solution**: Add user to audio group
```bash
sudo usermod -a -G audio $USER
# Log out and back in
```

#### Issue: "WebSocket connection failed"
**Solution**: Check internet connectivity and API key
```bash
curl https://generativelanguage.googleapis.com
echo $GEMINI_API_KEY
```

---

## Step 9: Verification Checklist

- [ ] Xvfb installed and running
- [ ] PulseAudio null sink created (`virtual_speaker`)
- [ ] PulseAudio remap source created (`virtual_mic`)
- [ ] Application code deployed
- [ ] Environment variables set
- [ ] Service/PM2 configured and running
- [ ] Logs show audio device detection
- [ ] Logs show Gemini API connection
- [ ] No errors in logs

---

## Step 10: Monitoring

### 10.1 Monitor Service Status
```bash
# systemd
sudo systemctl status arbor-interview.service

# PM2
pm2 status
pm2 monit
```

### 10.2 Monitor Logs
```bash
# systemd
sudo journalctl -u arbor-interview.service -f

# PM2
pm2 logs arbor-interview --lines 100
```

### 10.3 Monitor Resources
```bash
# CPU/Memory usage
top -p $(pgrep -f electron)

# Disk space
df -h

# Network
netstat -tuln | grep 443
```

---

## Quick Start Script

Create a quick setup script:

```bash
#!/bin/bash
# setup-linux.sh

echo "Setting up Arbor Interview on Linux..."

# Install dependencies
sudo apt-get update
sudo apt-get install -y xvfb pulseaudio pulseaudio-utils chromium-browser

# Setup PulseAudio
pactl load-module module-null-sink sink_name=virtual_speaker
pactl load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic

# Install Node dependencies
npm install

# Set environment variables
export GEMINI_API_KEY="your-key"
export INTERVIEW_PASSWORD="your-password"

# Start Xvfb
Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &

# Run application
export DISPLAY=:99
npm run electron-dev -- https://interview-staging.findarbor.com/interview/YOUR_ID

echo "Setup complete!"
```

Make executable:
```bash
chmod +x setup-linux.sh
./setup-linux.sh
```

---

## Production Deployment Tips

1. **Use systemd** for better process management
2. **Set up log rotation** to prevent disk fill-up
3. **Monitor resource usage** (Electron is memory-intensive)
4. **Use Docker** for isolation (see LINUX_SERVER_DEPLOYMENT.md)
5. **Set up alerts** for service failures
6. **Backup configuration** files
7. **Use secrets management** (don't hardcode API keys)

---

## Next Steps

After deployment:
1. Test with a real interview
2. Monitor logs for any issues
3. Verify audio capture is working
4. Verify agent responses are being sent
5. Set up monitoring/alerting

---

## Support

If you encounter issues:
1. Check logs first
2. Verify all dependencies are installed
3. Verify PulseAudio modules are loaded
4. Verify Xvfb is running
5. Check firewall/network connectivity
6. Review LINUX_SERVER_DEPLOYMENT.md for detailed troubleshooting

