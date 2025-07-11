# 🌟 FuzeFront Empire Setup

## Quick Start (5 minutes)

### 1. Get Your Permit.io API Key

1. **Sign up**: https://app.permit.io (free account)
2. **Create project**: "FuzeFront"
3. **Copy API key**: Starts with `permit_key_`

### 2. Start the Empire

```powershell
# Run as Administrator in PowerShell
.\scripts\start-empire.ps1 -PermitApiKey "permit_key_your_actual_key_here"
```

### 3. Access Your Empire

- **🌐 Frontend**: http://localhost:5173
- **🎯 API**: http://localhost:3001
- **🔐 Authentik**: http://auth.fuzefront.local:9000
- **🛡️ Permit.io**: http://localhost:7766

## What You Get

✅ **Multi-Tenant Organizations**: Create and manage organizations  
✅ **Authentication**: OIDC/OAuth2 via Authentik  
✅ **Authorization**: RBAC/ABAC via Permit.io  
✅ **Module Federation**: Dynamic app loading  
✅ **Shared Infrastructure**: PostgreSQL, Redis, Traefik  
✅ **API Management**: REST APIs with Swagger docs

## Next Steps

### 1. Configure Authentik (5 minutes)

1. Visit http://auth.fuzefront.local:9000
2. Create admin account
3. Create OIDC application for FuzeFront
4. Copy client credentials

### 2. Set Up Authorization (2 minutes)

1. Visit https://app.permit.io
2. Configure RBAC policies
3. Test authorization with PDP

### 3. Test Multi-Tenancy

```bash
# Create an organization
curl -X POST http://localhost:3001/api/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name": "My Organization", "type": "business"}'

# List organizations
curl http://localhost:3001/api/organizations
```

## Troubleshooting

### DNS Issues

```powershell
# Skip DNS and configure manually
.\scripts\start-empire.ps1 -SkipDNS -PermitApiKey "your_key"

# Add to C:\Windows\System32\drivers\etc\hosts:
# 127.0.0.1    fuzefront.local
# 127.0.0.1    auth.fuzefront.local
```

### Service Issues

```powershell
# Check service status
docker compose ps

# View logs
docker compose logs -f

# Restart specific service
docker compose restart fuzefront-backend
```

### Database Issues

```powershell
# Check database
docker exec shared-postgres psql -U postgres -l

# Run migrations manually
docker exec fuzefront-backend npm run migrate
```

## Architecture

```
FuzeFront Empire
├── Shared Infrastructure (FuzeInfra)
│   ├── PostgreSQL (shared-postgres:5432)
│   ├── Redis (shared-redis:6379)
│   └── Traefik (shared-traefik:8080)
├── FuzeFront Core
│   ├── Backend API (localhost:3001)
│   ├── Frontend (localhost:5173)
│   └── Task Manager (localhost:3002)
├── Authentication (Authentik)
│   ├── Server (auth.fuzefront.local:9000)
│   └── Worker (background tasks)
└── Authorization (Permit.io)
    └── PDP (localhost:7766)
```

## Empire Features

- **🏢 Organizations**: Hierarchical multi-tenant structure
- **👥 Users**: OIDC authentication with role management
- **📱 Apps**: Module federation with marketplace
- **🔑 API Keys**: Secure API access management
- **🛡️ Policies**: Fine-grained authorization rules
- **📊 Analytics**: Real-time usage monitoring

**🌟 Ready to conquer the multi-tenant universe! 🌟**
