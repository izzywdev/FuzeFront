# FuzeFront Authentication & Authorization Setup

> **Status — migration in progress.** FuzeFront and FuzeInfra have moved to
> Kubernetes (Helm chart + ingress-nginx; see
> [`docs/PRODUCTION_DEPLOYMENT.md`](PRODUCTION_DEPLOYMENT.md) and
> [`deploy/helm/fuzefront/README.md`](../deploy/helm/fuzefront/README.md)).
> **Authentik is not yet in the Helm chart** — it is still launched as an **interim**
> step from the legacy root `docker-compose.yml`. The first Helm cut uses local JWT
> auth only; Authentik (OIDC) and Permit (PDP) are added in a later overlay. The
> Docker Compose / Traefik details below are therefore **legacy/interim** and are
> being superseded by the cluster's ingress-nginx + cert-manager.

## Infrastructure Architecture

FuzeFront uses a consolidated infrastructure approach that leverages shared services for optimal resource utilization:

### **Shared Infrastructure (FuzeInfra)**

On Kubernetes (current), FuzeInfra provides these in the `fuzeinfra` namespace,
reachable cross-namespace via CoreDNS:

- **PostgreSQL**: `postgres.fuzeinfra.svc.cluster.local:5432` (Authentik uses
  database `authentik`)
- **Redis**: `redis.fuzeinfra.svc.cluster.local:6379`
- **ingress-nginx**: cluster ingress controller (host ports 80/443) — **replaces**
  the legacy `shared-traefik` reverse proxy. (TLS in prod via cert-manager
  `letsencrypt-prod`.)

> **Legacy (Docker Compose):** the older model named these `shared-postgres`,
> `shared-redis`, and `shared-traefik` containers. Traefik → ingress-nginx is the
> key change.

### **Authentication (Authentik)** — interim via Docker Compose

- **Purpose**: OIDC/OAuth2 authentication provider
- **Deployment**: **Not yet in the Helm chart.** Currently launched from the legacy
  root `docker-compose.yml` (`authentik-server`, `authentik-worker`) as an interim
  step. To be folded into the chart in a later overlay.
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

```bash
# Linux/macOS - Recommended automated setup
./scripts/setup-authentik.sh

# Windows PowerShell (legacy)
.\scripts\setup-infrastructure.ps1

# Manual step by step
cd FuzeInfra && docker-compose -f docker-compose.FuzeInfra.yml up -d
./scripts/init-authentik-db.sh
docker-compose up -d authentik-worker authentik-server
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

## Machine / Service-Account (Agent) Identities

FuzeFront's family-standard machine-identity primitive is an **Authentik service
account authenticating via the OAuth2 client-credentials grant**. An agent acts
**on behalf of a single user, within a single tenant**, and its authorization is
*exactly* that user's reach — cross-user and cross-tenant access are denied by
construction.

- **No bespoke bearer scheme:** agents present a standard OAuth2 access token
  (`Authorization: Bearer <token>`); FuzeFront validates it against the Authentik
  issuer JWKS (`iss`/`aud`/`azp`/`exp`).
- **Permit model:** the agent is a *distinct* Permit principal (`agent:<sub>`),
  with an `Agent —delegate_of→ User` relation recorded for audit. Enforcement
  resolves the agent to its bound `(user, tenant)` and checks **as the user**
  (`backend/src/utils/permit/agent-identity.ts`).
- **Registration + rotation runbook, the worked `permit.check`, and the
  post-freeze runtime tasks** are in
  [`docs/superpowers/plans/2026-06-30-agent-identities.md`](superpowers/plans/2026-06-30-agent-identities.md).

> Status: the Permit-side model + delegation helpers are in place; the runtime
> verification middleware + agent-binding store land in a later deploy-window
> change. Until then the interim hashed-token fallback stands for consumers.

## Service Dependencies

### Startup Order

1. **Shared Infrastructure (FuzeInfra, k8s `fuzeinfra` ns)**: ingress-nginx,
   PostgreSQL, Redis
2. **FuzeFront Core (Helm, `fuzefront` ns)**: Backend, Frontend
3. **Authentik Services** *(interim via `docker-compose.yml`)*: Worker, Server
4. **Permit.io**: PDP *(not yet in the Helm chart)*

### Network Configuration

On Kubernetes, services are reached by DNS name rather than Docker networks:

- `fuzefront-backend:3001`, `fuzefront-frontend:8080` (within the `fuzefront` ns)
- `postgres.fuzeinfra.svc.cluster.local:5432`,
  `redis.fuzeinfra.svc.cluster.local:6379` (cross-namespace via CoreDNS)

> **Legacy (Docker Compose):** the interim Authentik containers still attach to the
> shared `FuzeInfra` Docker network and an internal `fuzefront` network:
>
> ```yaml
> networks:
>   FuzeInfra: # Shared infrastructure network
>     external: true
>   fuzefront: # Internal FuzeFront network
>     internal: false
> ```

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
docker exec fuzeinfra-postgres pg_isready -U postgres

# Verify authentik database exists
docker exec fuzeinfra-postgres psql -U postgres -l | grep authentik

# Test authentik user connection
docker exec fuzeinfra-postgres psql -U authentik_user -d authentik -c "SELECT version();"

# Reinitialize database if needed
./scripts/init-authentik-db.sh
```

**Authentik containers failing to start**

```bash
# Check container logs
docker logs fuzefront-authentik-server
docker logs fuzefront-authentik-worker

# Verify environment variables
docker exec fuzefront-authentik-server env | grep AUTHENTIK

# Restart with fresh containers
docker-compose stop authentik-server authentik-worker
docker-compose rm -f authentik-server authentik-worker
docker-compose up -d authentik-worker authentik-server
```

**Authentik UI not accessible**

```bash
# Check if container is running and healthy
docker ps --filter "name=authentik-server"

# Test direct connection
curl -v http://localhost:9000

# Check DNS resolution
ping auth.fuzefront.local

# Verify hosts file entry
cat /etc/hosts | grep auth.fuzefront.local  # Linux/macOS
type C:\Windows\System32\drivers\etc\hosts | findstr auth.fuzefront.local  # Windows
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
