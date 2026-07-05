#!/bin/bash

# Initialize Authentik Database
# This script creates the necessary database and user for Authentik in the shared PostgreSQL container

set -e

echo "🔧 Initializing Authentik Database..."

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Default values
PG_CONTAINER=${PG_CONTAINER:-"fuzeinfra-postgres"}
PG_ADMIN_USER=${POSTGRES_USER:-"postgres"}
PG_ADMIN_PASS=${POSTGRES_PASSWORD:-"postgres"}
AUTHENTIK_DB_NAME=${PG_DB:-"authentik"}
AUTHENTIK_DB_USER=${PG_USER:-"authentik_user"}
AUTHENTIK_DB_PASS=${PG_PASS:?PG_PASS must be set (define it in .env or your secrets manager — see .env.example)}

echo "📋 Configuration:"
echo "   Container: $PG_CONTAINER"
echo "   Database: $AUTHENTIK_DB_NAME"
echo "   User: $AUTHENTIK_DB_USER"
echo ""

# Check if PostgreSQL container is running
if ! docker ps | grep -q "$PG_CONTAINER"; then
    echo "❌ PostgreSQL container '$PG_CONTAINER' is not running"
    echo "   Please start FuzeInfra first: cd FuzeInfra && docker-compose -f docker-compose.FuzeInfra.yml up -d"
    exit 1
fi

echo "✅ PostgreSQL container is running"

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker exec "$PG_CONTAINER" pg_isready -U "$PG_ADMIN_USER" >/dev/null 2>&1; do
    echo "   Waiting for PostgreSQL..."
    sleep 2
done
echo "✅ PostgreSQL is ready"

# Create Authentik database if it doesn't exist
echo "🗃️  Creating Authentik database and user..."

docker exec "$PG_CONTAINER" psql -U "$PG_ADMIN_USER" -c "
DO \$\$
BEGIN
    -- Create database if it doesn't exist
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '$AUTHENTIK_DB_NAME') THEN
        CREATE DATABASE $AUTHENTIK_DB_NAME;
        RAISE NOTICE 'Database $AUTHENTIK_DB_NAME created';
    ELSE
        RAISE NOTICE 'Database $AUTHENTIK_DB_NAME already exists';
    END IF;
    
    -- Create user if it doesn't exist
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$AUTHENTIK_DB_USER') THEN
        CREATE USER $AUTHENTIK_DB_USER WITH PASSWORD '$AUTHENTIK_DB_PASS';
        RAISE NOTICE 'User $AUTHENTIK_DB_USER created';
    ELSE
        RAISE NOTICE 'User $AUTHENTIK_DB_USER already exists';
    END IF;
    
    -- Grant privileges
    GRANT ALL PRIVILEGES ON DATABASE $AUTHENTIK_DB_NAME TO $AUTHENTIK_DB_USER;
    
    -- Grant schema privileges
    GRANT ALL ON SCHEMA public TO $AUTHENTIK_DB_USER;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $AUTHENTIK_DB_USER;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $AUTHENTIK_DB_USER;
    
    RAISE NOTICE 'Privileges granted to $AUTHENTIK_DB_USER';
END
\$\$;
"

# Verify the setup
echo "🔍 Verifying database setup..."
docker exec "$PG_CONTAINER" psql -U "$PG_ADMIN_USER" -l | grep "$AUTHENTIK_DB_NAME" >/dev/null
if [ $? -eq 0 ]; then
    echo "✅ Database '$AUTHENTIK_DB_NAME' verified"
else
    echo "❌ Database verification failed"
    exit 1
fi

# Test connection with Authentik user
echo "🔑 Testing Authentik user connection..."
if docker exec "$PG_CONTAINER" psql -U "$AUTHENTIK_DB_USER" -d "$AUTHENTIK_DB_NAME" -c "SELECT version();" >/dev/null 2>&1; then
    echo "✅ Authentik user can connect successfully"
else
    echo "❌ Authentik user connection failed"
    exit 1
fi

echo ""
echo "🎉 Authentik database initialization complete!"
echo ""
echo "📋 Summary:"
echo "   Database: $AUTHENTIK_DB_NAME"
echo "   User: $AUTHENTIK_DB_USER"
echo "   Connection: postgresql://$AUTHENTIK_DB_USER:***@$PG_CONTAINER:5432/$AUTHENTIK_DB_NAME"
echo ""
echo "🚀 You can now start Authentik containers:"
echo "   docker-compose up -d authentik-worker authentik-server"
echo ""