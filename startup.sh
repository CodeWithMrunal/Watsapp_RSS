#!/bin/bash
# startup.sh - WhatsApp Monitor Docker Startup Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    print_success "Docker is running"
}

# Function to check if docker-compose is available
check_docker_compose() {
    if command -v docker-compose > /dev/null 2>&1; then
        COMPOSE_CMD="docker-compose"
    elif docker compose version > /dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    else
        print_error "Neither docker-compose nor 'docker compose' is available"
        exit 1
    fi
    print_success "Docker Compose is available: $COMPOSE_CMD"
}

# Function to create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    directories=(
        "backend/media"
        "backend/rss"
        "backend/rss/groups"
        "backend/backups"
        "backend/.wwebjs_auth"
        "backend/.wwebjs_cache"
        "downloads"
        "logs/backend"
        "logs/selenium"
        "nginx/ssl"
    )
    
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            print_status "Created directory: $dir"
        fi
    done
    
    print_success "Directories created"
}

# Function to create .env file if it doesn't exist
create_env_file() {
    if [ ! -f .env ]; then
        print_status "Creating .env file..."
        cat > .env << 'EOF'
# Database Configuration
DB_NAME=whatsapp_monitor_prod
DB_USERNAME=mrunal.a
DB_PASSWORD=Mrunal2004

# Server Configuration
BACKEND_PORT=3001
HTTP_PORT=80
HTTPS_PORT=443

# Environment
NODE_ENV=production
EOF
        print_warning "Created .env file with default values. Please update the database password!"
    else
        print_success ".env file already exists"
    fi
}

# Function to build and start services
start_services() {
    print_status "Building and starting services..."
    
    # Build services
    print_status "Building Docker images..."
    $COMPOSE_CMD build --no-cache
    
    # Start database first
    print_status "Starting database..."
    $COMPOSE_CMD up -d postgres
    
    # Wait for database to be ready
    print_status "Waiting for database to be ready..."
    sleep 10
    
    # Start backend
    print_status "Starting backend..."
    $COMPOSE_CMD up -d backend
    
    # Wait for backend to be ready
    print_status "Waiting for backend to be ready..."
    sleep 15
    
    # Start frontend
    print_status "Starting frontend..."
    $COMPOSE_CMD up -d frontend
    
    # Wait for frontend to be ready
    print_status "Waiting for frontend to be ready..."
    sleep 10
    
    # Start selenium downloader
    print_status "Starting Selenium downloader..."
    $COMPOSE_CMD up -d selenium-downloader
    
    print_success "All services started!"
}

# Function to show service status
show_status() {
    print_status "Service Status:"
    $COMPOSE_CMD ps
    
    echo ""
    print_status "Service URLs:"
    echo "  🌐 Frontend App: http://localhost:3000"
    echo "  🔗 Backend API: http://localhost:3001"
    echo "  📱 WhatsApp Web Interface: http://localhost:3000"
    echo "  📊 RSS Feed: http://localhost:3001/rss/feed.xml"
    echo "  💚 Health Check: http://localhost:3001/health"
    echo "  📁 Media Files: http://localhost:3001/media/"
    
    echo ""
    print_status "Useful Commands:"
    echo "  📋 View logs: $COMPOSE_CMD logs -f [service_name]"
    echo "  🔍 View all logs: $COMPOSE_CMD logs -f"
    echo "  🛑 Stop services: $COMPOSE_CMD down"
    echo "  🔄 Restart service: $COMPOSE_CMD restart [service_name]"
    echo "  📊 View containers: $COMPOSE_CMD ps"
}

# Function to show logs
show_logs() {
    if [ -n "$1" ]; then
        print_status "Showing logs for service: $1"
        $COMPOSE_CMD logs -f "$1"
    else
        print_status "Showing logs for all services"
        $COMPOSE_CMD logs -f
    fi
}

# Function to stop services
stop_services() {
    print_status "Stopping services..."
    $COMPOSE_CMD down
    print_success "Services stopped"
}

# Function to cleanup (remove containers, volumes, images)
cleanup() {
    print_warning "This will remove all containers, volumes, and images. Are you sure? (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        print_status "Cleaning up..."
        $COMPOSE_CMD down -v --rmi all --remove-orphans
        print_success "Cleanup completed"
    else
        print_status "Cleanup cancelled"
    fi
}

# Main script logic
case "${1:-start}" in
    "start")
        print_status "Starting WhatsApp Monitor..."
        check_docker
        check_docker_compose
        create_directories
        create_env_file
        start_services
        show_status
        ;;
    "stop")
        check_docker
        check_docker_compose
        stop_services
        ;;
    "restart")
        check_docker
        check_docker_compose
        stop_services
        start_services
        show_status
        ;;
    "status")
        check_docker
        check_docker_compose
        show_status
        ;;
    "logs")
        check_docker
        check_docker_compose
        show_logs "$2"
        ;;
    "cleanup")
        check_docker
        check_docker_compose
        cleanup
        ;;
    "build")
        check_docker
        check_docker_compose
        print_status "Building services..."
        $COMPOSE_CMD build --no-cache
        print_success "Build completed"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs [service]|cleanup|build}"
        echo ""
        echo "Commands:"
        echo "  start    - Start all services (default)"
        echo "  stop     - Stop all services"
        echo "  restart  - Restart all services"
        echo "  status   - Show service status and URLs"
        echo "  logs     - Show logs (optionally for specific service)"
        echo "  cleanup  - Remove all containers, volumes, and images"
        echo "  build    - Build Docker images"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 logs backend"
        echo "  $0 logs selenium-downloader"
        exit 1
        ;;
esac