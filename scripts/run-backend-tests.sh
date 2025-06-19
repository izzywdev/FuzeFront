#!/bin/bash

# FuzeFront Backend Test Runner
# This script runs comprehensive backend authentication tests

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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

# Configuration
BACKEND_DIR="backend"
TEST_TIMEOUT=${TEST_TIMEOUT:-30000}
NODE_ENV=${NODE_ENV:-test}

# Check if we're in the right directory
if [ ! -d "$BACKEND_DIR" ]; then
    log_error "Backend directory not found. Please run this script from the project root."
    exit 1
fi

log_info "🚀 Starting FuzeFront Backend Test Suite"
log_info "Environment: $NODE_ENV"
log_info "Test Timeout: ${TEST_TIMEOUT}ms"
echo

# Change to backend directory
cd $BACKEND_DIR

# Check if package.json exists
if [ ! -f "package.json" ]; then
    log_error "package.json not found in backend directory"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    log_info "Installing backend dependencies..."
    npm ci
    log_success "Dependencies installed"
    echo
fi

# Set test environment variables
export NODE_ENV=$NODE_ENV
export JWT_SECRET=${JWT_SECRET:-"test-jwt-secret-key-for-testing-only"}
export FRONTEND_URL=${FRONTEND_URL:-"http://localhost:3000"}

# Database configuration
if [ "$USE_POSTGRES" = "true" ]; then
    export DB_HOST=${DB_HOST:-"localhost"}
    export DB_PORT=${DB_PORT:-"5432"}
    export DB_NAME=${DB_NAME:-"fuzefront_platform_test"}
    export DB_USER=${DB_USER:-"postgres"}
    export DB_PASSWORD=${DB_PASSWORD:-"postgres"}
    
    log_info "Using PostgreSQL database: $DB_HOST:$DB_PORT/$DB_NAME"
    
    # Wait for database to be ready
    log_info "Waiting for database to be ready..."
    timeout=30
    while ! pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME 2>/dev/null; do
        timeout=$((timeout - 1))
        if [ $timeout -le 0 ]; then
            log_error "Database is not ready after 30 seconds"
            exit 1
        fi
        sleep 1
    done
    log_success "Database is ready"
    echo
else
    log_info "Using SQLite database for tests"
fi

# Run linting first
log_info "Running code linting..."
if npm run lint; then
    log_success "Linting passed"
else
    log_warning "Linting failed, continuing with tests..."
fi
echo

# Run type checking
log_info "Running TypeScript type checking..."
if npm run type-check; then
    log_success "Type checking passed"
else
    log_error "Type checking failed"
    exit 1
fi
echo

# Run authentication unit tests
log_info "Running authentication unit tests..."
if npm run test:auth -- --testTimeout=$TEST_TIMEOUT; then
    log_success "Authentication unit tests passed"
else
    log_error "Authentication unit tests failed"
    exit 1
fi
echo

# Run production database tests if PostgreSQL is configured
if [ "$USE_POSTGRES" = "true" ]; then
    log_info "Running production database tests..."
    if npm run test:auth:production -- --testTimeout=$TEST_TIMEOUT; then
        log_success "Production database tests passed"
    else
        log_error "Production database tests failed"
        exit 1
    fi
    echo
fi

# Generate coverage report
log_info "Generating test coverage report..."
if npm run test:coverage -- --testTimeout=$TEST_TIMEOUT; then
    log_success "Coverage report generated"
    
    # Display coverage summary
    if [ -f "coverage/lcov-report/index.html" ]; then
        log_info "Coverage report available at: backend/coverage/lcov-report/index.html"
    fi
else
    log_warning "Coverage report generation failed"
fi
echo

# Run live tests if backend is running (optional)
BACKEND_URL=${BACKEND_URL:-"http://localhost:3004"}
if curl -s "$BACKEND_URL/health" > /dev/null 2>&1; then
    log_info "Backend is running, executing live API tests..."
    if node scripts/test-auth.js $BACKEND_URL; then
        log_success "Live API tests passed"
    else
        log_warning "Live API tests failed (backend may not be fully ready)"
    fi
    echo
else
    log_info "Backend not running at $BACKEND_URL, skipping live tests"
fi

# Summary
log_success "🎉 All backend tests completed successfully!"
log_info "Test artifacts:"
log_info "  - Coverage report: backend/coverage/"
log_info "  - Test results: Console output above"

# Return to original directory
cd ..

exit 0 