# WhatsApp Monitor - Makefile

.PHONY: help build build-push dev prod clean logs shell test

# Default Docker username (override with: make build DOCKER_USERNAME=yourusername)
DOCKER_USERNAME ?= yourusername
VERSION ?= latest

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build all Docker images
	@echo "Building Docker images..."
	chmod +x build-images.sh
	DOCKER_USERNAME=$(DOCKER_USERNAME) VERSION=$(VERSION) ./build-images.sh

build-push: ## Build and push images to Docker Hub
	@echo "Building and pushing Docker images..."
	chmod +x build-images.sh
	DOCKER_USERNAME=$(DOCKER_USERNAME) VERSION=$(VERSION) PUSH_IMAGES=true ./build-images.sh

dev: ## Start development environment
	@echo "Starting development environment..."
	docker-compose up --build

dev-detached: ## Start development environment in background
	@echo "Starting development environment in background..."
	docker-compose up --build -d

prod: ## Start production environment (requires pre-built images)
	@echo "Starting production environment..."
	mkdir -p data/{rss,media,backups,session,cache}
	docker-compose -f docker-compose.prod.yml up -d

stop: ## Stop all containers
	@echo "Stopping containers..."
	docker-compose down
	docker-compose -f docker-compose.prod.yml down 2>/dev/null || true

clean: ## Remove containers, volumes, and images
	@echo "Cleaning up..."
	docker-compose down -v
	docker-compose -f docker-compose.prod.yml down -v 2>/dev/null || true
	docker system prune -f

logs: ## Show logs from all containers
	docker-compose logs -f

logs-backend: ## Show backend logs
	docker-compose logs -f backend

logs-selenium: ## Show selenium logs
	docker-compose logs -f selenium

logs-frontend: ## Show frontend logs
	docker-compose logs -f frontend

shell-backend: ## Access backend container shell
	docker-compose exec backend sh

shell-selenium: ## Access selenium container shell
	docker-compose exec selenium bash

test: ## Test the application
	@echo "Testing application health..."
	curl -f http://localhost:3001/health || echo "Backend not responding"
	curl -f http://localhost:8080 || echo "Frontend not responding"

install: ## Install for end users (pulls from Docker Hub)
	@echo "Installing WhatsApp Monitor..."
	@echo "Docker username: $(DOCKER_USERNAME)"
	mkdir -p data/{rss,media,backups,session,cache}
	sed 's/yourusername/$(DOCKER_USERNAME)/g' docker-compose.prod.yml > docker-compose.install.yml
	docker-compose -f docker-compose.install.yml pull
	docker-compose -f docker-compose.install.yml up -d
	@echo "WhatsApp Monitor installed! Access at http://localhost"