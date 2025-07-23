# Multi-stage build for React Vite application
FROM node:18-alpine as build

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies needed for build)
RUN npm ci --silent

# Install terser if needed for minification (optional - esbuild is also good)
# RUN npm install --save-dev terser

# Copy source code
COPY . .

# Build arguments for environment variables
ARG VITE_API_URL=http://localhost:3001
ARG VITE_SOCKET_URL=http://localhost:3001
ARG VITE_APP_TITLE="WhatsApp Monitor"

# Set environment variables for build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_APP_TITLE=$VITE_APP_TITLE

# Build the application
RUN npm run build

# Clean up dev dependencies after build (optional, saves space)
RUN npm prune --production

# Production stage with Nginx
FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Set proper permissions for nginx user (user already exists in nginx:alpine)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

# Create startup script for environment variable injection
RUN echo '#!/bin/sh' > /docker-entrypoint.sh \
    && echo 'set -e' >> /docker-entrypoint.sh \
    && echo '' >> /docker-entrypoint.sh \
    && echo '# Inject environment variables into the built JavaScript files' >> /docker-entrypoint.sh \
    && echo 'if [ -n "$VITE_API_URL" ] || [ -n "$VITE_SOCKET_URL" ]; then' >> /docker-entrypoint.sh \
    && echo '    echo "🔧 Injecting runtime environment variables..."' >> /docker-entrypoint.sh \
    && echo '    ' >> /docker-entrypoint.sh \
    && echo '    # Find the main JavaScript files' >> /docker-entrypoint.sh \
    && echo '    find /usr/share/nginx/html -name "*.js" -type f -exec sed -i \' >> /docker-entrypoint.sh \
    && echo '        -e "s|http://localhost:3001|${VITE_API_URL:-http://localhost:3001}|g" \' >> /docker-entrypoint.sh \
    && echo '        {} \;' >> /docker-entrypoint.sh \
    && echo '    ' >> /docker-entrypoint.sh \
    && echo '    echo "✅ Environment variables injected"' >> /docker-entrypoint.sh \
    && echo 'fi' >> /docker-entrypoint.sh \
    && echo '' >> /docker-entrypoint.sh \
    && echo '# Start nginx' >> /docker-entrypoint.sh \
    && echo 'echo "🚀 Starting Nginx..."' >> /docker-entrypoint.sh \
    && echo 'exec nginx -g "daemon off;"' >> /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

# Switch to non-root user
USER nginx

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/ || exit 1

# Expose port
EXPOSE 80

# Start the application
ENTRYPOINT ["/docker-entrypoint.sh"]