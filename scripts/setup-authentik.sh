#!/bin/bash

# Comprehensive Authentik Setup Script
# Handles database initialization, container startup, and configuration verification

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_step() {
    echo -e "${BLUE}🔧 $1${NC}"
}

# Parse command line arguments
SKIP_DB_INIT=false
SKIP_CONTAINER_START=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-db-init)
            SKIP_DB_INIT=true
            shift
            ;;
        --skip-container-start)
            SKIP_CONTAINER_START=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --skip-db-init         Skip database initialization"
            echo "  --skip-container-start Skip container startup"
            echo "  --dry-run             Show what would be done without executing"
            echo "  -h, --help            Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${GREEN}🚀 Authentik Setup Script${NC}"
echo "==============================="

# Load environment variables
if [ -f .env ]; then
    log_info "Loading environment variables from .env"
    export $(grep -v '^#' .env | xargs)
else
    log_warning ".env file not found - using defaults"
fi

# Configuration
PG_CONTAINER=${PG_CONTAINER:-"fuzeinfra-postgres"}
REDIS_CONTAINER=${REDIS_CONTAINER:-"fuzeinfra-redis"}
AUTHENTIK_SERVER_CONTAINER="fuzefront-authentik-server"
AUTHENTIK_WORKER_CONTAINER="fuzefront-authentik-worker"

log_step "Checking prerequisites"

# Check if Docker is available
if ! command -v docker >/dev/null 2>&1; then
    log_error "Docker is not installed or not in PATH"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose >/dev/null 2>&1; then
    log_error "Docker Compose is not installed or not in PATH"
    exit 1
fi

# Check if FuzeInfra network exists
if ! docker network ls | grep -q "FuzeInfra"; then
    log_error "FuzeInfra network not found. Please start FuzeInfra first:"
    log_error "cd FuzeInfra && docker-compose -f docker-compose.FuzeInfra.yml up -d"
    exit 1
fi

log_success "Prerequisites check passed"

# Check if shared infrastructure is running
log_step "Checking shared infrastructure"

if ! docker ps | grep -q "$PG_CONTAINER"; then
    log_error "PostgreSQL container '$PG_CONTAINER' is not running"
    log_error "Please start FuzeInfra first: cd FuzeInfra && docker-compose -f docker-compose.FuzeInfra.yml up -d"
    exit 1
fi

if ! docker ps | grep -q "$REDIS_CONTAINER"; then
    log_error "Redis container '$REDIS_CONTAINER' is not running"
    log_error "Please start FuzeInfra first: cd FuzeInfra && docker-compose -f docker-compose.FuzeInfra.yml up -d"
    exit 1
fi

log_success "Shared infrastructure is running"

# Database initialization
if [ "$SKIP_DB_INIT" = false ]; then
    log_step "Initializing Authentik database"
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would initialize Authentik database"
    else
        # Call the database initialization script
        ./scripts/init-authentik-db.sh
        log_success "Database initialization completed"
    fi
else
    log_warning "Skipping database initialization"
fi

# Container startup
if [ "$SKIP_CONTAINER_START" = false ]; then
    log_step "Starting Authentik containers"
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would start Authentik containers"
    else
        # Stop existing containers if running
        if docker ps | grep -q "$AUTHENTIK_SERVER_CONTAINER\|$AUTHENTIK_WORKER_CONTAINER"; then
            log_info "Stopping existing Authentik containers"
            docker-compose stop authentik-server authentik-worker || true
            docker-compose rm -f authentik-server authentik-worker || true
        fi
        
        # Start worker first, then server
        log_info "Starting Authentik worker..."
        docker-compose up -d authentik-worker
        
        # Wait a moment for worker to initialize
        sleep 5
        
        log_info "Starting Authentik server..."
        docker-compose up -d authentik-server
        
        log_success "Authentik containers started"
    fi
else
    log_warning "Skipping container startup"
fi

# Health checks
if [ "$SKIP_CONTAINER_START" = false ] && [ "$DRY_RUN" = false ]; then
    log_step "Performing health checks"
    
    # Wait for containers to be healthy
    log_info "Waiting for Authentik worker to be healthy..."
    timeout=60
    counter=0
    while [ $counter -lt $timeout ]; do
        if docker ps --filter "name=$AUTHENTIK_WORKER_CONTAINER" --filter "health=healthy" | grep -q "$AUTHENTIK_WORKER_CONTAINER"; then
            log_success "Authentik worker is healthy"
            break
        fi
        
        if [ $counter -eq $((timeout - 1)) ]; then
            log_warning "Authentik worker health check timed out"
            docker logs "$AUTHENTIK_WORKER_CONTAINER" --tail 20
        fi
        
        sleep 2
        counter=$((counter + 1))
    done
    
    log_info "Waiting for Authentik server to be healthy..."
    counter=0
    while [ $counter -lt $timeout ]; do
        if curl -s -f http://localhost:9000 >/dev/null 2>&1; then
            log_success "Authentik server is responding"
            break
        fi
        
        if [ $counter -eq $((timeout - 1)) ]; then
            log_warning "Authentik server health check timed out"
            docker logs "$AUTHENTIK_SERVER_CONTAINER" --tail 20
        fi
        
        sleep 2
        counter=$((counter + 1))
    done
fi

# Configuration summary
echo ""
echo -e "${GREEN}🎉 Authentik Setup Complete!${NC}"
echo "=================================="
echo ""
echo -e "${BLUE}📋 Configuration Summary:${NC}"
echo "   Authentik Server: http://localhost:9000"
echo "   Admin UI: http://auth.fuzefront.local:9000"
echo "   Database: postgresql://$PG_USER:***@$PG_CONTAINER:5432/$PG_DB"
echo "   Redis: redis://$REDIS_CONTAINER:6379"
echo ""
echo -e "${BLUE}🔑 Default Credentials:${NC}"
echo "   Username: ${AUTHENTIK_BOOTSTRAP_EMAIL:-admin@fuzefront.local}"
echo "   Password: ${AUTHENTIK_BOOTSTRAP_PASSWORD:-admin123}"
echo ""
echo -e "${BLUE}🚀 Next Steps:${NC}"
echo "1. Add to your hosts file:"
echo "   127.0.0.1  auth.fuzefront.local"
echo "2. Visit http://auth.fuzefront.local:9000 to configure Authentik"
echo "3. Create an OIDC application for FuzeFront"
echo "4. Update AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET in .env"
echo ""
echo -e "${BLUE}🔧 Management Commands:${NC}"
echo "   View logs: docker-compose logs -f authentik-server authentik-worker"
echo "   Restart: docker-compose restart authentik-server authentik-worker"
echo "   Stop: docker-compose stop authentik-server authentik-worker"
echo ""

if [ "$DRY_RUN" = true ]; then
    log_warning "This was a dry run. No actual changes were made."
fi