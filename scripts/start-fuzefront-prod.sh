#!/bin/bash

# =============================================================================
# FUZEFRONT PRODUCTION DEPLOYMENT SCRIPT
# =============================================================================
# This script starts FuzeFront as a separate Docker group for production use
# that other projects can depend on while relying on shared infrastructure.
# =============================================================================

set -e  # Exit on any error

echo "🚀 Starting FuzeFront Platform - Production Deployment"
echo "======================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
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

print_highlight() {
    echo -e "${PURPLE}[FUZEFRONT]${NC} $1"
}

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

print_success "Docker is running"

# Check if FuzeInfra network exists
print_status "Checking FuzeInfra network..."
if ! docker network ls | grep -q "FuzeInfra"; then
    print_error "FuzeInfra network not found. Please start the shared infrastructure first:"
    echo "  cd FuzeInfra && ./infra-up.sh"
    exit 1
fi

print_success "FuzeInfra network is available"

# Check if shared PostgreSQL is running
print_status "Checking shared PostgreSQL..."
if ! docker ps | grep -q "shared-postgres"; then
    print_error "Shared PostgreSQL not found. Please start the shared infrastructure first:"
    echo "  cd FuzeInfra && ./infra-up.sh"
    exit 1
fi

print_success "Shared PostgreSQL is running"

# Stop existing production containers if running
print_status "Stopping existing production containers..."
docker-compose -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true

# Build and start FuzeFront production platform
print_highlight "Building FuzeFront production images..."
docker-compose -f docker-compose.prod.yml build --no-cache

print_highlight "Starting FuzeFront production services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
print_status "Waiting for services to be healthy..."
services=("fuzefront-backend-prod" "fuzefront-frontend-prod" "fuzefront-taskmanager-prod")

for service in "${services[@]}"; do
    print_status "Checking health of $service..."
    timeout=180
    while true; do
        if [ $timeout -le 0 ]; then
            print_error "$service failed to become healthy within 3 minutes"
            echo "Logs for $service:"
            docker-compose -f docker-compose.prod.yml logs $service
            exit 1
        fi
        
        health_status=$(docker inspect --format='{{.State.Health.Status}}' $service 2>/dev/null || echo "starting")
        if [ "$health_status" = "healthy" ]; then
            print_success "$service is healthy"
            break
        elif [ "$health_status" = "unhealthy" ]; then
            print_error "$service is unhealthy"
            docker-compose -f docker-compose.prod.yml logs $service
            exit 1
        fi
        
        sleep 5
        timeout=$((timeout-5))
        echo -n "."
    done
done

echo ""
print_success "🎉 FuzeFront Production Platform is ready!"
echo ""
print_highlight "=== FUZEFRONT PRODUCTION SERVICES ==="
echo ""
echo "🌐 Web Access:"
echo "   Frontend:     http://localhost:8085"
echo "   Task Manager: http://localhost:3003"
echo ""
echo "🔌 API Access:"
echo "   Backend API:  http://localhost:3004"
echo "   API Docs:     http://localhost:3004/api-docs"
echo ""
echo "📊 Health Checks:"
echo "   Backend:      http://localhost:3004/health"
echo "   Frontend:     http://localhost:8085/health" 
echo "   Task Manager: http://localhost:3002/health"
echo ""
echo "🗄️  Database:"
echo "   PostgreSQL:   localhost:5432"
echo "   Database:     fuzefront_platform_prod"
echo "   User:         postgres"
echo ""
echo "👤 Demo Credentials:"
echo "   Email:        admin@fuzefront.dev"
echo "   Password:     admin123"
echo ""
echo "🐳 Docker Info:"
echo "   Network:      FuzeInfra (shared infrastructure)"
echo "   Network:      fuzefront-prod (internal services)"
echo "   Images:       fuzefront/backend:latest"
echo "                 fuzefront/frontend:latest"
echo "                 fuzefront/taskmanager:latest"
echo ""
echo "📦 Management Commands:"
echo "   Stop:         docker-compose -f docker-compose.prod.yml down"
echo "   Restart:      docker-compose -f docker-compose.prod.yml restart"
echo "   Logs:         docker-compose -f docker-compose.prod.yml logs -f [service-name]"
echo "   Status:       docker-compose -f docker-compose.prod.yml ps"
echo ""
echo "🔗 For other projects to connect to FuzeFront:"
echo "   Network:      fuzefront-prod"
echo "   Backend URL:  http://fuzefront-backend-prod:3001"
echo "   Frontend URL: http://fuzefront-frontend-prod:8080"
echo "" 