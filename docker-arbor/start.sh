#!/bin/bash
# =============================================================================
# Interview Bot Start Script
# 
# Starts the Docker container and automatically opens noVNC viewer
# when the interview is ready.
# 
# Usage:
#   ./start.sh          # Start and open VNC
#   ./start.sh --no-vnc # Start without opening VNC
#   make start          # Same as ./start.sh
# =============================================================================

set -e

# Configuration
NOVNC_URL="http://localhost:6080/vnc.html"
HEALTH_URL="http://localhost:3000/health"
MAX_WAIT=120  # Maximum seconds to wait for ready state

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
OPEN_VNC=true
if [[ "$1" == "--no-vnc" ]]; then
    OPEN_VNC=false
fi

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BLUE}   Interview Bot - Starting...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"

# Change to script directory
cd "$(dirname "$0")"

# Check if container is already running
if docker-compose ps --status running 2>/dev/null | grep -q "interview-bot"; then
    echo -e "${GREEN}Container already running!${NC}"
else
    # Start docker-compose
    echo -e "${YELLOW}Starting Docker container...${NC}"
    docker-compose up -d
fi

# Wait for container to be healthy
echo -e "${YELLOW}Waiting for interview bot to be ready...${NC}"

start_time=$(date +%s)
ready=false

while true; do
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))
    
    if [ $elapsed -ge $MAX_WAIT ]; then
        echo -e "${RED}Timeout: Bot did not become ready within ${MAX_WAIT} seconds${NC}"
        echo -e "${YELLOW}You can still try opening VNC manually: ${NOVNC_URL}${NC}"
        break
    fi
    
    # Check health endpoint
    response=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
    
    if [ "$response" == "200" ]; then
        # Check if status is "ok" (ready)
        status=$(curl -s "$HEALTH_URL" 2>/dev/null | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        
        if [ "$status" == "ok" ]; then
            ready=true
            echo -e "${GREEN}✓ Interview bot is ready!${NC}"
            break
        else
            echo -ne "\r${YELLOW}Status: $status (${elapsed}s elapsed)...${NC}     "
        fi
    else
        echo -ne "\r${YELLOW}Waiting for bot to start (${elapsed}s elapsed)...${NC}     "
    fi
    
    sleep 2
done

echo ""

# Open noVNC in browser
if [ "$OPEN_VNC" = true ]; then
    echo -e "${BLUE}Opening noVNC viewer in browser...${NC}"
    
    # Detect OS and open browser accordingly
    case "$(uname -s)" in
        Darwin)
            # macOS
            open "$NOVNC_URL"
            ;;
        Linux)
            # Linux
            if command -v xdg-open &> /dev/null; then
                xdg-open "$NOVNC_URL"
            elif command -v gnome-open &> /dev/null; then
                gnome-open "$NOVNC_URL"
            else
                echo -e "${YELLOW}Could not auto-open browser. Please open: ${NOVNC_URL}${NC}"
            fi
            ;;
        CYGWIN*|MINGW*|MSYS*)
            # Windows
            start "$NOVNC_URL"
            ;;
        *)
            echo -e "${YELLOW}Could not auto-open browser. Please open: ${NOVNC_URL}${NC}"
            ;;
    esac
fi

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}   Interview bot is running!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}noVNC Viewer:${NC} $NOVNC_URL"
echo -e "  ${YELLOW}Health Check:${NC} $HEALTH_URL"
echo -e "  ${YELLOW}VNC Port:${NC}     localhost:5900"
echo ""
echo -e "  ${YELLOW}View logs:${NC}    docker-compose logs -f"
echo -e "  ${YELLOW}Stop:${NC}         docker-compose down"
echo ""

