# WhatsApp Monitor - Makefile (Colima Optimized)

.PHONY: help setup-colima build build-push dev prod clean logs shell test

# Default Docker username
DOCKER_USERNAME ?= pes2ug22cs323
VERSION ?= latest
COLIMA_PROFILE ?= whatsapp-monitor

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check-colima: ## Check if Colima is running
	@echo "Checking Colima status..."
	@if ! colima status >/dev/null 2>&1; then \
		echo "❌ Colima is not running. Please run 'make setup-colima' first."; \
		exit 1; \
	fi
	@echo "✅ Colima is running"
	@docker info | grep -E "(Server Version|Architecture)" || true

setup-colima: ## Setup and start Colima
	@echo "🚀 Setting up Colima for WhatsApp Monitor..."
	@if colima status $(COLIMA_PROFILE) >/dev/null 2>&1; then \
		echo "📋 Colima profile '$(COLIMA_PROFILE)' already exists"; \
		colima status $(COLIMA_PROFILE); \
	else \
		echo "🔧 Creating new Colima profile: $(COLIMA_PROFILE)"; \
		colima start $(COLIMA_PROFILE) --arch x86_64 --cpu 4 --memory 8 --disk 50 --mount-type virtiofs; \
	fi
	@echo "✅ Colima setup complete!"

stop-colima: ## Stop Colima
	@echo "🛑 Stopping Colima..."
	colima stop $(COLIMA_PROFILE) || true
	@echo "✅ Colima stopped"

restart-colima: ## Restart Colima
	@echo "🔄 Restarting Colima..."
	make stop-colima
	make setup-colima

colima-status: ## Show Colima status and resource usage
	@echo "📊 Colima Status:"
	colima status $(COLIMA_PROFILE) || echo "Profile not found"
	@echo ""
	@echo "🐳 Docker Info:"
	docker system df 2>/dev/null || echo "Docker not available"
	@echo ""
	@echo "💾 Disk Usage:"
	docker system df 2>/dev/null || echo "Docker not available"

build: check-colima ## Build all Docker images
	@echo "🔨 Building Docker images with Colima..."
	chmod +x build-images.sh
	DOCKER_USERNAME=$(DOCKER_USERNAME) VERSION=$(VERSION) ./build-images.sh

build-push: check-colima ## Build and push images to Docker Hub
	@echo "🚀 Building and pushing Docker images..."
	chmod +x build-images.sh
	DOCKER_USERNAME=$(DOCKER_USERNAME) VERSION=$(VERSION) PUSH_IMAGES=true ./build-images.sh

dev: check-colima ## Start development environment
	@echo "🔧 Starting development environment with Colima..."
	docker-compose up --build

dev-detached: check-colima ## Start development environment in background
	@echo "🔧 Starting development environment in background..."
	docker-compose up --build -d

prod: check-colima ## Start production environment
	@echo "🚀 Starting production environment..."
	mkdir -p data/{rss,media,backups,session,cache}
	docker-compose -f docker-compose.prod.yml up -d

stop: ## Stop all containers
	@echo "🛑 Stopping containers..."
	docker-compose down 2>/dev/null || true
	docker-compose -f docker-compose.prod.yml down 2>/dev/null || true

clean: check-colima ## Remove containers, volumes, and images
	@echo "🧹 Cleaning up Docker resources..."
	docker-compose down -v 2>/dev/null || true
	docker-compose -f docker-compose.prod.yml down -v 2>/dev/null || true
	docker system prune -f
	@echo "✅ Cleanup complete"

clean-all: ## Clean everything including Colima VM
	@echo "🧹 Performing full cleanup..."
	make clean
	make stop-colima
	colima delete $(COLIMA_PROFILE) --force || true
	@echo "✅ Full cleanup complete"

logs: check-colima ## Show logs from all containers
	docker-compose logs -f

logs-backend: check-colima ## Show backend logs
	docker-compose logs -f backend

logs-selenium: check-colima ## Show selenium logs
	docker-compose logs -f selenium

logs-frontend: check-colima ## Show frontend logs
	docker-compose logs -f frontend

shell-backend: check-colima ## Access backend container shell
	docker-compose exec backend sh

shell-selenium: check-colima ## Access selenium container shell
	docker-compose exec selenium bash

shell-colima: ## Access Colima VM shell
	colima ssh $(COLIMA_PROFILE)

test: check-colima ## Test the application
	@echo "🧪 Testing application health..."
	@sleep 5
	curl -f http://localhost:3001/health || echo "❌ Backend not responding"
	curl -f http://localhost:8080 || echo "❌ Frontend not responding"
	@echo "✅ Health check complete"

monitor: check-colima ## Monitor resource usage
	@echo "📊 Monitoring Docker containers..."
	watch docker stats

install: ## Install for end users
	@echo "📦 Installing WhatsApp Monitor..."
	make setup-colima
	make prod
	@echo "✅ Installation complete! Access at http://localhost"

# Colima-specific debugging commands
debug-mount: ## Debug file mount issues
	@echo "🔍 Debugging file mounts..."
	colima ssh $(COLIMA_PROFILE) -- ls -la /tmp/colima
	docker run --rm -v $(PWD):/test alpine ls -la /test

debug-network: ## Debug network issues
	@echo "🔍 Debugging network..."
	docker network ls
	docker-compose ps
	docker inspect whatsapp_network 2>/dev/null || echo "Network not found"