#!/bin/bash

# WhatsApp Monitor - Colima Setup Script

set -e

COLIMA_PROFILE="whatsapp-monitor"
PROJECT_DIR="$(pwd)"

echo "🚀 Setting up Colima for WhatsApp Monitor"
echo "Project Directory: $PROJECT_DIR"

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "❌ Homebrew is required but not installed."
    echo "Install it from: https://brew.sh"
    exit 1
fi

# Install Colima and Docker tools
echo "📦 Installing Colima and Docker tools..."
brew install colima docker docker-compose 2>/dev/null || echo "Tools already installed"

# Create Colima configuration directory
mkdir -p ~/.colima/$COLIMA_PROFILE

# Create Colima configuration
cat > ~/.colima/$COLIMA_PROFILE/colima.yaml << EOF
# Colima configuration for WhatsApp Monitor
vm:
  cpu: 4
  memory: 8
  disk: 50
  arch: x86_64

docker:
  enabled: true
  config:
    experimental: true
    features:
      buildkit: true

runtime: docker
network:
  address: true

mounts:
  - location: $PROJECT_DIR
    writable: true
  - location: /tmp/colima
    writable: true

env:
  DOCKER_BUILDKIT: "1"
  COMPOSE_DOCKER_CLI_BUILD: "1"
EOF

# Start Colima with the profile
echo "🔧 Starting Colima profile: $COLIMA_PROFILE"
if colima status $COLIMA_PROFILE >/dev/null 2>&1; then
    echo "✅ Colima profile already running"
else
    colima start $COLIMA_PROFILE --arch x86_64 --cpu 4 --memory 8 --disk 50 --mount-type virtiofs
fi

# Verify setup
echo "🧪 Verifying setup..."
colima status $COLIMA_PROFILE
docker info | grep -E "(Server Version|Architecture)" || true

# Set up project directories
echo "📁 Setting up project directories..."
mkdir -p data/{rss,media,backups,session,cache}
mkdir -p selenium

echo "✅ Colima setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy your Python script to selenium/"
echo "2. Run 'make build' to build images"
echo "3. Run 'make dev' to start development"
echo ""
echo "Useful commands:"
echo "  make colima-status  - Check Colima status"
echo "  make monitor        - Monitor containers"
echo "  make shell-colima   - Access Colima VM"