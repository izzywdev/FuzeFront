# PowerShell script to add fuzefront.dev.local to hosts file
# Run as Administrator

$hostsPath = "$env:WINDIR\System32\drivers\etc\hosts"
$domain = "fuzefront.dev.local"
$ip = "127.0.0.1"
$entry = "$ip`t$domain"

Write-Host "🔧 Setting up hosts file entry for FuzeFront..." -ForegroundColor Cyan

# Check if running as administrator
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "💡 Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Read current hosts file
$hostsContent = Get-Content $hostsPath -ErrorAction SilentlyContinue

# Check if entry already exists
$existingEntry = $hostsContent | Where-Object { $_ -match $domain }

if ($existingEntry) {
    Write-Host "✅ Entry for $domain already exists in hosts file:" -ForegroundColor Green
    Write-Host "   $existingEntry" -ForegroundColor Gray
} else {
    # Add the entry
    Write-Host "📝 Adding entry to hosts file: $entry" -ForegroundColor Yellow
    
    try {
        Add-Content -Path $hostsPath -Value $entry -Encoding ASCII
        Write-Host "✅ Successfully added $domain to hosts file" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to add entry to hosts file: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "🌐 FuzeFront is now accessible at:" -ForegroundColor Cyan
Write-Host "   Frontend: http://fuzefront.dev.local:8008" -ForegroundColor Green
Write-Host "   Backend:  http://fuzefront.dev.local:8008/api/" -ForegroundColor Green
Write-Host "   Health:   http://fuzefront.dev.local:8008/health" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Note: Using port 8008 because nginx is running on that port" -ForegroundColor Yellow
Write-Host "💡 You can also access via: http://localhost:8008 (with Host header)" -ForegroundColor Yellow 