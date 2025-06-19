# FuzeFront Backend Test Runner (PowerShell)
# This script runs comprehensive backend authentication tests on Windows

param(
    [string]$Environment = "test",
    [int]$TestTimeout = 30000,
    [string]$BackendUrl = "http://localhost:3004",
    [switch]$UsePostgres = $false,
    [switch]$SkipLive = $false
)

# Error handling
$ErrorActionPreference = "Stop"

# Colors for output
function Write-Info($message) {
    Write-Host "ℹ️  $message" -ForegroundColor Blue
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

# Configuration
$BackendDir = "backend"

# Check if we're in the right directory
if (-not (Test-Path $BackendDir)) {
    Write-Error "Backend directory not found. Please run this script from the project root."
    exit 1
}

Write-Info "🚀 Starting FuzeFront Backend Test Suite"
Write-Info "Environment: $Environment"
Write-Info "Test Timeout: ${TestTimeout}ms"
Write-Info "Backend URL: $BackendUrl"
Write-Host ""

# Change to backend directory
Push-Location $BackendDir

try {
    # Check if package.json exists
    if (-not (Test-Path "package.json")) {
        Write-Error "package.json not found in backend directory"
        exit 1
    }

    # Install dependencies if node_modules doesn't exist
    if (-not (Test-Path "node_modules")) {
        Write-Info "Installing backend dependencies..."
        npm ci
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to install dependencies"
            exit 1
        }
        Write-Success "Dependencies installed"
        Write-Host ""
    }

    # Set test environment variables
    $env:NODE_ENV = $Environment
    $env:JWT_SECRET = if ($env:JWT_SECRET) { $env:JWT_SECRET } else { "test-jwt-secret-key-for-testing-only" }
    $env:FRONTEND_URL = if ($env:FRONTEND_URL) { $env:FRONTEND_URL } else { "http://localhost:3000" }

    # Database configuration
    if ($UsePostgres) {
        $env:USE_POSTGRES = "true"
        $env:DB_HOST = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
        $env:DB_PORT = if ($env:DB_PORT) { $env:DB_PORT } else { "5432" }
        $env:DB_NAME = if ($env:DB_NAME) { $env:DB_NAME } else { "fuzefront_platform_test" }
        $env:DB_USER = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }
        $env:DB_PASSWORD = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "postgres" }
        
        Write-Info "Using PostgreSQL database: $($env:DB_HOST):$($env:DB_PORT)/$($env:DB_NAME)"
        
        # Check if PostgreSQL is accessible (simplified check)
        try {
            $testConnection = Test-NetConnection -ComputerName $env:DB_HOST -Port $env:DB_PORT -WarningAction SilentlyContinue
            if (-not $testConnection.TcpTestSucceeded) {
                Write-Warning "Cannot connect to PostgreSQL at $($env:DB_HOST):$($env:DB_PORT)"
                Write-Warning "Make sure PostgreSQL is running and accessible"
            } else {
                Write-Success "PostgreSQL connection test passed"
            }
        } catch {
            Write-Warning "Could not test PostgreSQL connection: $($_.Exception.Message)"
        }
        Write-Host ""
    } else {
        Write-Info "Using SQLite database for tests"
    }

    # Run linting first
    Write-Info "Running code linting..."
    npm run lint
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Linting passed"
    } else {
        Write-Warning "Linting failed, continuing with tests..."
    }
    Write-Host ""

    # Run type checking
    Write-Info "Running TypeScript type checking..."
    npm run type-check
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Type checking failed"
        exit 1
    }
    Write-Success "Type checking passed"
    Write-Host ""

    # Run authentication unit tests
    Write-Info "Running authentication unit tests..."
    npm run test:auth -- --testTimeout=$TestTimeout
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Authentication unit tests failed"
        exit 1
    }
    Write-Success "Authentication unit tests passed"
    Write-Host ""

    # Run production database tests if PostgreSQL is configured
    if ($UsePostgres) {
        Write-Info "Running production database tests..."
        npm run test:auth:production -- --testTimeout=$TestTimeout
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Production database tests failed"
            exit 1
        }
        Write-Success "Production database tests passed"
        Write-Host ""
    }

    # Generate coverage report
    Write-Info "Generating test coverage report..."
    npm run test:coverage -- --testTimeout=$TestTimeout
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Coverage report generated"
        
        # Display coverage summary
        if (Test-Path "coverage/lcov-report/index.html") {
            Write-Info "Coverage report available at: backend/coverage/lcov-report/index.html"
        }
    } else {
        Write-Warning "Coverage report generation failed"
    }
    Write-Host ""

    # Run live tests if backend is running (optional)
    if (-not $SkipLive) {
        Write-Info "Testing if backend is running at $BackendUrl..."
        try {
            $response = Invoke-WebRequest -Uri "$BackendUrl/health" -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                Write-Info "Backend is running, executing live API tests..."
                node scripts/test-auth.js $BackendUrl
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "Live API tests passed"
                } else {
                    Write-Warning "Live API tests failed (backend may not be fully ready)"
                }
            }
        } catch {
            Write-Info "Backend not running at $BackendUrl, skipping live tests"
            Write-Info "Use -SkipLive to suppress this check"
        }
        Write-Host ""
    }

    # Summary
    Write-Success "🎉 All backend tests completed successfully!"
    Write-Info "Test artifacts:"
    Write-Info "  - Coverage report: backend/coverage/"
    Write-Info "  - Test results: Console output above"

} catch {
    Write-Error "Test execution failed: $($_.Exception.Message)"
    exit 1
} finally {
    # Return to original directory
    Pop-Location
}

exit 0 