param(
    [string]$PermitApiKey = "",
    [switch]$Help,
    [switch]$SkipDNS
)

if ($Help) {
    Write-Host ""
    Write-Host "🌟 FuzeFront Empire Startup Script 🌟" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "USAGE:" -ForegroundColor Yellow
    Write-Host "  .\scripts\start-empire.ps1 -PermitApiKey 'permit_key_xxxxx'"
    Write-Host ""
    Write-Host "OPTIONS:" -ForegroundColor Yellow  
    Write-Host "  -PermitApiKey <key>    Your Permit.io API key (required)"
    Write-Host "  -SkipDNS              Skip DNS configuration"
    Write-Host "  -Help                 Show this help"
    Write-Host ""
    Write-Host "PREREQUISITES:" -ForegroundColor Yellow
    Write-Host "  1. Get API key from https://app.permit.io (free account)"
    Write-Host "  2. Docker Desktop running"
    Write-Host "  3. Run as Administrator (for DNS)"
    Write-Host ""
    exit 0
}

Write-Host "🌟 FUZEFRONT EMPIRE INITIALIZATION" -ForegroundColor Magenta

# Validate Permit.io API key
if ([string]::IsNullOrEmpty($PermitApiKey)) {
    Write-Host "❌ Permit.io API key is required!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Get your free API key:" -ForegroundColor Yellow
    Write-Host "1. Go to https://app.permit.io"
    Write-Host "2. Sign up (free account)"
    Write-Host "3. Create project 'FuzeFront'"
    Write-Host "4. Copy API key from dashboard"
    Write-Host ""
    Write-Host "Then run:" -ForegroundColor Yellow
    Write-Host ".\scripts\start-empire.ps1 -PermitApiKey 'permit_key_xxxxx'"
    exit 1
}

# Check Docker
Write-Host "🚀 Checking Docker..." -ForegroundColor Cyan
try {
    docker --version | Out-Null
    Write-Host "✅ Docker is available" -ForegroundColor Green
}
catch {
    Write-Host "❌ Docker not found. Please install Docker Desktop." -ForegroundColor Red
    exit 1
}

# Configure DNS
if (-not $SkipDNS) {
    Write-Host "🚀 Configuring DNS entries..." -ForegroundColor Cyan
    $hostsFile = "C:\Windows\System32\drivers\etc\hosts"
    $entries = @(
        "127.0.0.1    fuzefront.local",
        "127.0.0.1    auth.fuzefront.local"
    )
    
    try {
        foreach ($entry in $entries) {
            $content = Get-Content $hostsFile -ErrorAction SilentlyContinue
            if ($content -notcontains $entry) {
                Add-Content $hostsFile $entry
                Write-Host "   Added: $entry" -ForegroundColor Gray
            }
        }
        Write-Host "✅ DNS configured" -ForegroundColor Green
    }
    catch {
        Write-Host "⚠️  Could not configure DNS. Run as Administrator or use -SkipDNS" -ForegroundColor Yellow
    }
}

# Create .env file with API key
Write-Host "🚀 Configuring environment variables..." -ForegroundColor Cyan
$envContent = Get-Content "backend/env.example"
$envContent = $envContent -replace "PERMIT_API_KEY=.*", "PERMIT_API_KEY=$PermitApiKey"
Set-Content ".env" $envContent
Write-Host "✅ Environment configured" -ForegroundColor Green

# Start shared infrastructure
Write-Host "🚀 Starting shared infrastructure..." -ForegroundColor Cyan
Push-Location "FuzeInfra"
try {
    docker compose -f docker-compose.shared-infra.yml up -d shared-postgres shared-redis shared-traefik
    Write-Host "✅ Shared infrastructure started" -ForegroundColor Green
}
finally {
    Pop-Location
}

Write-Host "ℹ️  Waiting for shared services..." -ForegroundColor Blue
Start-Sleep -Seconds 15

# Create databases
Write-Host "🚀 Creating databases..." -ForegroundColor Cyan
docker exec shared-postgres psql -U postgres -c 'CREATE DATABASE fuzefront_platform;' 2>$null | Out-Null
docker exec shared-postgres psql -U postgres -c 'CREATE DATABASE authentik;' 2>$null | Out-Null
Write-Host "✅ Databases created" -ForegroundColor Green

# Start FuzeFront services
Write-Host "🚀 Starting FuzeFront services..." -ForegroundColor Cyan
docker compose up -d fuzefront-backend fuzefront-frontend task-manager-app
Write-Host "✅ FuzeFront core services started" -ForegroundColor Green

Write-Host "ℹ️  Waiting for backend migrations..." -ForegroundColor Blue
Start-Sleep -Seconds 20

# Start authentication services
Write-Host "🚀 Starting Authentik authentication..." -ForegroundColor Cyan
docker compose up -d authentik-server authentik-worker
Write-Host "✅ Authentik services started" -ForegroundColor Green

# Start authorization services
Write-Host "🚀 Starting Permit.io authorization..." -ForegroundColor Cyan
docker compose up -d permit-pdp
Write-Host "✅ Permit.io PDP started" -ForegroundColor Green

Write-Host "ℹ️  Waiting for all services to be ready..." -ForegroundColor Blue
Start-Sleep -Seconds 30

# Show status
Write-Host ""
Write-Host "🌟 EMPIRE STATUS" -ForegroundColor Magenta
Write-Host ""
Write-Host "🌟 Access Points:" -ForegroundColor Magenta
Write-Host "   Frontend:        http://localhost:5173" -ForegroundColor White
Write-Host "   Backend API:     http://localhost:3001" -ForegroundColor White
Write-Host "   Task Manager:    http://localhost:3002" -ForegroundColor White
Write-Host "   Authentik:       http://auth.fuzefront.local:9000" -ForegroundColor White
Write-Host "   Permit.io PDP:   http://localhost:7766" -ForegroundColor White
Write-Host ""
Write-Host "🔑 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Setup Authentik admin at http://auth.fuzefront.local:9000"
Write-Host "2. Configure OIDC application in Authentik"
Write-Host "3. Set up policies in Permit.io dashboard"
Write-Host "4. Test organization features!"
Write-Host ""

Write-Host "🌟 EMPIRE READY FOR CONQUEST! 🎉" -ForegroundColor Magenta 