#!/bin/bash

# WhatsApp Monitor - Docker Image Builder
# This script builds and optionally pushes images to Docker Hub

set -e

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-yourusername}"
VERSION="${VERSION:-latest}"
PUSH_IMAGES="${PUSH_IMAGES:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

print_status "Building WhatsApp Monitor Docker images..."
print_status "Docker Username: $DOCKER_USERNAME"
print_status "Version: $VERSION"

# Build backend image
print_status "Building backend image..."
docker build -t $DOCKER_USERNAME/whatsapp-monitor-backend:$VERSION ./backend
docker tag $DOCKER_USERNAME/whatsapp-monitor-backend:$VERSION $DOCKER_USERNAME/whatsapp-monitor-backend:latest

# Build selenium image
print_status "Building selenium image..."
docker build -t $DOCKER_USERNAME/whatsapp-monitor-selenium:$VERSION ./selenium
docker tag $DOCKER_USERNAME/whatsapp-monitor-selenium:$VERSION $DOCKER_USERNAME/whatsapp-monitor-selenium:latest

# Build frontend image
print_status "Building frontend image..."
docker build -t $DOCKER_USERNAME/whatsapp-monitor-frontend:$VERSION ./frontend
docker tag $DOCKER_USERNAME/whatsapp-monitor-frontend:$VERSION $DOCKER_USERNAME/whatsapp-monitor-frontend:latest

print_status "All images built successfully!"

# List built images
print_status "Built images:"
docker images | grep "$DOCKER_USERNAME/whatsapp-monitor"

# Push images if requested
if [ "$PUSH_IMAGES" = "true" ]; then
    print_status "Pushing images to Docker Hub..."
    
    # Check if logged in to Docker Hub
    if ! docker info | grep -q "Username"; then
        print_warning "Not logged in to Docker Hub. Please run 'docker login' first."
        read -p "Do you want to login now? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker login
        else
            print_error "Cannot push without Docker Hub login."
            exit 1
        fi
    fi
    
    # Push all images
    docker push $DOCKER_USERNAME/whatsapp-monitor-backend:$VERSION
    docker push $DOCKER_USERNAME/whatsapp-monitor-backend:latest
    
    docker push $DOCKER_USERNAME/whatsapp-monitor-selenium:$VERSION
    docker push $DOCKER_USERNAME/whatsapp-monitor-selenium:latest
    
    docker push $DOCKER_USERNAME/whatsapp-monitor-frontend:$VERSION
    docker push $DOCKER_USERNAME/whatsapp-monitor-frontend:latest
    
    print_status "All images pushed successfully!"
    print_status "Users can now run: docker pull $DOCKER_USERNAME/whatsapp-monitor-backend:latest"
else
    print_warning "Images not pushed. Set PUSH_IMAGES=true to push to Docker Hub."
    echo "To push manually:"
    echo "  docker login"
    echo "  docker push $DOCKER_USERNAME/whatsapp-monitor-backend:latest"
    echo "  docker push $DOCKER_USERNAME/whatsapp-monitor-selenium:latest"
    echo "  docker push $DOCKER_USERNAME/whatsapp-monitor-frontend:latest"
fi

print_status "Build process completed!"