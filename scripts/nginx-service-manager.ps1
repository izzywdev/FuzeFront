# Nginx Service Discovery Manager
# PowerShell script to manage nginx service discovery and container restarts

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("restart-frontend", "restart-backend", "restart-nginx", "restart-all", "status", "update", "watch")]
    [string]$Action,
    
    [string]$Service = "",
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"

Write-Host "🔧 Nginx Service Discovery Manager" -ForegroundColor Cyan

function Get-ContainerInfo {
    param([string]$ContainerName)
    
    try {
        $info = docker inspect $ContainerName --format "{{.State.Status}} {{.NetworkSettings.Networks.FuzeInfra.IPAddress}}" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $parts = $info.Split(' ')
            return @{
                Status = $parts[0]
                IP = $parts[1]
                Name = $ContainerName
            }
        }
    } catch {
        Write-Warning "Could not get info for container: $ContainerName"
    }
    return $null
}

function Restart-NginxContainer {
    Write-Host "🔄 Restarting nginx container..." -ForegroundColor Yellow
    try {
        docker restart fuzeinfra-nginx
        Start-Sleep -Seconds 3
        Write-Host "✅ Nginx restarted successfully" -ForegroundColor Green
        return $true
    } catch {
        Write-Error "❌ Failed to restart nginx: $_"
        return $false
    }
}

function Restart-FrontendContainer {
    Write-Host "🔄 Restarting frontend container..." -ForegroundColor Yellow
    try {
        docker-compose build fuzefront-frontend
        docker-compose up -d fuzefront-frontend
        Start-Sleep -Seconds 5
        Write-Host "✅ Frontend restarted successfully" -ForegroundColor Green
        return $true
    } catch {
        Write-Error "❌ Failed to restart frontend: $_"
        return $false
    }
}

function Restart-BackendContainer {
    Write-Host "🔄 Restarting backend container..." -ForegroundColor Yellow
    try {
        docker-compose build fuzefront-backend
        docker-compose up -d fuzefront-backend
        Start-Sleep -Seconds 5
        Write-Host "✅ Backend restarted successfully" -ForegroundColor Green
        return $true
    } catch {
        Write-Error "❌ Failed to restart backend: $_"
        return $false
    }
}

function Show-ServiceStatus {
    Write-Host "📊 Current Service Status:" -ForegroundColor Cyan
    
    $containers = @("fuzefront-frontend", "fuzefront-backend", "fuzeinfra-nginx")
    
    foreach ($container in $containers) {
        $info = Get-ContainerInfo $container
        if ($info) {
            $statusColor = if ($info.Status -eq "running") { "Green" } else { "Red" }
            Write-Host "  $($info.Name): " -NoNewline
            Write-Host "$($info.Status)" -ForegroundColor $statusColor -NoNewline
            Write-Host " @ $($info.IP)"
        } else {
            Write-Host "  ${container}: " -NoNewline
            Write-Host "Not Found" -ForegroundColor Red
        }
    }
    
    # Test connectivity
    Write-Host "`n🌐 Testing Connectivity:" -ForegroundColor Cyan
    
    try {
        $response = Invoke-WebRequest -Uri "http://fuzefront.dev.local/" -UseBasicParsing -TimeoutSec 5
        Write-Host "  Frontend via domain: " -NoNewline
        Write-Host "✅ $($response.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "  Frontend via domain: " -NoNewline
        Write-Host "❌ Failed" -ForegroundColor Red
    }
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3010/" -UseBasicParsing -TimeoutSec 5
        Write-Host "  Frontend direct: " -NoNewline
        Write-Host "✅ $($response.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "  Frontend direct: " -NoNewline
        Write-Host "❌ Failed" -ForegroundColor Red
    }
    
    try {
        $response = Invoke-WebRequest -Uri "http://fuzefront.dev.local/health" -UseBasicParsing -TimeoutSec 5
        Write-Host "  Backend health: " -NoNewline
        Write-Host "✅ $($response.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "  Backend health: " -NoNewline
        Write-Host "❌ Failed" -ForegroundColor Red
    }
}

function Update-ServiceDiscovery {
    Write-Host "🔄 Updating service discovery..." -ForegroundColor Yellow
    
    # Get current IPs
    $frontendInfo = Get-ContainerInfo "fuzefront-frontend"
    $backendInfo = Get-ContainerInfo "fuzefront-backend"
    
    if ($frontendInfo -and $backendInfo) {
        Write-Host "Current IPs:"
        Write-Host "  Frontend: $($frontendInfo.IP)"
        Write-Host "  Backend: $($backendInfo.IP)"
        
        # Restart nginx to refresh DNS cache
        if (Restart-NginxContainer) {
            Write-Host "✅ Service discovery updated" -ForegroundColor Green
        }
    } else {
        Write-Warning "Could not get current container information"
    }
}

function Watch-Services {
    Write-Host "👀 Starting service watch mode (Press Ctrl+C to stop)..." -ForegroundColor Cyan
    
    $previousFrontendIP = ""
    $previousBackendIP = ""
    
    try {
        while ($true) {
            $frontendInfo = Get-ContainerInfo "fuzefront-frontend"
            $backendInfo = Get-ContainerInfo "fuzefront-backend"
            
            $currentTime = Get-Date -Format "HH:mm:ss"
            $frontendIP = if ($frontendInfo) { $frontendInfo.IP } else { "N/A" }
            $backendIP = if ($backendInfo) { $backendInfo.IP } else { "N/A" }
            
            $needsUpdate = $false
            
            if ($frontendIP -ne $previousFrontendIP) {
                Write-Host "[$currentTime] Frontend IP changed: $previousFrontendIP -> $frontendIP" -ForegroundColor Yellow
                $previousFrontendIP = $frontendIP
                $needsUpdate = $true
            }
            
            if ($backendIP -ne $previousBackendIP) {
                Write-Host "[$currentTime] Backend IP changed: $previousBackendIP -> $backendIP" -ForegroundColor Yellow
                $previousBackendIP = $backendIP
                $needsUpdate = $true
            }
            
            if ($needsUpdate) {
                Write-Host "[$currentTime] Updating nginx..." -ForegroundColor Cyan
                Restart-NginxContainer | Out-Null
            } else {
                Write-Host "[$currentTime] No changes detected (Frontend: $frontendIP, Backend: $backendIP)" -ForegroundColor Gray
            }
            
            Start-Sleep -Seconds 10
        }
    } catch [System.Management.Automation.TerminateException] {
        Write-Host "`n👋 Watch mode stopped" -ForegroundColor Yellow
    }
}

# Main execution
switch ($Action) {
    "restart-frontend" {
        if (Restart-FrontendContainer) {
            Start-Sleep -Seconds 2
            Restart-NginxContainer | Out-Null
        }
    }
    
    "restart-backend" {
        if (Restart-BackendContainer) {
            Start-Sleep -Seconds 2
            Restart-NginxContainer | Out-Null
        }
    }
    
    "restart-nginx" {
        Restart-NginxContainer | Out-Null
    }
    
    "restart-all" {
        Write-Host "🔄 Restarting all services..." -ForegroundColor Yellow
        Restart-BackendContainer | Out-Null
        Start-Sleep -Seconds 2
        Restart-FrontendContainer | Out-Null
        Start-Sleep -Seconds 2
        Restart-NginxContainer | Out-Null
        Write-Host "✅ All services restarted" -ForegroundColor Green
    }
    
    "status" {
        Show-ServiceStatus
    }
    
    "update" {
        Update-ServiceDiscovery
    }
    
    "watch" {
        Watch-Services
    }
}

Write-Host "🏁 Operation completed" -ForegroundColor Cyan 