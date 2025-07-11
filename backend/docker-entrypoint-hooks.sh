#!/bin/bash
set -e

# Backend Container Startup Hooks
# This script runs when the backend container starts to register with service discovery

echo "🚀 Backend container startup hooks..."

# Service Discovery Registration
register_with_nginx() {
    echo "📡 Registering with nginx service discovery..."
    
    # Wait for docker socket to be available (if mounted)
    if [ -S /var/run/docker.sock ]; then
        # Install python if not available
        if ! command -v python3 &> /dev/null; then
            echo "Installing Python for service discovery..."
            apt-get update && apt-get install -y python3 python3-pip
        fi
        
        # Download and run service discovery registration
        if curl -s -o /tmp/nginx-updater.py http://host.docker.internal:3000/nginx-updater.py 2>/dev/null; then
            echo "Downloaded service discovery tool"
            python3 /tmp/nginx-updater.py register fuzefront-backend fuzefront-backend 3001 /health
        else
            echo "⚠️  Could not download service discovery tool, using fallback method"
            # Fallback: trigger nginx reload via API call
            curl -s "http://fuzeinfra-nginx/nginx-api/update-upstream" \
                 -X POST \
                 -H "Content-Type: application/json" \
                 -d '{"service":"fuzefront-backend","action":"register"}' || true
        fi
    else
        echo "🔗 Docker socket not available, will rely on nginx DNS resolution"
    fi
}

# Database connection check
check_database() {
    echo "🗄️  Checking database connection..."
    
    # Wait for database to be ready
    max_attempts=30
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if node -e "const db = require('./dist/config/database'); db.raw('SELECT 1').then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
            echo "✅ Database connection successful"
            break
        else
            echo "⏳ Waiting for database... (attempt $attempt/$max_attempts)"
            sleep 2
            attempt=$((attempt + 1))
        fi
    done
    
    if [ $attempt -gt $max_attempts ]; then
        echo "❌ Database connection failed after $max_attempts attempts"
        exit 1
    fi
}

# Version and build info
show_version_info() {
    echo "📋 Backend Version Information:"
    echo "   Package: $(cat package.json | grep '"version"' | head -1 | cut -d'"' -f4 2>/dev/null || echo 'Unknown')"
    echo "   Built: $(date -r dist/index.js 2>/dev/null || echo 'Unknown')"
    echo "   Node: $(node --version 2>/dev/null || echo 'Unknown')"
    echo "   Container: $(hostname)"
    echo "   Network: $(hostname -i 2>/dev/null || echo 'Unknown')"
}

# Health check endpoint validation
validate_health_endpoint() {
    echo "❤️  Validating health endpoint..."
    
    # Start the server in background for validation
    node dist/index.js &
    SERVER_PID=$!
    
    # Wait a moment for server to start
    sleep 3
    
    # Check if health endpoint responds
    if curl -s http://localhost:3001/health > /dev/null; then
        echo "✅ Health endpoint is responding"
    else
        echo "⚠️  Health endpoint not responding yet"
    fi
    
    # Stop the test server
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
}

# Execute hooks
show_version_info
check_database
register_with_nginx

echo "✅ Backend startup hooks completed"

# Continue with the original entrypoint
exec "$@" 