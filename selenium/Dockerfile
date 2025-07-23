# Use Ubuntu as base image for better Chrome support
FROM ubuntu:22.04

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    gnupg \
    software-properties-common \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    libpq-dev \
    build-essential \
    xvfb \
    dbus-x11 \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install ChromeDriver (updated method for newer Chrome versions)
RUN CHROME_VERSION=$(google-chrome --version | cut -d " " -f3) \
    && echo "Chrome version: $CHROME_VERSION" \
    && CHROME_MAJOR_VERSION=$(echo $CHROME_VERSION | cut -d "." -f1) \
    && echo "Chrome major version: $CHROME_MAJOR_VERSION" \
    && if [ "$CHROME_MAJOR_VERSION" -ge "115" ]; then \
        # For Chrome 115+ use the new ChromeDriver API
        CHROMEDRIVER_VERSION=$(curl -s "https://googlechromelabs.github.io/chrome-for-testing/LATEST_RELEASE_$CHROME_MAJOR_VERSION") \
        && echo "ChromeDriver version: $CHROMEDRIVER_VERSION" \
        && wget -O /tmp/chromedriver.zip "https://storage.googleapis.com/chrome-for-testing-public/$CHROMEDRIVER_VERSION/linux64/chromedriver-linux64.zip" \
        && unzip /tmp/chromedriver.zip -d /tmp/ \
        && mv /tmp/chromedriver-linux64/chromedriver /usr/local/bin/chromedriver; \
    else \
        # For older Chrome versions use the legacy API
        CHROMEDRIVER_VERSION=$(curl -s "https://chromedriver.storage.googleapis.com/LATEST_RELEASE_$CHROME_MAJOR_VERSION") \
        && echo "ChromeDriver version (legacy): $CHROMEDRIVER_VERSION" \
        && wget -O /tmp/chromedriver.zip "https://chromedriver.storage.googleapis.com/$CHROMEDRIVER_VERSION/chromedriver_linux64.zip" \
        && unzip /tmp/chromedriver.zip -d /tmp/ \
        && mv /tmp/chromedriver /usr/local/bin/chromedriver; \
    fi \
    && chmod +x /usr/local/bin/chromedriver \
    && rm -rf /tmp/chromedriver* \
    && chromedriver --version

# Create Python virtual environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY sele_vd_downloader3.py .
COPY .env* ./

# Create directories
RUN mkdir -p /app/backend/media \
    && mkdir -p /app/downloads

# Set environment variables for Chrome
ENV DISPLAY=:99
ENV CHROME_BIN=/usr/bin/google-chrome
ENV CHROME_PATH=/usr/bin/google-chrome

# Environment variables for the application
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Create a script to start Xvfb and the application
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Start Xvfb\n\
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &\n\
XVFB_PID=$!\n\
\n\
# Function to cleanup on exit\n\
cleanup() {\n\
    echo "Cleaning up..."\n\
    kill $XVFB_PID 2>/dev/null || true\n\
    exit 0\n\
}\n\
\n\
# Set trap for cleanup\n\
trap cleanup SIGTERM SIGINT\n\
\n\
# Wait for Xvfb to start\n\
sleep 2\n\
\n\
# Start the Python application\n\
python3 sele_vd_downloader3.py\n\
' > /app/start.sh && chmod +x /app/start.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep python3 > /dev/null || exit 1

# Expose volume for media files
VOLUME ["/app/backend/media"]

# Run the application
CMD ["/app/start.sh"]