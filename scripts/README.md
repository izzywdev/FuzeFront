# FuzeFront Scripts

This directory contains automation scripts for setting up and managing the FuzeFront platform infrastructure.

> **Deployment is now Kubernetes-based.** FuzeFront and the shared **FuzeInfra**
> services run in a Kubernetes cluster (local **kind** `fuzeinfra`, prod Contabo
> **k3s**). See [Kubernetes deployment](#kubernetes-deployment-kind--helm) below.
> The Authentik scripts in this directory remain relevant because Authentik is still
> launched as an **interim** step from the legacy root `docker-compose.yml` until it
> moves into the Helm chart. Docker Compose / shared-nginx helper scripts are
> **deprecated** — see [Deprecated scripts](#deprecated-scripts-docker-composenginx).

## Kubernetes deployment (kind + Helm)

The standard local deployment path no longer uses docker-compose. Instead:

```bash
# 1. Bring up FuzeInfra (ingress-nginx + Postgres + Redis) in kind
cd FuzeInfra && make kind-up && cd ..       # creates kind cluster "fuzeinfra"
kubectl -n fuzeinfra get pods               # wait until postgres/redis are Running

# 2. Build the FuzeFront images and load them into the cluster
docker build -t fuzefront/backend:local ./backend
docker build -t fuzefront/frontend:local --build-arg VITE_API_URL=http://fuzefront.dev.local ./frontend
kind load docker-image fuzefront/backend:local fuzefront/frontend:local --name fuzeinfra

# 3. Deploy with Helm
helm upgrade --install fuzefront deploy/helm/fuzefront \
  -n fuzefront --create-namespace \
  -f deploy/helm/fuzefront/values-local.yaml

# 4. Add `127.0.0.1 fuzefront.dev.local` to your hosts file, then:
curl http://fuzefront.dev.local/api/health
```

Refresh an image after a code change:

```bash
docker build -t fuzefront/frontend:local ./frontend
kind load docker-image fuzefront/frontend:local --name fuzeinfra
kubectl -n fuzefront rollout restart deployment/fuzefront-frontend
```

Full instructions: [`deploy/helm/fuzefront/README.md`](../deploy/helm/fuzefront/README.md).
Production (Argo CD + k3s): [`docs/PRODUCTION_DEPLOYMENT.md`](../docs/PRODUCTION_DEPLOYMENT.md).

## Deprecated scripts (Docker Compose/nginx)

These scripts belonged to the old docker-compose + shared-nginx model and are **no
longer used** under Kubernetes (ingress-nginx routes traffic; CoreDNS handles
service discovery). Do not use them for the current deployment:

- **`nginx-service-manager.ps1`** — managed the legacy `fuzeinfra-nginx` container
  and its dynamic upstream IPs. Obsolete: Kubernetes Services have stable names, so
  there is nothing to re-resolve. See
  [`docs/SERVICE_DISCOVERY_SOLUTION.md`](../docs/SERVICE_DISCOVERY_SOLUTION.md).
- **`setup-hosts.ps1` (port 8008)** — added the old compose hostname/port mapping.
  Under k8s, just add `127.0.0.1 fuzefront.dev.local` to your hosts file; the app is
  served on the standard ingress port (80), not 8008.

## Authentik Authentication Scripts

> Authentik is still run via the legacy root `docker-compose.yml` as an interim step
> (it is not yet in the Helm chart). The scripts below therefore still operate
> against Docker Compose, but they target the same shared Postgres/Redis that now run
> in the `fuzeinfra` Kubernetes namespace.

### `setup-authentik.sh` - Complete Authentik Setup

**Recommended** - Comprehensive setup script that handles the entire Authentik configuration process.

```bash
# Complete setup (recommended)
./scripts/setup-authentik.sh

# Options
./scripts/setup-authentik.sh --help                    # Show help
./scripts/setup-authentik.sh --dry-run                 # Preview changes
./scripts/setup-authentik.sh --skip-db-init            # Skip database setup
./scripts/setup-authentik.sh --skip-container-start    # Skip container startup
```

**What it does:**
1. ✅ Validates prerequisites (Docker, Docker Compose, FuzeInfra network)
2. ✅ Checks shared infrastructure (PostgreSQL, Redis)
3. ✅ Initializes Authentik database and user
4. ✅ Starts Authentik containers (worker → server)
5. ✅ Performs health checks and validation
6. ✅ Provides configuration summary and next steps

### `init-authentik-db.sh` - Database Initialization Only

Lower-level script for database setup only. Used internally by `setup-authentik.sh`.

```bash
./scripts/init-authentik-db.sh
```

**What it does:**
1. Creates `authentik` database in shared PostgreSQL
2. Creates `authentik_user` with proper permissions
3. Grants necessary database privileges
4. Verifies connection and setup

## Legacy Scripts (Windows PowerShell)

### `setup-auth-infrastructure.ps1`

Legacy PowerShell script for Windows environments. Use `setup-authentik.sh` instead for better reliability.

```powershell
# Windows only (legacy)
.\scripts\setup-auth-infrastructure.ps1
.\scripts\setup-auth-infrastructure.ps1 -SkipAuthentik
.\scripts\setup-auth-infrastructure.ps1 -DryRun
```

## Prerequisites

Before running any scripts, ensure:

1. **FuzeInfra is running (Kubernetes)**:
   ```bash
   cd FuzeInfra && make kind-up        # kind cluster "fuzeinfra" + ingress-nginx + Postgres/Redis
   kubectl -n fuzeinfra get pods       # wait until postgres/redis are Running
   ```

2. **Environment file exists** (for the interim Authentik compose step):
   ```bash
   # Copy and configure .env file
   cp backend/env.example .env
   # Edit .env with your specific settings
   ```

3. **The cluster is reachable**:
   ```bash
   kubectl config use-context kind-fuzeinfra
   kubectl get ns fuzeinfra
   ```

## Common Usage Patterns

### First-time Setup

```bash
# 1. Start shared infrastructure (Kubernetes / kind)
cd FuzeInfra && make kind-up

# 2. Return to project root and set up Authentik (interim, via docker-compose.yml)
cd ..
./scripts/setup-authentik.sh

# 3. Configure hosts file
echo "127.0.0.1  auth.fuzefront.local" | sudo tee -a /etc/hosts

# 4. Access Authentik admin UI
# http://auth.fuzefront.local:9000
```

### Development Workflow

```bash
# Check what would happen (dry run)
./scripts/setup-authentik.sh --dry-run

# Reset Authentik setup
docker-compose stop authentik-server authentik-worker
docker-compose rm -f authentik-server authentik-worker
./scripts/setup-authentik.sh

# Just reinitialize database
./scripts/init-authentik-db.sh
```

### Troubleshooting

```bash
# Check logs
docker-compose logs -f authentik-server authentik-worker

# Verify database connection
docker exec fuzeinfra-postgres psql -U authentik_user -d authentik -c "SELECT version();"

# Health check containers
docker ps --filter "name=authentik" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Test service endpoints
curl -v http://localhost:9000/
curl -v http://auth.fuzefront.local:9000/
```

## Script Architecture

```
setup-authentik.sh              # Main orchestration script
├── Prerequisites check         # Docker, compose, networks
├── Infrastructure validation   # PostgreSQL, Redis containers
├── Database initialization     # Calls init-authentik-db.sh
├── Container management        # Start worker → server
└── Health checks & summary     # Verification and next steps

init-authentik-db.sh            # Database-specific operations
├── Environment loading         # .env configuration
├── Container connectivity      # PostgreSQL connection test
├── Database creation          # CREATE DATABASE authentik
├── User management            # CREATE USER authentik_user
└── Permissions setup          # GRANT privileges
```

## Environment Variables

Key environment variables used by the scripts.

> ⚠️ **Secrets** (`PG_PASS`, `AUTHENTIK_SECRET_KEY`, `AUTHENTIK_BOOTSTRAP_PASSWORD`) must be
> supplied at runtime via `.env` (gitignored) or your secrets manager — see `.env.example`
> for the full list. **Never hardcode real secret values here.** The scripts and
> `docker-compose.yml` read them from the environment.

```bash
# Database Configuration
PG_CONTAINER=fuzeinfra-postgres
PG_USER=authentik_user
PG_PASS=<from .env / secrets manager>          # required — no default
PG_DB=authentik

# Authentik Configuration
AUTHENTIK_SECRET_KEY=<from .env / secrets manager>   # required, min 32 chars
AUTHENTIK_COOKIE_DOMAIN=fuzefront.local
AUTHENTIK_BOOTSTRAP_EMAIL=admin@fuzefront.local
AUTHENTIK_BOOTSTRAP_PASSWORD=<from .env / secrets manager>

# Container Names
AUTHENTIK_SERVER_CONTAINER=fuzefront-authentik-server
AUTHENTIK_WORKER_CONTAINER=fuzefront-authentik-worker
```

## Error Handling

All scripts include comprehensive error handling:

- ✅ Exit on any command failure (`set -e`)
- ✅ Prerequisite validation before execution
- ✅ Service health checks with timeouts
- ✅ Detailed error messages with solutions
- ✅ Cleanup procedures for failed setups
- ✅ Dry-run mode for safe testing

## Logging and Output

Scripts provide structured output:

- 🔧 **Step indicators** for major operations
- ✅ **Success messages** for completed tasks
- ⚠️  **Warning messages** for non-critical issues
- ❌ **Error messages** with troubleshooting guidance
- ℹ️  **Information messages** for context

## Contributing to Scripts

When modifying scripts:

1. **Test thoroughly** with `--dry-run` mode
2. **Update documentation** in this README
3. **Follow error handling** patterns (`set -e`, proper logging)
4. **Add help text** for new options
5. **Maintain backward compatibility** where possible

## Getting Help

```bash
# Script-specific help
./scripts/setup-authentik.sh --help

# Check script status
./scripts/setup-authentik.sh --dry-run

# View logs for troubleshooting
docker-compose logs authentik-server authentik-worker

# Manual verification
docker exec fuzeinfra-postgres psql -U postgres -c "\l" | grep authentik
curl -s http://localhost:9000 && echo "Authentik is responding"
```