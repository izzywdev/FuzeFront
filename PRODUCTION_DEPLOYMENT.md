# FuzeFront Production Deployment

This guide explains how to deploy FuzeFront as a separate Docker group that other projects can depend on while relying on the shared FuzeInfra setup.

## Overview

The production deployment creates a separate Docker network (`fuzefront-prod`) that connects to the shared infrastructure network (`FuzeInfra`) for database and other shared services.

## Prerequisites

1. **Shared Infrastructure Running**: FuzeInfra must be running first

   ```bash
   cd FuzeInfra && ./infra-up.sh    # Linux/Mac
   cd FuzeInfra && .\infra-up.bat   # Windows
   ```

2. **Docker**: Docker and Docker Compose must be installed and running

3. **Network Access**: The `FuzeInfra` network must exist and be accessible

## Quick Start

### Using Scripts (Recommended)

**Linux/Mac:**

```bash
chmod +x start-fuzefront-prod.sh
./start-fuzefront-prod.sh
```

**Windows:**

```batch
.\start-fuzefront-prod.bat
```

### Using Docker Compose

```bash
# Build and start production services
docker-compose -f docker-compose.prod.yml up -d --build

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop services
docker-compose -f docker-compose.prod.yml down
```

### Using NPM Scripts

```bash
# Build production images
npm run docker:prod:build

# Start production services
npm run docker:prod:up

# Check status
npm run docker:prod:status

# View logs
npm run docker:prod:logs

# Stop services
npm run docker:prod:down
```

## Production Services

### Container Names

- `fuzefront-backend-prod` - Backend API service
- `fuzefront-frontend-prod` - Frontend web application
- `fuzefront-taskmanager-prod` - Task Manager microfrontend
- `fuzefront-db-migration-prod` - Database migration (runs once)
- `fuzefront-postgres-check-prod` - PostgreSQL availability check

### Service URLs

- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:3001
- **Task Manager**: http://localhost:3003
- **API Documentation**: http://localhost:3001/api-docs

### Health Checks

- **Backend**: http://localhost:3001/health
- **Frontend**: http://localhost:8080/health
- **Task Manager**: http://localhost:3002/health

## Network Architecture

```
┌─────────────────────┐    ┌─────────────────────┐
│    FuzeInfra        │    │   fuzefront-prod    │
│                     │    │                     │
│  ┌─────────────┐    │    │  ┌─────────────┐    │
│  │shared-postgres├──┼────┼──┤ backend     │    │
│  │             │    │    │  │             │    │
│  │shared-redis │    │    │  ├─────────────┤    │
│  │             │    │    │  │ frontend    │    │
│  │shared-kafka │    │    │  │             │    │
│  │             │    │    │  ├─────────────┤    │
│  │etc...       │    │    │  │taskmanager  │    │
│  └─────────────┘    │    │  └─────────────┘    │
└─────────────────────┘    └─────────────────────┘
```

## Database Configuration

### Production Database

- **Host**: `shared-postgres` (container name)
- **Port**: `5432`
- **Database**: `fuzefront_platform_prod`
- **User**: `postgres`
- **Password**: `postgres`

### Migration

The production deployment automatically:

1. Creates the production database if it doesn't exist
2. Runs all migrations
3. Seeds initial data

## Environment Variables

### Backend Service

```yaml
NODE_ENV: production
USE_POSTGRES: true
DB_HOST: shared-postgres
DB_PORT: 5432
DB_NAME: fuzefront_platform_prod
DB_USER: postgres
DB_PASSWORD: postgres
JWT_SECRET: fuzefront-production-secret-change-this-in-production
PORT: 3001
FRONTEND_URL: http://fuzefront-frontend-prod:8080
```

### Frontend Services

```yaml
NGINX_HOST: localhost
NGINX_PORT: 8080 # (or 3002 for taskmanager)
```

## Inter-Service Communication

### For Other Projects to Connect

To connect other projects to FuzeFront production services:

1. **Add network to your docker-compose.yml**:

```yaml
networks:
  fuzefront-prod:
    external: true
    name: fuzefront-prod
```

2. **Connect your services**:

```yaml
services:
  your-service:
    # ... your service config ...
    networks:
      - fuzefront-prod
```

3. **Use internal URLs**:

- Backend API: `http://fuzefront-backend-prod:3001`
- Frontend: `http://fuzefront-frontend-prod:8080`
- Task Manager: `http://fuzefront-taskmanager-prod:3002`

## Security Considerations

### Production Security Checklist

- [ ] Change JWT_SECRET from default value
- [ ] Use environment variables for sensitive data
- [ ] Configure proper CORS origins
- [ ] Set up SSL/TLS termination
- [ ] Implement proper logging and monitoring
- [ ] Regular security updates for base images

### Recommended Changes for Production

1. **Environment Variables**: Use `.env` files or Docker secrets
2. **Reverse Proxy**: Use Nginx or Traefik for SSL termination
3. **Monitoring**: Add Prometheus metrics and Grafana dashboards
4. **Backup**: Implement database backup strategy

## Troubleshooting

### Common Issues

1. **FuzeInfra network not found**

   ```bash
   cd FuzeInfra && ./infra-up.sh
   ```

2. **PostgreSQL connection failed**

   ```bash
   # Check if shared-postgres is running
   docker ps | grep shared-postgres

   # Check network connectivity
   docker network inspect FuzeInfra
   ```

3. **Service unhealthy**

   ```bash
   # Check service logs
   docker-compose -f docker-compose.prod.yml logs [service-name]

   # Check health status
   docker inspect fuzefront-backend-prod --format='{{.State.Health.Status}}'
   ```

4. **Port conflicts**
   ```bash
   # Check what's using the ports
   netstat -tulpn | grep :8080
   netstat -tulpn | grep :3001
   ```

### Log Locations

- Container logs are available via Docker Compose
- Persistent logs are stored in `fuzefront_prod_logs` volume
- Application logs are structured JSON format

## Monitoring and Maintenance

### Health Monitoring

All services include health checks that verify:

- HTTP endpoint availability
- Database connectivity
- Service dependencies

### Resource Monitoring

```bash
# Check resource usage
docker stats

# Check disk usage
docker system df

# Clean up unused resources
docker system prune
```

### Updates and Maintenance

```bash
# Update images
docker-compose -f docker-compose.prod.yml pull

# Rebuild with latest changes
docker-compose -f docker-compose.prod.yml build --no-cache

# Rolling restart
docker-compose -f docker-compose.prod.yml restart
```

## Integration Examples

### Example: Connecting a Laravel App

```yaml
# docker-compose.yml for your Laravel app
version: '3.8'

networks:
  fuzefront-prod:
    external: true
    name: fuzefront-prod

services:
  laravel-app:
    build: .
    networks:
      - fuzefront-prod
    environment:
      - FUZEFRONT_API_URL=http://fuzefront-backend-prod:3001
      - FUZEFRONT_FRONTEND_URL=http://fuzefront-frontend-prod:8080
```

### Example: Connecting a React App

```javascript
// In your React app configuration
const config = {
  fuzeFrontApi:
    process.env.NODE_ENV === 'production'
      ? 'http://fuzefront-backend-prod:3001'
      : 'http://localhost:3001',
  fuzeFrontFrontend:
    process.env.NODE_ENV === 'production'
      ? 'http://fuzefront-frontend-prod:8080'
      : 'http://localhost:8080',
}
```

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review Docker logs for error messages
3. Verify network connectivity between containers
4. Ensure shared infrastructure services are running
