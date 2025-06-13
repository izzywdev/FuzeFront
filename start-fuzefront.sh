#!/bin/bash

# FuzeFront Platform Startup Script
# This script starts the entire FuzeFront platform with shared infrastructure

set -e  # Exit on any error

echo "🚀 Starting FuzeFront Platform..."
echo "=================================="

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

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

print_success "Docker is running"

# Check if shared infrastructure is running
print_status "Checking shared infrastructure..."
if ! docker network ls | grep -q "shared-infra"; then
    print_warning "Shared infrastructure network not found. Creating..."
    docker network create shared-infra
fi

if ! docker ps | grep -q "shared-postgres"; then
    print_status "Starting shared PostgreSQL infrastructure..."
    cd FuzeInfra
    docker-compose -f docker-compose.shared-infra.yml up -d postgres
    cd ..
    
    # Wait for PostgreSQL to be ready
    print_status "Waiting for PostgreSQL to be ready..."
    timeout=60
    while ! docker exec shared-postgres pg_isready -U postgres >/dev/null 2>&1; do
        if [ $timeout -le 0 ]; then
            print_error "PostgreSQL failed to start within 60 seconds"
            exit 1
        fi
        sleep 2
        timeout=$((timeout-2))
        echo -n "."
    done
    echo ""
    print_success "PostgreSQL is ready"
else
    print_success "Shared PostgreSQL is already running"
fi

# Build and start FuzeFront platform
print_status "Building and starting FuzeFront platform..."
docker-compose down --remove-orphans 2>/dev/null || true
docker-compose build --no-cache
docker-compose up -d

# Wait for services to be healthy
print_status "Waiting for services to be healthy..."
services=("fuzefront-backend" "fuzefront-frontend" "fuzefront-taskmanager")

for service in "${services[@]}"; do
    print_status "Checking health of $service..."
    timeout=120
    while true; do
        if [ $timeout -le 0 ]; then
            print_error "$service failed to become healthy within 2 minutes"
            docker-compose logs $service
            exit 1
        fi
        
        health_status=$(docker inspect --format='{{.State.Health.Status}}' $service 2>/dev/null || echo "starting")
        if [ "$health_status" = "healthy" ]; then
            print_success "$service is healthy"
            break
        elif [ "$health_status" = "unhealthy" ]; then
            print_error "$service is unhealthy"
            docker-compose logs $service
            exit 1
        fi
        
        sleep 5
        timeout=$((timeout-5))
        echo -n "."
    done
done

echo ""
print_success "🎉 FuzeFront Platform is ready!"
echo ""
echo "🌐 Access URLs:"
echo "   Frontend:     http://localhost:8080"
echo "   Backend API:  http://localhost:3001"
echo "   Task Manager: http://localhost:3002"
echo "   API Docs:     http://localhost:3001/api-docs"
echo ""
echo "📊 Health Checks:"
echo "   Backend:      http://localhost:3001/health"
echo "   Frontend:     http://localhost:8080/health" 
echo "   Task Manager: http://localhost:3002/health"
echo ""
echo "🗄️  Database:"
echo "   PostgreSQL:   localhost:5432"
echo "   Database:     fuzefront_platform"
echo "   User:         postgres"
echo ""
echo "👤 Demo Credentials:"
echo "   Email:        admin@fuzefront.dev"
echo "   Password:     admin123"
echo ""
echo "📦 To stop the platform:"
echo "   docker-compose down"
echo ""
echo "📋 To view logs:"
echo "   docker-compose logs -f [service-name]" 