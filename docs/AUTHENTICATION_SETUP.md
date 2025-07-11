# FuzeFront Authentication & Authorization Setup

## Infrastructure Architecture

FuzeFront uses a consolidated infrastructure approach that leverages shared services for optimal resource utilization:

### **Shared Infrastructure (FuzeInfra)**

- **PostgreSQL**: Single shared database server (`shared-postgres`)
- **Redis**: Single shared cache server (`shared-redis`)
- **Traefik**: Reverse proxy and load balancer (`shared-traefik`)

### **Authentication (Authentik)**

- **Purpose**: OIDC/OAuth2 authentication provider
- **Database**: Uses shared PostgreSQL (database: `authentik`)
- **Cache**: Uses shared Redis for sessions and caching
- **Containers**: `authentik-server`, `authentik-worker`

### **Authorization (Permit.io)**

- **Purpose**: Policy-based authorization with RBAC/ABAC/ReBAC
- **Architecture**: Single PDP container with bundled OPA+OPAL
- **Container**: `permit-pdp` (no separate OPAL containers needed)
- **Ports**: 7766 (PDP API), 8181 (direct OPA access)

## Quick Setup

### 1. Start Infrastructure

```powershell
# Full setup (recommended)
.\scripts\setup-infrastructure.ps1

# Or step by step
.\scripts\setup-infrastructure.ps1 -SkipAuthentik -SkipPermit  # Core only
.\scripts\setup-infrastructure.ps1 -SkipShared -SkipFuzeFront  # Auth only
```

### 2. Configure DNS

Add to your `hosts` file (`C:\Windows\System32\drivers\etc\hosts`):

```
127.0.0.1    auth.fuzefront.local
127.0.0.1    fuzefront.local
```

### 3. Access Services

- **FuzeFront**: http://localhost:5173
- **Authentik**: http://auth.fuzefront.local:9000
- **Permit.io PDP**: http://localhost:7766

## Authentik Configuration

### Initial Setup

1. **Access Authentik**: http://auth.fuzefront.local:9000
2. **Create Admin Account**: Follow first-time setup wizard
3. **Configure Provider**: Create OIDC application for FuzeFront

### OIDC Provider Setup

```yaml
# Application Configuration
Name: FuzeFront
Slug: fuzefront
Provider Type: OAuth2/OpenID Connect

# OAuth Settings
Client Type: confidential
Authorization Grant Type: authorization-code
Client ID: fuzefront-client
Client Secret: [generate secure secret]
Redirect URIs:
  - http://localhost:5173/auth/callback
  - http://fuzefront.local:5173/auth/callback

# Advanced Settings
Access Token Lifetime: 3600 seconds
Refresh Token Lifetime: 86400 seconds
Include User Claims: enabled
```

### Required Environment Variables

```bash
# Update your .env file
AUTHENTIK_CLIENT_ID=fuzefront-client
AUTHENTIK_CLIENT_SECRET=your-generated-secret
AUTHENTIK_ISSUER_URL=http://auth.fuzefront.local:9000/application/o/fuzefront/
AUTHENTIK_DISCOVERY_URL=http://auth.fuzefront.local:9000/application/o/fuzefront/.well-known/openid_configuration
```

## Permit.io Configuration

### 1. Get API Key

1. Sign up at https://app.permit.io
2. Create a new project: "FuzeFront"
3. Copy your API key from the dashboard

### 2. Configure Environment

```bash
# Update your .env file
PERMIT_API_KEY=permit_key_xxxxxxxxxxxxx
PERMIT_DEBUG=True  # Set to False in production
PERMIT_OFFLINE_MODE=false
```

### 3. Define Authorization Model

```javascript
// Example policy definition (via Permit.io dashboard)
{
  "users": ["user1", "user2", "admin"],
  "roles": ["viewer", "member", "admin", "owner"],
  "resources": ["organization", "app", "api_key"],
  "actions": ["read", "write", "delete", "manage"]
}
```

### 4. Integration Examples

```javascript
// Backend authorization check
const permit = new Permit({
  pdp: 'http://localhost:7766',
  token: process.env.PERMIT_API_KEY,
})

const allowed = await permit.check(userId, 'read', {
  type: 'organization',
  tenant: 'org_123',
})
```

## Service Dependencies

### Container Startup Order

1. **Shared Infrastructure**: PostgreSQL, Redis, Traefik
2. **FuzeFront Core**: Backend, Frontend, Task Manager
3. **Authentik Services**: Server, Worker
4. **Permit.io**: PDP

### Network Configuration

```yaml
# Docker networks
networks:
  FuzeInfra: # Shared infrastructure network
    external: true
  fuzefront: # Internal FuzeFront network
    internal: false
```

### Database Setup

```sql
-- Automatically created by setup script
-- PostgreSQL databases on shared-postgres:
CREATE DATABASE fuzefront_platform;  -- FuzeFront core
CREATE DATABASE authentik;           -- Authentik auth
```

## Production Considerations

### Security

- [ ] Generate strong secrets for all services
- [ ] Use proper PostgreSQL credentials (not defaults)
- [ ] Configure HTTPS/TLS for all external endpoints
- [ ] Set `PERMIT_DEBUG=False` for performance
- [ ] Enable Authentik security features (2FA, rate limiting)
- [ ] Use environment-specific Permit.io API keys

### Performance

- [ ] Configure PostgreSQL connection pooling
- [ ] Set appropriate Redis memory limits
- [ ] Monitor Permit.io PDP performance and scaling
- [ ] Configure Authentik session timeout appropriately

### High Availability

- [ ] Deploy multiple Permit.io PDP instances behind load balancer
- [ ] Configure PostgreSQL replication if needed
- [ ] Set up Redis clustering for high availability
- [ ] Monitor service health and implement alerting

## Troubleshooting

### Common Issues

**Authentik database connection fails**

```bash
# Check shared PostgreSQL is running
docker exec shared-postgres pg_isready -U postgres

# Verify authentik database exists
docker exec shared-postgres psql -U postgres -l | grep authentik
```

**Permit.io PDP not responding**

```bash
# Check PDP health
curl http://localhost:7766/health

# Check PDP logs
docker logs fuzefront-permit-pdp
```

**DNS resolution issues**

```powershell
# Test DNS resolution
nslookup auth.fuzefront.local
ping auth.fuzefront.local
```

### Logs and Monitoring

```bash
# View all service logs
docker compose logs -f

# Specific service logs
docker logs fuzefront-authentik-server
docker logs fuzefront-permit-pdp
docker logs shared-postgres
```

## Architecture Benefits

### **Resource Consolidation**

- Single PostgreSQL instance serves all applications
- Single Redis instance for all caching needs
- Reduced container sprawl and resource usage

### **Simplified Management**

- Centralized database administration
- Unified backup and monitoring strategy
- Consistent security and networking configuration

### **Permit.io Integration**

- Native PDP container with bundled OPA+OPAL
- No complex OPAL configuration required
- Built-in offline mode and high availability features
- Official Permit.io container with guaranteed compatibility
