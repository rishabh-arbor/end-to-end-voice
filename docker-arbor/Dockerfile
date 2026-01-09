# Interview Bot Docker Container
# Browser + PulseAudio virtual audio + VNC for viewing + Node.js application

FROM --platform=linux/amd64 node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # PulseAudio for virtual audio
    pulseaudio \
    pulseaudio-utils \
    alsa-utils \
    libasound2-plugins \
    # Chromium dependencies for Puppeteer
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    # Additional utilities
    dbus \
    dbus-x11 \
    # VNC and virtual display for watching the interview
    xvfb \
    x11vnc \
    x11-utils \
    fluxbox \
    # noVNC for browser-based VNC access
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# PulseAudio configuration
ENV PULSE_SERVER=unix:/run/pulse/native
ENV XDG_RUNTIME_DIR=/run/pulse
ENV HOME=/root

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application source
COPY . .

# Create runtime directories
RUN mkdir -p /run/pulse /root/.config/pulse && chmod 755 /run/pulse

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Expose ports
EXPOSE 3000
# VNC port
EXPOSE 5900
# noVNC web port (view in browser)
EXPOSE 6080

# Environment for display
ENV DISPLAY=:99
ENV VNC_PORT=5900
ENV NOVNC_PORT=6080

# Use custom entrypoint to start PulseAudio before the app
ENTRYPOINT ["./docker-entrypoint.sh"]

# Default command (can be overridden)
CMD ["node", "src/index.js"]

