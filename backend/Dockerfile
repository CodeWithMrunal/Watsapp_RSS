# Use Node.js 18 with Chrome support for WhatsApp Web.js
FROM node:18-bullseye

# Install system dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    ca-certificates \
    apt-transport-https \
    software-properties-common \
    netcat \
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
    libxss1 \
    libgconf-2-4 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN groupadd -r nodeuser && useradd -r -g nodeuser -s /bin/bash nodeuser

# Create necessary directories with proper permissions
RUN mkdir -p \
    /app/media \
    /app/rss \
    /app/rss/groups \
    /app/backups \
    /app/.wwebjs_auth \
    /app/.wwebjs_cache \
    /app/logs \
    && chown -R nodeuser:nodeuser /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies (Puppeteer will download Chromium automatically)
RUN npm ci --only=production && npm cache clean --force

# Install Sequelize CLI globally for migrations
RUN npm install -g sequelize-cli

# Copy application files
COPY --chown=nodeuser:nodeuser . .

# Create .env file template if it doesn't exist
RUN if [ ! -f .env ]; then \
    echo "NODE_ENV=production" > .env && \
    echo "PORT=3001" >> .env && \
    echo "DB_HOST=postgres" >> .env && \
    echo "DB_PORT=5432" >> .env && \
    echo "DB_NAME=whatsapp_monitor_prod" >> .env && \
    echo "DB_USERNAME=postgres" >> .env && \
    echo "DB_PASSWORD=password" >> .env && \
    chown nodeuser:nodeuser .env; \
    fi


# Environment variables for Chrome
ENV CHROME_BIN=/usr/bin/google-chrome \
    CHROME_PATH=/usr/bin/google-chrome \
    DISPLAY=:99 \
    PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"

# Remove Chrome-specific setup since we're using Puppeteer's auto-detection

# Create startup script
RUN echo '#!/bin/bash' > /app/start.sh \
    && echo 'set -e' >> /app/start.sh \
    && echo '' >> /app/start.sh \
    && echo 'echo "🚀 Starting WhatsApp Monitor Backend..."' >> /app/start.sh \
    && echo '' >> /app/start.sh \
    && echo '# Wait for database to be ready' >> /app/start.sh \
    && echo 'echo "⏳ Waiting for database connection..."' >> /app/start.sh \
    && echo 'while ! nc -z ${DB_HOST:-postgres} ${DB_PORT:-5432}; do' >> /app/start.sh \
    && echo '    echo "Database not ready, waiting..."' >> /app/start.sh \
    && echo '    sleep 2' >> /app/start.sh \
    && echo 'done' >> /app/start.sh \
    && echo 'echo "✅ Database connection available"' >> /app/start.sh \
    && echo '' >> /app/start.sh \
    && echo '# Run database migrations' >> /app/start.sh \
    && echo 'echo "🔄 Running database migrations..."' >> /app/start.sh \
    && echo 'NODE_ENV=${NODE_ENV:-production} npx sequelize-cli db:migrate || echo "⚠️ Migration failed or already up to date"' >> /app/start.sh \
    && echo '' >> /app/start.sh \
    && echo '# Start the application' >> /app/start.sh \
    && echo 'echo "🎯 Starting Node.js application..."' >> /app/start.sh \
    && echo 'exec node server.js' >> /app/start.sh \
    && chmod +x /app/start.sh

# Switch to non-root user
USER nodeuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Expose the port
EXPOSE 3001

# Create volumes for persistent data
VOLUME ["/app/media", "/app/rss", "/app/.wwebjs_auth", "/app/.wwebjs_cache", "/app/backups"]

# Start the application
CMD ["/app/start.sh"]