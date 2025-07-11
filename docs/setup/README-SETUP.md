# FuzeFront Multi-Tenant Infrastructure Setup

## 🏗️ Architecture Overview

FuzeFront now implements a comprehensive multi-tenant platform with:

- **Multi-Tenant Organizations**: Hierarchical organization structure with role-based access
- **Authentik Authentication**: OIDC/OAuth2 with MFA and social logins
- **Permit.io Authorization**: Policy-based authorization using OPAL and OPA
- **App Marketplace**: Organization-scoped app installation and management
- **API Key Management**: Personal and organizational API keys

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- PowerShell (for setup scripts)
- 8GB+ RAM recommended

### 1. Automated Setup (Recommended)

```powershell
# Complete setup with all services
.\scripts\setup-infrastructure.ps1

# Skip specific services if needed
.\scripts\setup-infrastructure.ps1 -SkipAuthentik -SkipOPAL

# Dry run to see what would be done
.\scripts\setup-infrastructure.ps1 -DryRun
```

### 2. Manual Setup

```bash
# 1. Start shared infrastructure (PostgreSQL, Redis, etc.)
cd FuzeInfra
docker-compose -f docker-compose.FuzeInfra.yml up -d

# 2. Start FuzeFront services
cd ..
docker-compose up -d
```

## 🌐 Service Access

| Service              | URL                                     | Purpose                  |
| -------------------- | --------------------------------------- | ------------------------ |
| 📱 **Main Platform** | http://fuzefront.local:8080             | Main UI and app launcher |
| 🔧 **Backend API**   | http://localhost:3001/api               | REST API endpoints       |
| 📋 **Task Manager**  | http://taskmanager.fuzefront.local:3003 | Sample microfrontend     |
| 🔐 **Authentik**     | http://auth.fuzefront.local:9000        | Authentication server    |
| 📜 **OPAL Server**   | http://opal.fuzefront.local:7002        | Policy management        |
| 🛡️ **OPA Engine**    | http://localhost:8181                   | Policy decision point    |

## 🔑 Default Credentials

- **FuzeFront**: `admin@fuzefront.dev` / `admin123`
- **Authentik**: Setup wizard on first access
- **OPAL**: No authentication required initially

## 🏢 Multi-Tenant Features

### Organization Hierarchy

```
Platform (Root)
├── Organization A
│   ├── Department X
│   └── Team Alpha
└── Organization B
    ├── Department Y
    └── Project Beta
```

### User Roles

- **Owner**: Full organization control
- **Admin**: Manage users and apps
- **Member**: Use organization apps
- **Viewer**: Read-only access

### App Visibility Levels

- **Private**: Creator only
- **Organization**: Organization members
- **Public**: All platform users
- **Marketplace**: Available for installation

## 🔧 Configuration

### Environment Variables (.env)

```bash
# Database
USE_POSTGRES=true
DB_HOST=postgres
DB_NAME=fuzefront_platform

# Authentication
AUTHENTIK_SECRET_KEY=your-secret-key
AUTHENTIK_COOKIE_DOMAIN=fuzefront.local

# Authorization
OPAL_CLIENT_TOKEN=your-opal-token
```

### Database Schema

The platform uses PostgreSQL with these key tables:

- `users` - User accounts
- `organizations` - Organization hierarchy
- `organization_memberships` - User-org relationships
- `apps` - Applications and metadata
- `sessions` - User sessions

## 🔐 Security Configuration

### Authentik Setup

1. Access http://auth.fuzefront.local:9000
2. Complete the setup wizard
3. Configure OIDC/OAuth2 providers
4. Set up MFA and social logins

### OPAL/OPA Policies

```rego
# Example organization access policy
package fuzefront.organizations

default allow = false

allow {
    membership := data.organization_memberships[input.user_id]
    membership.organization_id == input.organization_id
    membership.role in ["owner", "admin", "member"]
}
```

## 📊 Monitoring & Health Checks

### Service Health Endpoints

- Backend: `GET /health`
- Frontend: `GET /health`
- OPA: `GET /health`

### Container Status

```bash
# Check all services
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Check specific service logs
docker logs fuzefront-backend
docker logs authentik-server
docker logs opal-server
```

## 🔨 Development

### Backend Testing

```bash
cd backend
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```

### Database Migrations

```bash
# Apply migrations (handled automatically on startup)
node scripts/apply-all-migrations.js

# Check schema
node scripts/check-schema.js
```

### API Documentation

- OpenAPI/Swagger: http://localhost:3001/api-docs
- Organization API: `POST /api/organizations`
- App API: `GET /api/apps`
- Auth API: `POST /api/auth/login`

## 🚀 Production Deployment

### Security Checklist

- [ ] Change all default passwords and secrets
- [ ] Configure proper SSL certificates
- [ ] Set up proper DNS records
- [ ] Enable proper CORS settings
- [ ] Configure rate limiting
- [ ] Set up monitoring and logging
- [ ] Review REGO policies
- [ ] Enable audit logging

### Environment-Specific Configuration

```bash
# Production
NODE_ENV=production
USE_POSTGRES=true
JWT_SECRET=secure-random-string

# Staging
NODE_ENV=staging
DEBUG_LEVEL=info

# Development
NODE_ENV=development
DEBUG_LEVEL=debug
```

## 🐛 Troubleshooting

### Common Issues

**Database Connection Failed**

```bash
# Check PostgreSQL status
docker logs fuzeinfra-postgres
# Verify database exists
docker exec fuzeinfra-postgres psql -U postgres -l
```

**Authentik Not Starting**

```bash
# Check database dependency
docker logs authentik-database
# Verify environment variables
docker exec authentik-server env | grep AUTHENTIK
```

**OPAL Policies Not Loading**

```bash
# Check OPAL server logs
docker logs opal-server
# Verify OPA client connection
curl http://localhost:8181/health
```

### Log Collection

```bash
# Collect all service logs
docker-compose logs > fuzefront-logs.txt

# Live log monitoring
docker-compose logs -f fuzefront-backend
```

## 📚 API Reference

### Organizations API

```bash
# Create organization
POST /api/organizations
{
  "name": "Acme Corp",
  "type": "organization",
  "parent_id": null
}

# List organizations
GET /api/organizations?type=organization&limit=25

# Get organization
GET /api/organizations/{id}
```

### Apps API

```bash
# List apps (organization-aware)
GET /api/apps

# Install app to organization
POST /api/apps/{id}/install
{
  "organization_id": "org-123"
}
```

### Auth API

```bash
# Login
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password"
}

# Get user profile
GET /api/auth/user
Authorization: Bearer {token}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request

## 📝 License

This project is licensed under the MIT License.
