#!/bin/bash
set -e

echo "=== Interview Bot Docker Entrypoint ==="
echo "Starting at $(date)"

# =====================================================
# Virtual Display Setup (Xvfb + VNC)
# =====================================================

if [ "$HEADLESS" = "false" ]; then
    echo "[display] Starting virtual display for VNC viewing..."
    
    # Remove any stale X lock files
    rm -f /tmp/.X99-lock 2>/dev/null || true
    
    # Start Xvfb (virtual framebuffer) with more options
    Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
    XVFB_PID=$!
    
    export DISPLAY=:99
    
    # Wait for Xvfb to be ready
    echo "[display] Waiting for Xvfb to start..."
    for i in {1..30}; do
        if xdpyinfo -display :99 >/dev/null 2>&1; then
            echo "[display] ✓ Xvfb is ready"
            break
        fi
        sleep 0.5
    done
    
    # Start a lightweight window manager
    fluxbox &
    sleep 2
    
    # Start VNC server (no password for simplicity)
    x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -bg -o /tmp/x11vnc.log 2>&1 &
    sleep 2
    
    # Start noVNC (web-based VNC client)
    if [ -d /usr/share/novnc ]; then
        websockify --web /usr/share/novnc 6080 localhost:5900 &
    fi
    
    echo "[display] ✓ VNC server running on port 5900"
    echo "[display] ✓ noVNC web viewer: http://localhost:6080/vnc.html"
    echo ""
else
    echo "[display] Running in headless mode (no VNC)"
    export DISPLAY=
fi

# =====================================================
# PulseAudio Setup - Virtual Audio Devices
# =====================================================

echo "[audio] Setting up PulseAudio for container..."

# Create required directories
mkdir -p /tmp/pulse /run/pulse /root/.config/pulse
chmod 755 /tmp/pulse /run/pulse

# Set environment
export XDG_RUNTIME_DIR=/run/pulse
export PULSE_RUNTIME_PATH=/run/pulse
export HOME=/root

# Create PulseAudio config for container/root
cat > /root/.config/pulse/default.pa << 'PACONFIG'
# PulseAudio config for Docker container
.fail

# Load essential modules
# =====================================================
# OUTPUT PATH (TTS Playback):
#   TTS -> virtual_speaker -> virtual_mic -> WebRTC uplink -> Interview platform
#   Purpose: Interview platform hears our TTS responses
# =====================================================
load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual_Speaker"
load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic source_properties=device.description="Virtual_Mic"

# =====================================================
# INPUT PATH (Browser Audio Output Capture):
#   Browser audio output → virtual_speaker_2 (via loopback)
#   virtual_speaker_2 → virtual_mic_2 (monitor) → Input capture
#   Purpose: Capture browser audio output (interviewer voice from interview page)
#   This is separate from TTS output path (no feedback loop)
# =====================================================
load-module module-null-sink sink_name=virtual_speaker_2 sink_properties=device.description="Virtual_Speaker_2_Browser_Audio"
load-module module-remap-source master=virtual_speaker_2.monitor source_name=virtual_mic_2 source_properties=device.description="Virtual_Mic_2_Input"

# Set defaults
# virtual_speaker_2: For browser audio output (so we can capture it)
# virtual_speaker: For TTS output (explicitly specified in paplay)
# virtual_mic: For WebRTC uplink (monitors virtual_speaker, so interview hears TTS)
set-default-sink virtual_speaker_2
set-default-source virtual_mic

# Note: Browser will output to virtual_speaker_2 (default sink)
# TTS will use virtual_speaker explicitly (via paplay --device=virtual_speaker)
# This keeps the paths separate

# Native protocol for local clients
load-module module-native-protocol-unix auth-anonymous=1 socket=/run/pulse/native

# Allow connections
load-module module-always-sink

# ALSA compatibility - critical for Chromium
load-module module-alsa-sink device=default sink_name=alsa_output sink_properties=device.description="ALSA_Output" 2>/dev/null || true
load-module module-alsa-source device=default source_name=alsa_input source_properties=device.description="ALSA_Input" 2>/dev/null || true
PACONFIG

# Create ALSA config to route through PulseAudio
cat > /root/.asoundrc << 'ALSACONFIG'
pcm.!default {
    type pulse
}

ctl.!default {
    type pulse
}

pcm.pulse {
    type pulse
}

ctl.pulse {
    type pulse
}
ALSACONFIG

# Also create system-wide ALSA config
cat > /etc/asound.conf << 'ALSACONFIG'
pcm.!default {
    type pulse
}

ctl.!default {
    type pulse
}
ALSACONFIG

cat > /root/.config/pulse/client.conf << 'CLIENTCONF'
autospawn = no
default-server = unix:/run/pulse/native
CLIENTCONF

# Function to start PulseAudio with retry logic
start_pulseaudio() {
    local max_retries=3
    local retry=0
    
    while [ $retry -lt $max_retries ]; do
        # Kill any existing PulseAudio
        pulseaudio --kill 2>/dev/null || true
        sleep 1
        
        # Clean up stale socket/PID files
        rm -f /run/pulse/native /run/pulse/pid
        
        # Start PulseAudio with our config
        echo "[audio] Starting PulseAudio daemon (attempt $((retry + 1))/$max_retries)..."
        if pulseaudio --daemonize=yes \
            --system=no \
            --realtime=no \
            --exit-idle-time=-1 \
            --disallow-exit \
            --log-target=stderr \
            --log-level=notice \
            -n \
            --file=/root/.config/pulse/default.pa \
            2>&1; then
            # PulseAudio started, verify it's actually running
            sleep 1
            if pactl info >/dev/null 2>&1; then
                echo "[audio] ✓ PulseAudio started successfully"
                return 0
            fi
        fi
        
        retry=$((retry + 1))
        if [ $retry -lt $max_retries ]; then
            echo "[audio] ⚠️ PulseAudio startup failed, retrying in 2 seconds..."
            sleep 2
        fi
    done
    
    echo "[audio] ERROR: PulseAudio failed to start after $max_retries attempts"
    return 1
}

# Start PulseAudio (fail fast if it doesn't start)
if ! start_pulseaudio; then
    echo "[audio] FATAL: Cannot continue without PulseAudio. Exiting."
    exit 1
fi

# Set PULSE_SERVER for clients
export PULSE_SERVER=unix:/run/pulse/native

# Wait for PulseAudio to be fully ready
echo "[audio] Waiting for PulseAudio to be ready..."
PULSE_READY=false
for i in {1..20}; do
    if pactl info >/dev/null 2>&1; then
        PULSE_READY=true
        echo "[audio] ✓ PulseAudio is running"
        break
    fi
    sleep 0.5
done

if [ "$PULSE_READY" = "true" ]; then
    echo "[audio] Verifying virtual devices..."
    echo "[audio] Sinks:"
    pactl list sinks short 2>/dev/null || true
    echo "[audio] Sources:"
    pactl list sources short 2>/dev/null || true
    echo "[audio] Default sink: $(pactl get-default-sink 2>/dev/null || echo 'unknown')"
    echo "[audio] Default source: $(pactl get-default-source 2>/dev/null || echo 'unknown')"
    
    # Verify ALSA → PulseAudio routing
    echo "[audio] Verifying ALSA → PulseAudio routing..."
    if command -v aplay >/dev/null 2>&1; then
        aplay -L 2>/dev/null | grep -A2 pulse || echo "[audio] ⚠️ ALSA PulseAudio plugin not found"
    fi
    
    echo "[audio] ✓ Virtual audio setup complete"
    echo "[audio] Note: Browser audio will route to virtual_speaker_2 (default sink)"
    echo "[audio] Monitor with: pactl list sink-inputs short"
    
    # Start background monitoring of sink inputs (shows when browser outputs audio)
    (
      while true; do
        sleep 10
        sink_inputs=$(pactl list sink-inputs short 2>/dev/null | wc -l)
        if [ "$sink_inputs" -gt 0 ]; then
          echo "[audio] 🔊 Browser audio detected! Active sink inputs: $sink_inputs"
          pactl list sink-inputs short 2>/dev/null | head -5
        fi
      done
    ) &
    MONITOR_PID=$!
    echo "[audio] Started audio monitoring (PID: $MONITOR_PID)"
    
    # Start PulseAudio health monitoring (restart if it dies)
    (
      while true; do
        sleep 30
        if ! pactl info >/dev/null 2>&1; then
          echo "[audio] ⚠️ PulseAudio daemon died! Attempting restart..."
          if start_pulseaudio; then
            echo "[audio] ✓ PulseAudio restarted successfully"
          else
            echo "[audio] ERROR: Failed to restart PulseAudio"
          fi
        fi
      done
    ) &
    HEALTH_MONITOR_PID=$!
    echo "[audio] Started PulseAudio health monitoring (PID: $HEALTH_MONITOR_PID)"
    
    # Audio validation: Test paplay before proceeding
    echo "[audio] Validating audio playback..."
    if echo "test" | paplay --device=virtual_speaker --raw --format=s16le --channels=1 --rate=24000 2>/dev/null; then
        echo "[audio] ✓ Audio playback validation passed"
    else
        echo "[audio] ⚠️ Audio playback validation failed (this may be normal if no audio data provided)"
        # Don't fail here - paplay might need actual audio data
    fi
else
    echo "[audio] FATAL: PulseAudio failed to start after all retries"
    echo "[audio] Cannot continue without audio. Exiting."
    exit 1
fi

# =====================================================
# Environment Info
# =====================================================

echo ""
echo "[env] Environment variables:"
echo "  INTERVIEW_URL: ${INTERVIEW_URL:-<not set>}"
echo "  GEMINI_API_KEY: ${GEMINI_API_KEY:+<set>}${GEMINI_API_KEY:-<not set>}"
echo "  AUDIO_SAMPLE_RATE: ${AUDIO_SAMPLE_RATE:-16000}"
echo "  TTS_SAMPLE_RATE: ${TTS_SAMPLE_RATE:-24000}"
echo "  LOG_LEVEL: ${LOG_LEVEL:-info}"
echo "  TIMEOUT_SECONDS: ${TIMEOUT_SECONDS:-1800}"
echo ""

# =====================================================
# Start Application
# =====================================================

echo "[app] Starting application..."
echo "Command: $@"
echo ""

# Execute the main command (passed as arguments)
exec "$@"

