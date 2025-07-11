# Quick Status Checker for FuzeFront Services
Write-Host "📊 FuzeFront Services Status" -ForegroundColor Cyan

# Get container info
Write-Host "`n🐳 Container Status:" -ForegroundColor Yellow
$containers = @("fuzefront-frontend", "fuzefront-backend", "fuzeinfra-nginx")

foreach ($container in $containers) {
    try {
        $info = docker inspect $container --format "{{.State.Status}} {{.NetworkSettings.Networks.FuzeInfra.IPAddress}}" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $parts = $info.Split(' ')
            $status = $parts[0]
            $ip = $parts[1]
            $statusColor = if ($status -eq "running") { "Green" } else { "Red" }
            Write-Host "  ✓ ${container}: " -NoNewline
            Write-Host "$status" -ForegroundColor $statusColor -NoNewline
            Write-Host " @ $ip"
        }
    } catch {
        Write-Host "  ✗ ${container}: Not Found" -ForegroundColor Red
    }
}

# Test connectivity
Write-Host "`n🌐 Connectivity Tests:" -ForegroundColor Yellow

$tests = @(
    @{ Name = "Frontend (domain)"; Url = "http://fuzefront.dev.local/" },
    @{ Name = "Frontend (direct)"; Url = "http://localhost:3010/" },
    @{ Name = "Backend (health)"; Url = "http://fuzefront.dev.local/health" },
    @{ Name = "Backend (direct)"; Url = "http://localhost:3011/health" }
)

foreach ($test in $tests) {
    try {
        $response = Invoke-WebRequest -Uri $test.Url -UseBasicParsing -TimeoutSec 3
        Write-Host "  ✓ $($test.Name): " -NoNewline
        Write-Host "HTTP $($response.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ $($test.Name): " -NoNewline
        Write-Host "Failed" -ForegroundColor Red
    }
}

Write-Host "`n✅ Status check completed" -ForegroundColor Green 