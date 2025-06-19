# FuzeFront Authentication & Authorization Infrastructure Setup
# This script sets up Authentik (OIDC/OAuth2) and Permit.io (OPAL/OPA) for FuzeFront

param(
    [switch]$SkipAuthentik,
    [switch]$SkipPermit,
    [switch]$DryRun,
    [string]$Environment = "development"
)

Write-Host "🚀 FuzeFront Multi-Tenant Authentication & Authorization Setup" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green

# Configuration
$FUZEFRONT_DIR = Split-Path $PSScriptRoot
$DOCKER_COMPOSE_FILE = Join-Path $FUZEFRONT_DIR "docker-compose.yml"
$ENV_FILE = Join-Path $FUZEFRONT_DIR ".env"

# Helper Functions
function Write-Step {
    param([string]$Message)
    Write-Host "`n🔧 $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Test-ServiceHealth {
    param(
        [string]$ServiceName,
        [string]$HealthUrl,
        [int]$MaxRetries = 30,
        [int]$RetryDelay = 5
    )
    
    Write-Host "⏳ Waiting for $ServiceName to be healthy..."
    
    for ($i = 1; $i -le $MaxRetries; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Success "$ServiceName is healthy!"
                return $true
            }
        }
        catch {
            # Ignore errors and retry
        }
        
        Write-Host "   Attempt $i/$MaxRetries - waiting..." -ForegroundColor Gray
        Start-Sleep -Seconds $RetryDelay
    }
    
    Write-Error "$ServiceName failed to become healthy after $MaxRetries attempts"
    return $false
}

# Check Prerequisites
Write-Step "Checking prerequisites"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is not installed or not in PATH"
    exit 1
}

if (-not (Get-Command docker-compose -ErrorAction SilentlyContinue)) {
    Write-Error "Docker Compose is not installed or not in PATH"
    exit 1
}

if (-not (Test-Path $DOCKER_COMPOSE_FILE)) {
    Write-Error "Docker Compose file not found: $DOCKER_COMPOSE_FILE"
    exit 1
}

Write-Success "Prerequisites met"

# Check if FuzeInfra is running
Write-Step "Checking FuzeInfra shared infrastructure"

try {
    $infraStatus = docker network ls --filter name=FuzeInfra --format "{{.Name}}"
    if (-not $infraStatus) {
        Write-Warning "FuzeInfra network not found. Starting shared infrastructure..."
        Set-Location (Join-Path $FUZEFRONT_DIR "FuzeInfra")
        
        if ($DryRun) {
            Write-Host "[DRY RUN] Would start FuzeInfra shared infrastructure"
        } else {
            docker-compose -f docker-compose.FuzeInfra.yml up -d postgres redis
            Write-Success "FuzeInfra infrastructure started"
        }
        
        Set-Location $FUZEFRONT_DIR
    } else {
        Write-Success "FuzeInfra network is available"
    }
}
catch {
    Write-Warning "Could not verify FuzeInfra status: $($_.Exception.Message)"
}

# Setup Environment Variables
Write-Step "Setting up environment variables"

if (-not (Test-Path $ENV_FILE)) {
    Write-Host "Creating .env file from template..."
    
    if ($DryRun) {
        Write-Host "[DRY RUN] Would copy backend/env.example to .env"
    } else {
        Copy-Item (Join-Path $FUZEFRONT_DIR "backend" "env.example") $ENV_FILE
        Write-Success "Environment file created"
    }
} else {
    Write-Success "Environment file already exists"
}

# Generate secure secrets if needed
Write-Step "Generating secure secrets"

$envContent = Get-Content $ENV_FILE -ErrorAction SilentlyContinue
if ($envContent) {
    # Check if secrets need to be generated
    if ($envContent -match "generate-random-secret-in-production") {
        Write-Host "Generating Authentik secret key..."
        
        $authentikSecret = [System.Web.Security.Membership]::GeneratePassword(64, 0)
        $opalToken = [System.Web.Security.Membership]::GeneratePassword(32, 0)
        
        if ($DryRun) {
            Write-Host "[DRY RUN] Would update secrets in .env file"
        } else {
            (Get-Content $ENV_FILE) `
                -replace "generate-random-secret-in-production", $authentikSecret `
                -replace "opal-client-secret-token", $opalToken | 
                Set-Content $ENV_FILE
            
            Write-Success "Secrets generated and updated"
        }
    } else {
        Write-Success "Secrets already configured"
    }
}

# Start Authentik Services
if (-not $SkipAuthentik) {
    Write-Step "Starting Authentik authentication services"
    
    if ($DryRun) {
        Write-Host "[DRY RUN] Would start Authentik services"
    } else {
        docker-compose up -d authentik-database authentik-redis
        
        # Wait for database to be ready
        if (Test-ServiceHealth -ServiceName "Authentik Database" -HealthUrl "http://localhost:5432" -MaxRetries 20 -RetryDelay 3) {
            
            # Start Authentik server and worker
            docker-compose up -d authentik-server authentik-worker
            
            # Wait for Authentik to be ready
            if (Test-ServiceHealth -ServiceName "Authentik Server" -HealthUrl "http://localhost:9000" -MaxRetries 30 -RetryDelay 5) {
                Write-Success "Authentik authentication system is ready!"
                Write-Host "🌐 Authentik Admin UI: http://auth.fuzefront.local:9000" -ForegroundColor Blue
                Write-Host "📚 Default admin credentials will be displayed in container logs" -ForegroundColor Blue
            } else {
                Write-Error "Authentik failed to start properly"
            }
        }
    }
} else {
    Write-Warning "Skipping Authentik setup"
}

# Start Permit.io OPAL Services
if (-not $SkipPermit) {
    Write-Step "Starting Permit.io OPAL authorization services"
    
    if ($DryRun) {
        Write-Host "[DRY RUN] Would start OPAL services"
    } else {
        docker-compose up -d opal-redis
        
        # Wait for OPAL Redis to be ready
        if (Test-ServiceHealth -ServiceName "OPAL Redis" -HealthUrl "http://localhost:6379" -MaxRetries 15 -RetryDelay 2) {
            
            # Start OPAL server and client
            docker-compose up -d opal-server opal-client
            
            # Wait for OPA to be ready
            if (Test-ServiceHealth -ServiceName "Open Policy Agent" -HealthUrl "http://localhost:8181/health" -MaxRetries 20 -RetryDelay 3) {
                Write-Success "Permit.io OPAL authorization system is ready!"
                Write-Host "🔐 OPA Policy Engine: http://localhost:8181" -ForegroundColor Blue
                Write-Host "📊 OPAL Server: http://opal.fuzefront.local:7002" -ForegroundColor Blue
            } else {
                Write-Error "OPAL/OPA failed to start properly"
            }
        }
    }
} else {
    Write-Warning "Skipping Permit.io OPAL setup"
}

# Start FuzeFront Services
Write-Step "Starting FuzeFront platform services"

if ($DryRun) {
    Write-Host "[DRY RUN] Would start FuzeFront backend and frontend"
} else {
    docker-compose up -d fuzefront-backend fuzefront-frontend
    
    # Wait for backend to be ready
    if (Test-ServiceHealth -ServiceName "FuzeFront Backend" -HealthUrl "http://localhost:3001/health" -MaxRetries 20 -RetryDelay 5) {
        Write-Success "FuzeFront backend is ready!"
        
        # Wait for frontend to be ready
        if (Test-ServiceHealth -ServiceName "FuzeFront Frontend" -HealthUrl "http://localhost:8080/health" -MaxRetries 15 -RetryDelay 3) {
            Write-Success "FuzeFront frontend is ready!"
        }
    }
}

# Display Setup Summary
Write-Host "`n🎉 Authentication & Authorization Infrastructure Setup Complete!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green

Write-Host "`n📱 FuzeFront Platform:" -ForegroundColor Yellow
Write-Host "   Frontend: http://fuzefront.local:8080" -ForegroundColor White
Write-Host "   Backend:  http://fuzefront.local:3001" -ForegroundColor White
Write-Host "   API Docs: http://fuzefront.local:3001/api-docs" -ForegroundColor White

if (-not $SkipAuthentik) {
    Write-Host "`n🔐 Authentik Authentication:" -ForegroundColor Yellow
    Write-Host "   Admin UI:     http://auth.fuzefront.local:9000" -ForegroundColor White
    Write-Host "   OIDC Issuer:  http://auth.fuzefront.local:9000/application/o/fuzefront/" -ForegroundColor White
    Write-Host "   Default User: Get from container logs: docker logs fuzefront-authentik-server" -ForegroundColor Gray
}

if (-not $SkipPermit) {
    Write-Host "`n🛡️  Authorization (OPAL/OPA):" -ForegroundColor Yellow
    Write-Host "   OPA Engine:   http://localhost:8181" -ForegroundColor White
    Write-Host "   OPAL Server:  http://opal.fuzefront.local:7002" -ForegroundColor White
    Write-Host "   Policy Data:  http://localhost:8181/v1/data" -ForegroundColor White
}

Write-Host "`n🚀 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Configure DNS entries for local development:" -ForegroundColor White
Write-Host "   127.0.0.1  fuzefront.local" -ForegroundColor Gray
Write-Host "   127.0.0.1  auth.fuzefront.local" -ForegroundColor Gray
Write-Host "   127.0.0.1  opal.fuzefront.local" -ForegroundColor Gray
Write-Host "2. Set up Authentik OIDC application for FuzeFront" -ForegroundColor White
Write-Host "3. Configure REGO policies in OPAL for multi-tenant authorization" -ForegroundColor White
Write-Host "4. Update FuzeFront backend to use OIDC authentication" -ForegroundColor White

if ($DryRun) {
    Write-Host "`n⚠️  This was a dry run. No actual changes were made." -ForegroundColor Yellow
}

Write-Host "`n📚 Documentation: See docs/developer-guide.md for detailed setup instructions" -ForegroundColor Blue 