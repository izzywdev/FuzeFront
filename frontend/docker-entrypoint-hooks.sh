#!/bin/bash
set -e

# Frontend Container Startup Hooks
# This script runs when the frontend container starts to register with service discovery

echo "🚀 Frontend container startup hooks..."

# Service Discovery Registration
register_with_nginx() {
    echo "📡 Registering with nginx service discovery..."
    
    # Wait for docker socket to be available (if mounted)
    if [ -S /var/run/docker.sock ]; then
        # Install python if not available
        if ! command -v python3 &> /dev/null; then
            echo "Installing Python for service discovery..."
            apk add --no-cache python3 py3-pip
        fi
        
        # Download and run service discovery registration
        if curl -s -o /tmp/nginx-updater.py http://host.docker.internal:3000/nginx-updater.py 2>/dev/null; then
            echo "Downloaded service discovery tool"
            python3 /tmp/nginx-updater.py register fuzefront-frontend fuzefront-frontend 8080 /
        else
            echo "⚠️  Could not download service discovery tool, using fallback method"
            # Fallback: trigger nginx reload via API call
            curl -s "http://fuzeinfra-nginx/nginx-api/update-upstream" \
                 -X POST \
                 -H "Content-Type: application/json" \
                 -d '{"service":"fuzefront-frontend","action":"register"}' || true
        fi
    else
        echo "🔗 Docker socket not available, will rely on nginx DNS resolution"
    fi
}

# Health check notification
notify_health_status() {
    echo "❤️  Notifying health status..."
    
    # Wait for nginx to be ready before starting
    max_attempts=30
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if wget --spider --quiet --timeout=2 --tries=1 http://nginx:80/nginx-health 2>/dev/null; then
            echo "✅ Nginx is ready"
            break
        else
            echo "⏳ Waiting for nginx... (attempt $attempt/$max_attempts)"
            sleep 2
            attempt=$((attempt + 1))
        fi
    done
    
    if [ $attempt -gt $max_attempts ]; then
        echo "⚠️  Nginx not responding, continuing anyway"
    fi
}

# Version and build info
show_version_info() {
    echo "📋 Frontend Version Information:"
    echo "   Built: $(date -r /usr/share/nginx/html/index.html 2>/dev/null || echo 'Unknown')"
    echo "   Assets: $(ls -la /usr/share/nginx/html/assets/*.js | wc -l) JavaScript files"
    echo "   Container: $(hostname)"
    echo "   Network: $(hostname -i 2>/dev/null || echo 'Unknown')"
}

# Execute hooks
show_version_info
notify_health_status
register_with_nginx

echo "✅ Frontend startup hooks completed"

# Continue with the original entrypoint
exec "$@" 