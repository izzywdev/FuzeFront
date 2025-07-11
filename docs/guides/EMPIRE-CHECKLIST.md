# 🌟 FuzeFront Empire Startup Checklist

## Prerequisites ✅

### Before You Start

- [ ] **Docker Desktop** is installed and running
- [ ] **PowerShell** with Administrator privileges (for DNS)
- [ ] **Git** repository cloned and current
- [ ] **FuzeInfra** submodule available

### Get Your API Key

- [ ] **Permit.io Account**: Sign up at https://app.permit.io (free)
- [ ] **API Key**: Copy from Permit.io dashboard (starts with `permit_key_`)
- [ ] **Project Name**: "FuzeFront" (or your preferred name)

## 🚀 Empire Launch

### One-Command Setup

```powershell
# Run as Administrator for DNS configuration
.\scripts\initialize-empire.ps1 -PermitApiKey "permit_key_your_actual_key_here"
```

### Step-by-Step Alternative

```powershell
# 1. Start shared infrastructure
cd FuzeInfra
docker compose -f docker-compose.shared-infra.yml up -d

# 2. Configure environment
cd ..
copy backend\env.example .env
# Edit .env with your Permit.io API key

# 3. Start FuzeFront services
docker compose up -d

# 4. Configure DNS (as Administrator)
# Add to C:\Windows\System32\drivers\etc\hosts:
# 127.0.0.1    fuzefront.local
# 127.0.0.1    auth.fuzefront.local
```

## 🏆 Success Verification

### Services Running

- [ ] **PostgreSQL**: `docker ps | grep shared-postgres`
- [ ] **Redis**: `docker ps | grep shared-redis`
- [ ] **FuzeFront Backend**: `curl http://localhost:3001/health`
- [ ] **FuzeFront Frontend**: `curl http://localhost:5173`
- [ ] **Authentik**: `curl http://auth.fuzefront.local:9000`
- [ ] **Permit.io PDP**: `curl http://localhost:7766/health`

### Access Points Working

- [ ] **Frontend**: http://localhost:5173 ✅
- [ ] **API**: http://localhost:3001/api-docs ✅
- [ ] **Authentik Admin**: http://auth.fuzefront.local:9000 ✅
- [ ] **Task Manager**: http://localhost:3002 ✅

## 🔧 Initial Configuration

### 1. Authentik Setup (5 minutes)

- [ ] Visit: http://auth.fuzefront.local:9000
- [ ] Create admin account (follow wizard)
- [ ] Create OIDC application for FuzeFront
- [ ] Copy client credentials to `.env`

### 2. Permit.io Setup (2 minutes)

- [ ] Visit: https://app.permit.io
- [ ] Verify your project is created
- [ ] Set up basic RBAC policies
- [ ] Test authorization with PDP

### 3. Multi-Tenant Test

- [ ] Create organization via API: `POST /api/organizations`
- [ ] List organizations: `GET /api/organizations`
- [ ] Test organization switching in frontend
- [ ] Verify authorization policies work

## 🛠️ Troubleshooting

### Common Issues

- **DNS not working**: Run PowerShell as Administrator
- **Services not starting**: Check Docker Desktop is running
- **Database errors**: Ensure PostgreSQL container is healthy
- **Permit.io errors**: Verify API key is correct

### Quick Fixes

```powershell
# Restart everything
docker compose down
docker compose up -d

# Check logs
docker compose logs -f

# Database issues
docker exec shared-postgres psql -U postgres -l

# Permit.io PDP logs
docker logs fuzefront-permit-pdp
```

## 📚 Next Steps

### Development

- [ ] Read `docs/AUTHENTICATION_SETUP.md`
- [ ] Explore API endpoints at `/api-docs`
- [ ] Test organization management features
- [ ] Set up development workflow

### Production

- [ ] Generate secure secrets
- [ ] Configure HTTPS/SSL
- [ ] Set up monitoring
- [ ] Plan backup strategy

## 🎯 Empire Features Ready

✅ **Multi-Tenant Architecture**: Organizations with hierarchical structure  
✅ **Authentication**: OIDC/OAuth2 via Authentik  
✅ **Authorization**: RBAC/ABAC via Permit.io  
✅ **Module Federation**: Dynamic app loading  
✅ **Shared Infrastructure**: Consolidated PostgreSQL & Redis  
✅ **API Management**: Organization and app APIs  
✅ **Development Tools**: Hot reload, debugging, testing

**🌟 Your FuzeFront Empire is ready to conquer the multi-tenant universe! 🌟**
