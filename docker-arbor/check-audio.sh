#!/bin/bash
# Script to verify PulseAudio audio setup in the container

echo "=== Checking PulseAudio Audio Setup ==="
echo ""

# Check if container is running
if ! docker-compose ps | grep -q "interview-bot.*Up"; then
    echo "❌ Container is not running. Start it first with: docker-compose up -d"
    exit 1
fi

echo "✓ Container is running"
echo ""

# Check PulseAudio sinks
echo "=== PulseAudio Sinks (Output Devices) ==="
docker-compose exec -T interview-bot pactl list sinks short 2>/dev/null || echo "Failed to list sinks"
echo ""

# Check PulseAudio sources
echo "=== PulseAudio Sources (Input Devices) ==="
docker-compose exec -T interview-bot pactl list sources short 2>/dev/null || echo "Failed to list sources"
echo ""

# Check default sink
echo "=== Default Sink (Output) ==="
docker-compose exec -T interview-bot pactl get-default-sink 2>/dev/null || echo "Failed to get default sink"
echo ""

# Check default source
echo "=== Default Source (Input) ==="
docker-compose exec -T interview-bot pactl get-default-source 2>/dev/null || echo "Failed to get default source"
echo ""

# Check for virtual_speaker and virtual_mic
echo "=== Verifying Virtual Devices ==="
SINKS=$(docker-compose exec -T interview-bot pactl list sinks short 2>/dev/null)
SOURCES=$(docker-compose exec -T interview-bot pactl list sources short 2>/dev/null)

if echo "$SINKS" | grep -q "virtual_speaker"; then
    echo "✓ virtual_speaker found (TTS output sink)"
else
    echo "❌ virtual_speaker NOT found"
fi

if echo "$SOURCES" | grep -q "virtual_mic"; then
    echo "✓ virtual_mic found (WebRTC uplink source - monitors virtual_speaker)"
else
    echo "❌ virtual_mic NOT found"
fi

if echo "$SINKS" | grep -q "virtual_speaker_2"; then
    echo "✓ virtual_speaker_2 found (isolated sink)"
else
    echo "⚠️  virtual_speaker_2 NOT found (optional)"
fi

if echo "$SOURCES" | grep -q "virtual_mic_2"; then
    echo "✓ virtual_mic_2 found (isolated input source)"
else
    echo "⚠️  virtual_mic_2 NOT found (optional)"
fi

echo ""
echo "=== Audio Path Separation ==="
echo "Expected setup:"
echo "  • virtual_speaker → virtual_mic (for TTS output to WebRTC uplink)"
echo "  • Input capture uses WebRTC DOWNLINK (separate from virtual_mic)"
echo "  • virtual_speaker_2 → virtual_mic_2 (isolated pair, available for future use)"
echo ""

# Check PulseAudio info
echo "=== PulseAudio Status ==="
docker-compose exec -T interview-bot pactl info 2>/dev/null | head -5 || echo "Failed to get PulseAudio info"
echo ""

echo "=== To view logs ==="
echo "docker-compose logs -f interview-bot"
echo ""

