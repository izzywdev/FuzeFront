# FrontFuse GitHub Secrets Setup Script
# Run this script to configure essential GitHub secrets for the repository

Write-Host "🔐 FrontFuse GitHub Secrets Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Check if GitHub CLI is installed and authenticated
$ghStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ GitHub CLI is not authenticated. Please run 'gh auth login' first." -ForegroundColor Red
    exit 1
}

Write-Host "✅ GitHub CLI is authenticated" -ForegroundColor Green

# Function to set secret safely
function Set-GitHubSecret {
    param(
        [string]$SecretName,
        [string]$SecretValue,
        [string]$Description
    )
    
    Write-Host "Setting $SecretName - $Description" -ForegroundColor Yellow
    $result = gh secret set $SecretName --body="$SecretValue"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ $SecretName set successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to set $SecretName" -ForegroundColor Red
    }
}

# Generate JWT Secret
Write-Host "`n🔑 Generating JWT Secret..." -ForegroundColor Cyan
$jwtBytes = [System.Text.Encoding]::UTF8.GetBytes([System.Guid]::NewGuid().ToString() + [System.Guid]::NewGuid().ToString())
$jwtSecret = [System.Convert]::ToBase64String($jwtBytes)
Set-GitHubSecret -SecretName "JWT_SECRET" -SecretValue $jwtSecret -Description "JWT authentication secret"

# Set basic configuration
Write-Host "`n⚙️ Setting basic configuration..." -ForegroundColor Cyan
Set-GitHubSecret -SecretName "DATABASE_URL" -SecretValue "./database.sqlite" -Description "Database connection string"
Set-GitHubSecret -SecretName "FRONTEND_URL" -SecretValue "http://localhost:5173" -Description "Frontend URL for CORS"

# Set Docker registry configuration
Write-Host "`n🐳 Setting Docker registry configuration..." -ForegroundColor Cyan
Set-GitHubSecret -SecretName "DOCKER_REGISTRY" -SecretValue "ghcr.io" -Description "Container registry URL"

# Get GitHub username
$currentUser = gh api user --jq ".login"
Set-GitHubSecret -SecretName "DOCKER_USERNAME" -SecretValue $currentUser -Description "Docker registry username"

# Security webhook placeholder
Set-GitHubSecret -SecretName "SECURITY_WEBHOOK_URL" -SecretValue "https://hooks.slack.com/services/PLACEHOLDER/WEBHOOK/URL" -Description "Security alerts webhook"

# Display what needs to be done manually
Write-Host "`n⚠️  MANUAL STEPS REQUIRED:" -ForegroundColor Yellow
Write-Host "1. Create GitHub Personal Access Token:" -ForegroundColor White
Write-Host "   - Go to: https://github.com/settings/tokens" -ForegroundColor Gray
Write-Host "   - Click 'Generate new token (classic)'" -ForegroundColor Gray
Write-Host "   - Select scopes: 'write:packages', 'read:packages', 'repo'" -ForegroundColor Gray
Write-Host "   - Copy the token and run:" -ForegroundColor Gray
Write-Host "     gh secret set DOCKER_PASSWORD --body=`"your-token-here`"" -ForegroundColor Green

Write-Host "`n2. Optional - Set up NPM token for package publishing:" -ForegroundColor White
Write-Host "   - Get NPM access token from: https://www.npmjs.com/settings/tokens" -ForegroundColor Gray
Write-Host "   - Run: gh secret set NPM_TOKEN --body=`"npm_your-token`"" -ForegroundColor Green

Write-Host "`n3. Optional - Set up security scanning tokens:" -ForegroundColor White
Write-Host "   - Snyk: gh secret set SNYK_TOKEN --body=`"your-snyk-token`"" -ForegroundColor Gray
Write-Host "   - TruffleHog: gh secret set TRUFFLEHOG_TOKEN --body=`"your-trufflehog-token`"" -ForegroundColor Gray

# Show current secrets
Write-Host "`n📋 Current GitHub Secrets:" -ForegroundColor Cyan
gh secret list

Write-Host "`n✅ Basic secrets setup completed!" -ForegroundColor Green
Write-Host "Check SECRETS_SETUP.md for detailed instructions on optional secrets." -ForegroundColor White 