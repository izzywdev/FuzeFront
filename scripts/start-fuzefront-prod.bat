@echo off
REM =============================================================================
REM FUZEFRONT PRODUCTION DEPLOYMENT SCRIPT
REM =============================================================================
REM This script starts FuzeFront as a separate Docker group for production use
REM that other projects can depend on while relying on shared infrastructure.
REM =============================================================================

echo 🚀 Starting FuzeFront Platform - Production Deployment
echo =======================================================

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Please start Docker first.
    exit /b 1
)

echo [SUCCESS] Docker is running

REM Check if FuzeInfra network exists
docker network ls | findstr "FuzeInfra" >nul
if errorlevel 1 (
    echo [ERROR] FuzeInfra network not found. Please start the shared infrastructure first:
    echo   cd FuzeInfra ^&^& .\infra-up.bat
    exit /b 1
)

echo [SUCCESS] FuzeInfra network is available

REM Check if shared PostgreSQL is running
docker ps | findstr "shared-postgres" >nul
if errorlevel 1 (
    echo [ERROR] Shared PostgreSQL not found. Please start the shared infrastructure first:
    echo   cd FuzeInfra ^&^& .\infra-up.bat
    exit /b 1
)

echo [SUCCESS] Shared PostgreSQL is running

REM Stop existing production containers if running
echo [INFO] Stopping existing production containers...
docker-compose -f docker-compose.prod.yml down --remove-orphans >nul 2>&1

REM Build and start FuzeFront production platform
echo [FUZEFRONT] Building FuzeFront production images...
docker-compose -f docker-compose.prod.yml build --no-cache

echo [FUZEFRONT] Starting FuzeFront production services...
docker-compose -f docker-compose.prod.yml up -d

REM Wait for services to be healthy
echo [INFO] Waiting for services to be healthy...

echo [INFO] Checking health of fuzefront-backend-prod...
:check_backend
timeout /t 5 /nobreak >nul
docker inspect --format="{{.State.Health.Status}}" fuzefront-backend-prod 2>nul | findstr "healthy" >nul
if errorlevel 1 goto check_backend
echo [SUCCESS] fuzefront-backend-prod is healthy

echo [INFO] Checking health of fuzefront-frontend-prod...
:check_frontend
timeout /t 5 /nobreak >nul
docker inspect --format="{{.State.Health.Status}}" fuzefront-frontend-prod 2>nul | findstr "healthy" >nul
if errorlevel 1 goto check_frontend
echo [SUCCESS] fuzefront-frontend-prod is healthy

echo [INFO] Checking health of fuzefront-taskmanager-prod...
:check_taskmanager
timeout /t 5 /nobreak >nul
docker inspect --format="{{.State.Health.Status}}" fuzefront-taskmanager-prod 2>nul | findstr "healthy" >nul
if errorlevel 1 goto check_taskmanager
echo [SUCCESS] fuzefront-taskmanager-prod is healthy

echo.
echo [SUCCESS] 🎉 FuzeFront Production Platform is ready!
echo.
echo [FUZEFRONT] === FUZEFRONT PRODUCTION SERVICES ===
echo.
echo 🌐 WEB ACCESS:
echo    Frontend:     http://localhost:8085
echo    Task Manager: http://localhost:3003
echo.
echo 🔌 API ACCESS:
echo    Backend API:  http://localhost:3004
echo    API Docs:     http://localhost:3004/api-docs
echo.
echo 📊 HEALTH CHECKS:
echo    Backend:      http://localhost:3004/health
echo    Frontend:     http://localhost:8085/health
echo    Task Manager: http://localhost:3002/health
echo.
echo 🗄️  DATABASE:
echo    PostgreSQL:   localhost:5432
echo    Database:     fuzefront_platform_prod
echo    User:         postgres
echo.
echo 👤 DEMO CREDENTIALS:
echo    Email:        admin@fuzefront.dev
echo    Password:     admin123
echo.
echo 🐳 DOCKER INFO:
echo    Network:      FuzeInfra (shared infrastructure)
echo    Network:      fuzefront-prod (internal services)
echo    Images:       fuzefront/backend:latest
echo                  fuzefront/frontend:latest
echo                  fuzefront/taskmanager:latest
echo.
echo 📦 MANAGEMENT COMMANDS:
echo    Stop:         docker-compose -f docker-compose.prod.yml down
echo    Restart:      docker-compose -f docker-compose.prod.yml restart
echo    Logs:         docker-compose -f docker-compose.prod.yml logs -f [service-name]
echo    Status:       docker-compose -f docker-compose.prod.yml ps
echo.
echo 🔗 FOR OTHER PROJECTS TO CONNECT TO FUZEFRONT:
echo    Network:      fuzefront-prod
echo    Backend URL:  http://fuzefront-backend-prod:3001
echo    Frontend URL: http://fuzefront-frontend-prod:8080
echo. 