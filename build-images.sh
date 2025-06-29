#!/bin/bash

# WhatsApp Monitor - Colima-Optimized Docker Image Builder

set -e

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-pes2ug22cs323}"
VERSION="${VERSION:-latest}"
PUSH_IMAGES="${PUSH_IMAGES:-false}"
COLIMA_PROFILE="${COLIMA_PROFILE:-whatsapp-monitor}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

print_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# Check if Colima is running
check_colima() {
    if ! colima status "$COLIMA_PROFILE" > /dev/null 2>&1; then
        print_error "Colima profile '$COLIMA_PROFILE' is not running."
        print_status "Starting Colima profile..."
        colima start "$COLIMA_PROFILE" --arch x86_64 --cpu 4 --memory 8 --disk 50 --mount-type virtiofs
    fi
}

# Check if Docker is accessible
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not accessible. Please check Colima status."
        exit 1
    fi
}

# Build with better caching for Colima
build_with_cache() {
    local context=$1
    local image_name=$2
    
    print_status "Building $image_name with optimized caching..."
    
    # Use BuildKit for better caching
    DOCKER_BUILDKIT=1 docker build \
        --progress=plain \
        --cache-from=$image_name:latest \
        -t $image_name:$VERSION \
        -t $image_name:latest \
        $context
}

print_status "🐳 WhatsApp Monitor - Colima Docker Builder"
print_status "Profile: $COLIMA_PROFILE"
print_status "Docker Username: $DOCKER_USERNAME"
print_status "Version: $VERSION"

# Pre-flight checks
check_colima
check_docker

# Show Colima info
print_debug "Colima VM Info:"
colima status "$COLIMA_PROFILE" || true

print_debug "Docker Info:"
docker info | grep -E "(Server Version|Architecture|Storage Driver)" || true

print_status "Building WhatsApp Monitor Docker images with Colima..."

# Enable BuildKit for better caching and performance
export DOCKER_BUILDKIT=1

# Build backend image
print_status "📦 Building backend image..."
build_with_cache "./backend" "$DOCKER_USERNAME/whatsapp-monitor-backend"

# Build selenium image
print_status "🤖 Building selenium image..."
build_with_cache "./selenium" "$DOCKER_USERNAME/whatsapp-monitor-selenium"

# Build frontend image
print_status "⚛️ Building frontend image..."
build_with_cache "./frontend" "$DOCKER_USERNAME/whatsapp-monitor-frontend"

print_status "✅ All images built successfully!"

# Show image sizes
print_status "📊 Built images:"
docker images | grep "$DOCKER_USERNAME/whatsapp-monitor" | head -10

# Show disk usage
print_status "💾 Docker disk usage:"
docker system df

# Push images if requested
if [ "$PUSH_IMAGES" = "true" ]; then
    print_status "🚀 Pushing images to Docker Hub..."
    
    # Check Docker Hub login
    if ! docker info 2>/dev/null | grep -q "Username"; then
        print_warning "Not logged in to Docker Hub."
        read -p "Login to Docker Hub? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker login
        else
            print_error "Cannot push without Docker Hub login."
            exit 1
        fi
    fi
    
    # Push with retry logic for Colima
    push_with_retry() {
        local image=$1
        local max_attempts=3
        local attempt=1
        
        while [ $attempt -le $max_attempts ]; do
            print_status "Pushing $image (attempt $attempt/$max_attempts)..."
            if docker push $image; then
                print_status "✅ Successfully pushed $image"
                return 0
            else
                print_warning "❌ Failed to push $image (attempt $attempt)"
                if [ $attempt -lt $max_attempts ]; then
                    print_status "Retrying in 5 seconds..."
                    sleep 5
                fi
                ((attempt++))
            fi
        done
        
        print_error "Failed to push $image after $max_attempts attempts"
        return 1
    }
    
    # Push all images with retry
    push_with_retry "$DOCKER_USERNAME/whatsapp-monitor-backend:$VERSION"
    push_with_retry "$DOCKER_USERNAME/whatsapp-monitor-backend:latest"
    
    push_with_retry "$DOCKER_USERNAME/whatsapp-monitor-selenium:$VERSION"
    push_with_retry "$DOCKER_USERNAME/whatsapp-monitor-selenium:latest"
    
    push_with_retry "$DOCKER_USERNAME/whatsapp-monitor-frontend:$VERSION"
    push_with_retry "$DOCKER_USERNAME/whatsapp-monitor-frontend:latest"
    
    print_status "🎉 All images pushed successfully!"
    print_status "Users can now run: docker pull $DOCKER_USERNAME/whatsapp-monitor-backend:latest"
else
    print_warning "Images not pushed. Set PUSH_IMAGES=true to push to Docker Hub."
    echo ""
    echo "To push manually:"
    echo "  docker login"
    echo "  docker push $DOCKER_USERNAME/whatsapp-monitor-backend:latest"
    echo "  docker push $DOCKER_USERNAME/whatsapp-monitor-selenium:latest"
    echo "  docker push $DOCKER_USERNAME/whatsapp-monitor-frontend:latest"
fi

# Cleanup build cache to save space
print_status "🧹 Cleaning up build cache..."
docker builder prune -f

print_status "🎉 Build process completed!"
print_status "💡 Tip: Use 'make monitor' to watch container resources"