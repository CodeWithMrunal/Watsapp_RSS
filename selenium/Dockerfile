# Fixed Selenium Dockerfile - Updated ChromeDriver Installation
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    gnupg \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install ChromeDriver using the new Chrome for Testing endpoints
RUN CHROME_VERSION=$(google-chrome --version | cut -d " " -f3) && \
    echo "Chrome version: $CHROME_VERSION" && \
    # Use the new Chrome for Testing API
    CHROMEDRIVER_VERSION=$(curl -sS "https://googlechromelabs.github.io/chrome-for-testing/LATEST_RELEASE_STABLE") && \
    echo "ChromeDriver version: $CHROMEDRIVER_VERSION" && \
    # Download ChromeDriver from the new location
    wget -O /tmp/chromedriver.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROMEDRIVER_VERSION}/linux64/chromedriver-linux64.zip" && \
    # Extract and install
    unzip /tmp/chromedriver.zip -d /tmp/ && \
    mv /tmp/chromedriver-linux64/chromedriver /usr/local/bin/ && \
    chmod +x /usr/local/bin/chromedriver && \
    # Cleanup
    rm -rf /tmp/chromedriver.zip /tmp/chromedriver-linux64

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python script
COPY sele_vd_downloader3.py .

# Create directories
RUN mkdir -p rss media

# Create non-root user
RUN useradd -m -u 1001 pythonuser && \
    chown -R pythonuser:pythonuser /app

USER pythonuser

# Set environment for Docker
ENV DOCKER_ENV=true
ENV DISPLAY=:99

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import os; exit(0 if os.path.exists('/app/rss') else 1)"

# Wait for backend and start
CMD ["sh", "-c", "sleep 15 && python -u sele_vd_downloader3.py"]