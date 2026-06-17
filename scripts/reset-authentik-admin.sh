#!/bin/bash

# Reset Authentik Admin Password
# This script resets the admin password for Authentik

set -e

echo "🔐 Resetting Authentik Admin Password..."

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Default values
CONTAINER_NAME="fuzefront-authentik-server"
NEW_PASSWORD=${1:-"admin123"}

echo "📋 Configuration:"
echo "   Container: $CONTAINER_NAME"
echo "   New Password: $NEW_PASSWORD"
echo ""

# Check if container is running
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo "❌ Container '$CONTAINER_NAME' is not running"
    echo "   Please start Authentik first: docker-compose up -d authentik-server"
    exit 1
fi

echo "✅ Container is running"

# Reset password for akadmin user (superuser)
echo "🔑 Setting password for 'akadmin' user..."

docker exec "$CONTAINER_NAME" ak shell -c "
from authentik.core.models import User
from django.contrib.auth.hashers import make_password

try:
    user = User.objects.get(username='akadmin')
    user.password = make_password('$NEW_PASSWORD')
    user.save()
    print('✅ Password updated successfully for akadmin')
    print('   Username: akadmin')
    print('   Email:', user.email)
    print('   New Password: $NEW_PASSWORD')
except User.DoesNotExist:
    print('❌ User akadmin not found')
except Exception as e:
    print('❌ Error updating password:', str(e))
"

# Also try to reset the 'admin' user password if it exists
echo ""
echo "🔑 Setting password for 'admin' user (if exists)..."

docker exec "$CONTAINER_NAME" ak shell -c "
from authentik.core.models import User
from django.contrib.auth.hashers import make_password

try:
    user = User.objects.get(username='admin')
    user.password = make_password('$NEW_PASSWORD')
    user.is_active = True
    user.save()
    print('✅ Password updated successfully for admin')
    print('   Username: admin')
    print('   Email:', user.email)
    print('   New Password: $NEW_PASSWORD')
except User.DoesNotExist:
    print('ℹ️  User admin not found')
except Exception as e:
    print('❌ Error updating password:', str(e))
"

echo ""
echo "🎉 Password reset complete!"
echo ""
echo "🌐 Access Authentik:"
echo "   URL: http://auth.fuzefront.local:9000"
echo "   URL (direct): http://localhost:9000"
echo ""
echo "🔑 Credentials to try:"
echo "   Username: akadmin"
echo "   Password: $NEW_PASSWORD"
echo ""
echo "   OR"
echo ""
echo "   Username: admin"
echo "   Password: $NEW_PASSWORD"
echo ""
echo "💡 Make sure to add this to your hosts file:"
echo "   127.0.0.1  auth.fuzefront.local"
echo ""