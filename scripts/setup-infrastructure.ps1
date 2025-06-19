# ================================
# FUZEFRONT MULTI-TENANT INFRASTRUCTURE SETUP
# ================================
param(
    [switch]$DryRun,
    [switch]$SkipShared,
    [switch]$SkipFuzeFront,
    [switch]$SkipAuthentik,
    [switch]$SkipPermit,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
FuzeFront Multi-Tenant Infrastructure Setup

USAGE:
    .\scripts\setup-infrastructure.ps1 [OPTIONS]

OPTIONS:
    -DryRun         Show what would be executed without running commands
    -SkipShared     Skip shared infrastructure startup
    -SkipFuzeFront  Skip FuzeFront services startup  
    -SkipAuthentik  Skip Authentik authentication services
    -SkipPermit     Skip Permit.io authorization services
    -Help           Show this help message

ARCHITECTURE:
    - Shared Infrastructure: PostgreSQL, Redis, Traefik (from FuzeInfra)
    - FuzeFront Core: Backend, Frontend, Task Manager
    - Authentik: OIDC/OAuth2 authentication (uses shared PostgreSQL & Redis)
    - Permit.io: PDP authorization (single container with bundled OPA+OPAL)

EXAMPLES:
    .\scripts\setup-infrastructure.ps1                    # Full setup
    .\scripts\setup-infrastructure.ps1 -DryRun            # Preview mode
    .\scripts\setup-infrastructure.ps1 -SkipShared        # Skip shared infra
"@
    exit 0
}

$ErrorActionPreference = "Stop"

function Write-Header($message) {
    Write-Host "`n================================" -ForegroundColor Cyan
    Write-Host $message -ForegroundColor Cyan
    Write-Host "================================`n" -ForegroundColor Cyan
}

function Write-Success($message) {
    Write-Host "✅ $message" -ForegroundColor Green
}

function Write-Warning($message) {
    Write-Host "⚠️  $message" -ForegroundColor Yellow
}

function Write-Error($message) {
    Write-Host "❌ $message" -ForegroundColor Red
}

function Execute-Command($description, $command) {
    Write-Host "🔄 $description..." -ForegroundColor Blue
    
    if ($DryRun) {
        Write-Host "   [DRY RUN] Would execute: $command" -ForegroundColor Gray
        return $true
    }
    
    try {
        Invoke-Expression $command
        Write-Success "$description completed"
        return $true
    }
    catch {
        Write-Error "$description failed: $_"
        return $false
    }
}

function Test-Prerequisites {
    Write-Header "CHECKING PREREQUISITES"
    
    $dockerOk = Execute-Command "Checking Docker" "docker --version"
    $composeOk = Execute-Command "Checking Docker Compose" "docker compose version"
    
    if (-not ($dockerOk -and $composeOk)) {
        Write-Error "Prerequisites not met. Please install Docker and Docker Compose."
        exit 1
    }
}

function Start-SharedInfrastructure {
    if ($SkipShared) {
        Write-Warning "Skipping shared infrastructure startup"
        return
    }
    
    Write-Header "STARTING SHARED INFRASTRUCTURE"
    
    if (-not (Test-Path "FuzeInfra")) {
        Write-Error "FuzeInfra directory not found. Please ensure FuzeInfra is available."
        return
    }
    
    Push-Location "FuzeInfra"
    try {
        Execute-Command "Starting shared PostgreSQL" "docker compose -f docker-compose.shared-infra.yml up -d shared-postgres"
        Execute-Command "Starting shared Redis" "docker compose -f docker-compose.shared-infra.yml up -d shared-redis"
        Execute-Command "Starting shared Traefik" "docker compose -f docker-compose.shared-infra.yml up -d shared-traefik"
        
        Write-Host "⏳ Waiting for shared services to be ready..."
        Start-Sleep -Seconds 10
        
        Write-Success "Shared infrastructure services started"
        Write-Host "   📊 PostgreSQL: localhost:5432" -ForegroundColor Gray
        Write-Host "   🔄 Redis: localhost:6379" -ForegroundColor Gray
        Write-Host "   🌐 Traefik: localhost:8080" -ForegroundColor Gray
    }
    finally {
        Pop-Location
    }
}

function Start-FuzeFrontServices {
    if ($SkipFuzeFront) {
        Write-Warning "Skipping FuzeFront services startup"
        return
    }
    
    Write-Header "STARTING FUZEFRONT CORE SERVICES"
    
    Execute-Command "Starting FuzeFront backend" "docker compose up -d fuzefront-backend"
    Execute-Command "Starting FuzeFront frontend" "docker compose up -d fuzefront-frontend"
    Execute-Command "Starting Task Manager app" "docker compose up -d task-manager-app"
    
    Write-Host "⏳ Waiting for FuzeFront services to be ready..."
    Start-Sleep -Seconds 15
    
    Write-Success "FuzeFront core services started"
    Write-Host "   🎯 Backend API: http://localhost:3001" -ForegroundColor Gray
    Write-Host "   🌐 Frontend: http://localhost:5173" -ForegroundColor Gray
    Write-Host "   📋 Task Manager: http://localhost:3002" -ForegroundColor Gray
}

function Start-AuthentikServices {
    if ($SkipAuthentik) {
        Write-Warning "Skipping Authentik authentication services"
        return
    }
    
    Write-Header "STARTING AUTHENTIK AUTHENTICATION"
    
    Write-Host "📝 Creating Authentik database if needed..." -ForegroundColor Blue
    if (-not $DryRun) {
        # Create Authentik database in shared PostgreSQL
        $createDbCommand = "docker exec shared-postgres psql -U postgres -c `"CREATE DATABASE authentik;`" 2>/dev/null || echo 'Database may already exist'"
        Invoke-Expression $createDbCommand
    }
    
    Execute-Command "Starting Authentik server" "docker compose up -d authentik-server"
    Execute-Command "Starting Authentik worker" "docker compose up -d authentik-worker"
    
    Write-Host "⏳ Waiting for Authentik services to be ready..."
    Start-Sleep -Seconds 30
    
    Write-Success "Authentik authentication services started"
    Write-Host "   🔐 Authentik Web UI: http://auth.fuzefront.local:9000" -ForegroundColor Gray
    Write-Host "   📝 Admin setup required on first run" -ForegroundColor Gray
    Write-Host "   🔗 Uses shared PostgreSQL and Redis" -ForegroundColor Gray
}

function Start-PermitServices {
    if ($SkipPermit) {
        Write-Warning "Skipping Permit.io authorization services"
        return
    }
    
    Write-Header "STARTING PERMIT.IO AUTHORIZATION"
    
    Execute-Command "Starting Permit.io PDP" "docker compose up -d permit-pdp"
    
    Write-Host "⏳ Waiting for Permit.io PDP to be ready..."
    Start-Sleep -Seconds 20
    
    Write-Success "Permit.io authorization service started"
    Write-Host "   🛡️  PDP API: http://localhost:7766" -ForegroundColor Gray
    Write-Host "   🔍 OPA Direct: http://localhost:8181" -ForegroundColor Gray
    Write-Host "   📋 Single container with bundled OPA+OPAL" -ForegroundColor Gray
    Write-Warning "   ⚠️  Configure PERMIT_API_KEY in environment for production"
}

function Show-ServiceStatus {
    Write-Header "SERVICE STATUS SUMMARY"
    
    if (-not $DryRun) {
        Write-Host "🔍 Checking container status..." -ForegroundColor Blue
        docker compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"
    }
    
    Write-Host "`n📋 Access Information:" -ForegroundColor Yellow
    Write-Host "   🌐 FuzeFront Frontend:  http://localhost:5173" -ForegroundColor White
    Write-Host "   🎯 FuzeFront Backend:   http://localhost:3001" -ForegroundColor White
    Write-Host "   📋 Task Manager:        http://localhost:3002" -ForegroundColor White
    Write-Host "   🔐 Authentik:           http://auth.fuzefront.local:9000" -ForegroundColor White
    Write-Host "   🛡️  Permit.io PDP:      http://localhost:7766" -ForegroundColor White
    Write-Host "   📊 Shared PostgreSQL:   localhost:5432" -ForegroundColor White
    Write-Host "   🔄 Shared Redis:        localhost:6379" -ForegroundColor White
    
    Write-Host "`n🔑 Default Credentials:" -ForegroundColor Yellow
    Write-Host "   📊 PostgreSQL: postgres/postgres" -ForegroundColor Gray
    Write-Host "   🔐 Authentik: Setup required on first access" -ForegroundColor Gray
    
    Write-Host "`n⚙️  Configuration Notes:" -ForegroundColor Yellow
    Write-Host "   • Authentik uses shared PostgreSQL (database: authentik)" -ForegroundColor Gray
    Write-Host "   • Authentik uses shared Redis for caching" -ForegroundColor Gray
    Write-Host "   • Permit.io PDP bundles OPA+OPAL internally" -ForegroundColor Gray
    Write-Host "   • No separate OPAL containers needed" -ForegroundColor Gray
    Write-Host "   • Configure DNS: auth.fuzefront.local -> 127.0.0.1" -ForegroundColor Gray
}

function Main {
    Write-Header "FUZEFRONT MULTI-TENANT INFRASTRUCTURE SETUP"
    
    if ($DryRun) {
        Write-Warning "DRY RUN MODE - No commands will be executed"
    }
    
    Test-Prerequisites
    Start-SharedInfrastructure
    Start-FuzeFrontServices
    Start-AuthentikServices
    Start-PermitServices
    Show-ServiceStatus
    
    Write-Header "SETUP COMPLETE"
    Write-Success "FuzeFront multi-tenant infrastructure is ready!"
    Write-Host "📚 Next steps: See docs/AUTHENTICATION_SETUP.md for Authentik configuration" -ForegroundColor Blue
}

Main 