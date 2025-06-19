# ================================
# FUZEFRONT EMPIRE INITIALIZATION
# ================================
param(
    [switch]$Help,
    [switch]$SkipDNS,
    [switch]$SkipDatabase,
    [switch]$SkipAuthentik,
    [switch]$SkipPermit,
    [string]$PermitApiKey = "",
    [switch]$DryRun
)

if ($Help) {
    Write-Host @"
🌟 FuzeFront Empire Initialization Script 🌟

Brings up the complete multi-tenant platform with authentication and authorization.

USAGE:
    .\scripts\initialize-empire.ps1 [OPTIONS]

OPTIONS:
    -PermitApiKey <key>    Permit.io API key (get from https://app.permit.io)
    -SkipDNS              Skip DNS/hosts file configuration  
    -SkipDatabase         Skip database initialization
    -SkipAuthentik        Skip Authentik setup
    -SkipPermit           Skip Permit.io configuration
    -DryRun               Show what would be done without executing
    -Help                 Show this help

PREREQUISITES:
    1. Get Permit.io API key: https://app.permit.io (free account)
    2. Ensure Docker Desktop is running
    3. Run as Administrator (for DNS configuration)

EXAMPLES:
    .\scripts\initialize-empire.ps1 -PermitApiKey "permit_key_xxxxx"
    .\scripts\initialize-empire.ps1 -SkipDNS -PermitApiKey "permit_key_xxxxx"
"@
    exit 0
}

$ErrorActionPreference = "Stop"

# Colors and formatting
function Write-Empire($message) {
    Write-Host "🌟 $message" -ForegroundColor Magenta
}

function Write-Step($message) {
    Write-Host "🚀 $message" -ForegroundColor Cyan
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

function Write-Info($message) {
    Write-Host "ℹ️  $message" -ForegroundColor Blue
}

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Step($description, $scriptBlock) {
    Write-Step $description
    
    if ($DryRun) {
        Write-Host "   [DRY RUN] Would execute: $description" -ForegroundColor Gray
        return $true
    }
    
    try {
        & $scriptBlock
        Write-Success "$description completed"
        return $true
    }
    catch {
        Write-Error "$description failed: $_"
        return $false
    }
}

function Initialize-DNS {
    if ($SkipDNS) {
        Write-Warning "Skipping DNS configuration"
        return
    }
    
    Write-Empire "CONFIGURING DNS"
    
    if (-not (Test-Administrator)) {
        Write-Error "DNS configuration requires Administrator privileges"
        Write-Info "Please run PowerShell as Administrator or use -SkipDNS flag"
        exit 1
    }
    
    $hostsFile = "C:\Windows\System32\drivers\etc\hosts"
    $entries = @(
        "127.0.0.1    fuzefront.local",
        "127.0.0.1    auth.fuzefront.local",
        "127.0.0.1    api.fuzefront.local",
        "127.0.0.1    taskmanager.fuzefront.local"
    )
    
    Invoke-Step "Configuring hosts file" {
        $hostsContent = Get-Content $hostsFile -ErrorAction SilentlyContinue
        
        foreach ($entry in $entries) {
            $domain = ($entry -split '\s+')[1]
            if ($hostsContent -notcontains $entry -and $hostsContent -notmatch $domain) {
                Write-Host "   Adding: $entry" -ForegroundColor Gray
                Add-Content $hostsFile $entry
            } else {
                Write-Host "   Already exists: $domain" -ForegroundColor Gray
            }
        }
    }
}

function Start-Infrastructure {
    Write-Empire "STARTING SHARED INFRASTRUCTURE"
    
    # Check if FuzeInfra is available
    if (-not (Test-Path "FuzeInfra")) {
        Write-Error "FuzeInfra directory not found!"
        Write-Info "Please ensure FuzeInfra is available in the current directory"
        exit 1
    }
    
    Push-Location "FuzeInfra"
    try {
        Invoke-Step "Starting shared PostgreSQL" {
            docker compose -f docker-compose.shared-infra.yml up -d shared-postgres
        }
        
        Invoke-Step "Starting shared Redis" {
            docker compose -f docker-compose.shared-infra.yml up -d shared-redis  
        }
        
        Invoke-Step "Starting shared Traefik" {
            docker compose -f docker-compose.shared-infra.yml up -d shared-traefik
        }
        
        Write-Info "Waiting for shared services to be ready..."
        Start-Sleep -Seconds 15
        
    } finally {
        Pop-Location
    }
}

function Initialize-Database {
    if ($SkipDatabase) {
        Write-Warning "Skipping database initialization"
        return
    }
    
    Write-Empire "INITIALIZING DATABASES"
    
    Invoke-Step "Creating FuzeFront database" {
        docker exec shared-postgres psql -U postgres -c "CREATE DATABASE fuzefront_platform;" 2>$null | Out-Null
    }
    
    Invoke-Step "Creating Authentik database" {
        docker exec shared-postgres psql -U postgres -c "CREATE DATABASE authentik;" 2>$null | Out-Null
    }
    
    Write-Info "Starting FuzeFront backend to run migrations..."
    Invoke-Step "Starting FuzeFront backend" {
        docker compose up -d fuzefront-backend
    }
    
    Write-Info "Waiting for migrations to complete..."
    Start-Sleep -Seconds 20
    
    # Check if migrations ran successfully
    Invoke-Step "Verifying database schema" {
        $tables = docker exec shared-postgres psql -U postgres -d fuzefront_platform -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
        if ($tables -match "organizations" -and $tables -match "organization_memberships") {
            Write-Success "Multi-tenant schema verified"
        } else {
            throw "Database schema not properly initialized"
        }
    }
}

function Start-CoreServices {
    Write-Empire "STARTING FUZEFRONT CORE SERVICES"
    
    Invoke-Step "Starting FuzeFront frontend" {
        docker compose up -d fuzefront-frontend
    }
    
    Invoke-Step "Starting Task Manager app" {
        docker compose up -d task-manager-app
    }
    
    Write-Info "Waiting for services to be ready..."
    Start-Sleep -Seconds 10
}

function Initialize-Authentik {
    if ($SkipAuthentik) {
        Write-Warning "Skipping Authentik initialization"
        return
    }
    
    Write-Empire "INITIALIZING AUTHENTIK AUTHENTICATION"
    
    Invoke-Step "Starting Authentik server" {
        docker compose up -d authentik-server
    }
    
    Invoke-Step "Starting Authentik worker" {
        docker compose up -d authentik-worker
    }
    
    Write-Info "Waiting for Authentik to be ready..."
    Start-Sleep -Seconds 30
    
    # Test Authentik availability
    $maxRetries = 10
    $retries = 0
    do {
        try {
            $response = Invoke-WebRequest -Uri "http://auth.fuzefront.local:9000" -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                Write-Success "Authentik is responding"
                break
            }
        }
        catch {
            $retries++
            if ($retries -lt $maxRetries) {
                Write-Info "Waiting for Authentik... (attempt $retries/$maxRetries)"
                Start-Sleep -Seconds 10
            } else {
                Write-Warning "Authentik may not be fully ready yet"
                break
            }
        }
    } while ($retries -lt $maxRetries)
}

function Initialize-Permit {
    if ($SkipPermit) {
        Write-Warning "Skipping Permit.io initialization"
        return
    }
    
    Write-Empire "INITIALIZING PERMIT.IO AUTHORIZATION"
    
    if ([string]::IsNullOrEmpty($PermitApiKey)) {
        Write-Error "Permit.io API key is required!"
        Write-Info @"
Please get your API key from https://app.permit.io:
1. Sign up for free account
2. Create a new project: "FuzeFront"  
3. Copy the API key from the dashboard
4. Run: .\scripts\initialize-empire.ps1 -PermitApiKey "permit_key_xxxxx"
"@
        exit 1
    }
    
    # Update environment with Permit API key
    Invoke-Step "Configuring Permit.io API key" {
        $envFile = ".env"
        if (Test-Path $envFile) {
            $content = Get-Content $envFile
            $content = $content -replace "PERMIT_API_KEY=.*", "PERMIT_API_KEY=$PermitApiKey"
            Set-Content $envFile $content
        } else {
            # Create .env from example
            Copy-Item "backend/env.example" $envFile
            $content = Get-Content $envFile
            $content = $content -replace "PERMIT_API_KEY=.*", "PERMIT_API_KEY=$PermitApiKey"
            Set-Content $envFile $content
        }
    }
    
    Invoke-Step "Starting Permit.io PDP" {
        docker compose up -d permit-pdp
    }
    
    Write-Info "Waiting for Permit.io PDP to be ready..."
    Start-Sleep -Seconds 20
    
    # Test PDP availability
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:7766/health" -TimeoutSec 10 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Success "Permit.io PDP is responding"
        }
    }
    catch {
        Write-Warning "Permit.io PDP may not be fully ready yet - check logs: docker logs fuzefront-permit-pdp"
    }
}

function Show-EmpireStatus {
    Write-Empire "EMPIRE STATUS SUMMARY"
    
    if (-not $DryRun) {
        Write-Info "Checking service status..."
        try {
            docker compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}" 2>$null
        }
        catch {
            Write-Warning "Could not retrieve service status"
        }
    }
    
    Write-Host "`n🌟 FUZEFRONT EMPIRE ACCESS POINTS:" -ForegroundColor Magenta
    Write-Host "   🌐 Frontend:          http://localhost:5173" -ForegroundColor White
    Write-Host "   🌐 Frontend (domain): http://fuzefront.local:5173" -ForegroundColor White
    Write-Host "   🎯 Backend API:       http://localhost:3001" -ForegroundColor White
    Write-Host "   📋 Task Manager:      http://localhost:3002" -ForegroundColor White
    Write-Host "   🔐 Authentik Admin:   http://auth.fuzefront.local:9000" -ForegroundColor White
    Write-Host "   🛡️  Permit.io PDP:    http://localhost:7766" -ForegroundColor White
    Write-Host "   📊 PostgreSQL:        localhost:5432" -ForegroundColor White
    Write-Host "   🔄 Redis:            localhost:6379" -ForegroundColor White
    
    Write-Host "`n🔑 CREDENTIALS & SETUP:" -ForegroundColor Yellow
    Write-Host "   📊 PostgreSQL:   postgres/postgres" -ForegroundColor Gray
    Write-Host "   🔐 Authentik:     Initial setup required at admin URL" -ForegroundColor Gray
    Write-Host "   🛡️  Permit.io:    API key configured" -ForegroundColor Gray
    
    Write-Host "`n📋 NEXT STEPS:" -ForegroundColor Blue
    Write-Host "   1. Setup Authentik admin: http://auth.fuzefront.local:9000" -ForegroundColor White
    Write-Host "   2. Create OIDC application in Authentik for FuzeFront" -ForegroundColor White
    Write-Host "   3. Configure authorization policies in Permit.io dashboard" -ForegroundColor White
    Write-Host "   4. Test multi-tenant organization features" -ForegroundColor White
    
    Write-Host "`n📚 DOCUMENTATION:" -ForegroundColor Blue
    Write-Host "   • Authentication: docs/AUTHENTICATION_SETUP.md" -ForegroundColor Gray
    Write-Host "   • API Documentation: http://localhost:3001/api-docs" -ForegroundColor Gray
    Write-Host "   • Permit.io Dashboard: https://app.permit.io" -ForegroundColor Gray
}

function Main {
    Write-Empire "FUZEFRONT EMPIRE INITIALIZATION STARTING"
    Write-Host "🚀 Bringing up the complete multi-tenant platform..." -ForegroundColor Cyan
    
    if ($DryRun) {
        Write-Warning "DRY RUN MODE - No changes will be made"
    }
    
    # Validate prerequisites
    try {
        docker --version | Out-Null
    }
    catch {
        Write-Error "Docker is required but not found. Please install Docker Desktop."
        exit 1
    }
    
    Initialize-DNS
    Start-Infrastructure  
    Initialize-Database
    Start-CoreServices
    Initialize-Authentik
    Initialize-Permit
    Show-EmpireStatus
    
    Write-Empire "EMPIRE INITIALIZATION COMPLETE! 🎉"
    Write-Success "FuzeFront multi-tenant platform is ready for conquest!"
}

# Execute main function
Main 