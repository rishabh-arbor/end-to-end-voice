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
load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual_Speaker"
load-module module-remap-source master=virtual_speaker.monitor source_name=virtual_mic source_properties=device.description="Virtual_Mic"

# Set defaults
set-default-sink virtual_speaker
set-default-source virtual_mic

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

# Kill any existing PulseAudio
pulseaudio --kill 2>/dev/null || true
sleep 1

# Start PulseAudio with our config
echo "[audio] Starting PulseAudio daemon..."
pulseaudio --daemonize=yes \
    --system=no \
    --realtime=no \
    --exit-idle-time=-1 \
    --disallow-exit \
    --log-target=stderr \
    --log-level=notice \
    -n \
    --file=/root/.config/pulse/default.pa \
    2>&1 || true

# Set PULSE_SERVER for clients
export PULSE_SERVER=unix:/run/pulse/native

# Wait for PulseAudio
echo "[audio] Waiting for PulseAudio..."
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
    echo "[audio] ✓ Virtual audio setup complete"
else
    echo "[audio] ERROR: PulseAudio failed to start"
    echo "[audio] Attempting alternative setup..."
    
    # Try starting in foreground briefly to see errors
    timeout 3 pulseaudio --log-target=stderr --log-level=debug -n --file=/root/.config/pulse/default.pa 2>&1 | head -20 || true
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

