@echo off
REM FuzeFront Platform Startup Script for Windows
REM This script starts the entire FuzeFront platform with shared infrastructure

setlocal EnableDelayedExpansion

echo 🚀 Starting FuzeFront Platform...
echo ==================================

REM Check if Docker is running
docker info >nul 2>&1
if !errorlevel! neq 0 (
    echo [ERROR] Docker is not running. Please start Docker first.
    pause
    exit /b 1
)

echo [SUCCESS] Docker is running

REM Check if shared infrastructure is running
echo [INFO] Checking shared infrastructure...
docker network ls | findstr "shared-infra" >nul
if !errorlevel! neq 0 (
    echo [WARNING] Shared infrastructure network not found. Creating...
    docker network create shared-infra
)

docker ps | findstr "shared-postgres" >nul
if !errorlevel! neq 0 (
    echo [INFO] Starting shared PostgreSQL infrastructure...
    cd FuzeInfra
    docker-compose -f docker-compose.shared-infra.yml up -d postgres
    cd ..
    
    REM Wait for PostgreSQL to be ready
    echo [INFO] Waiting for PostgreSQL to be ready...
    set timeout=60
    :wait_postgres
    docker exec shared-postgres pg_isready -U postgres >nul 2>&1
    if !errorlevel! equ 0 goto postgres_ready
    if !timeout! leq 0 (
        echo [ERROR] PostgreSQL failed to start within 60 seconds
        pause
        exit /b 1
    )
    timeout /t 2 /nobreak >nul
    set /a timeout=timeout-2
    echo|set /p="."
    goto wait_postgres
    
    :postgres_ready
    echo.
    echo [SUCCESS] PostgreSQL is ready
) else (
    echo [SUCCESS] Shared PostgreSQL is already running
)

REM Build and start FuzeFront platform
echo [INFO] Building and starting FuzeFront platform...
docker-compose down --remove-orphans >nul 2>&1
docker-compose build --no-cache
docker-compose up -d

REM Wait for services to be healthy
echo [INFO] Waiting for services to be healthy...

REM Check backend health
echo [INFO] Checking health of fuzefront-backend...
set timeout=120
:check_backend
docker inspect --format="{{.State.Health.Status}}" fuzefront-backend 2>nul | findstr "healthy" >nul
if !errorlevel! equ 0 (
    echo [SUCCESS] fuzefront-backend is healthy
    goto check_frontend
)
docker inspect --format="{{.State.Health.Status}}" fuzefront-backend 2>nul | findstr "unhealthy" >nul
if !errorlevel! equ 0 (
    echo [ERROR] fuzefront-backend is unhealthy
    docker-compose logs fuzefront-backend
    pause
    exit /b 1
)
if !timeout! leq 0 (
    echo [ERROR] fuzefront-backend failed to become healthy within 2 minutes
    docker-compose logs fuzefront-backend
    pause
    exit /b 1
)
timeout /t 5 /nobreak >nul
set /a timeout=timeout-5
echo|set /p="."
goto check_backend

:check_frontend
REM Check frontend health
echo [INFO] Checking health of fuzefront-frontend...
set timeout=120
:check_frontend_loop
docker inspect --format="{{.State.Health.Status}}" fuzefront-frontend 2>nul | findstr "healthy" >nul
if !errorlevel! equ 0 (
    echo [SUCCESS] fuzefront-frontend is healthy
    goto check_taskmanager
)
docker inspect --format="{{.State.Health.Status}}" fuzefront-frontend 2>nul | findstr "unhealthy" >nul
if !errorlevel! equ 0 (
    echo [ERROR] fuzefront-frontend is unhealthy
    docker-compose logs fuzefront-frontend
    pause
    exit /b 1
)
if !timeout! leq 0 (
    echo [ERROR] fuzefront-frontend failed to become healthy within 2 minutes
    docker-compose logs fuzefront-frontend
    pause
    exit /b 1
)
timeout /t 5 /nobreak >nul
set /a timeout=timeout-5
echo|set /p="."
goto check_frontend_loop

:check_taskmanager
REM Check task manager health
echo [INFO] Checking health of fuzefront-taskmanager...
set timeout=120
:check_taskmanager_loop
docker inspect --format="{{.State.Health.Status}}" fuzefront-taskmanager 2>nul | findstr "healthy" >nul
if !errorlevel! equ 0 (
    echo [SUCCESS] fuzefront-taskmanager is healthy
    goto platform_ready
)
docker inspect --format="{{.State.Health.Status}}" fuzefront-taskmanager 2>nul | findstr "unhealthy" >nul
if !errorlevel! equ 0 (
    echo [ERROR] fuzefront-taskmanager is unhealthy
    docker-compose logs fuzefront-taskmanager
    pause
    exit /b 1
)
if !timeout! leq 0 (
    echo [ERROR] fuzefront-taskmanager failed to become healthy within 2 minutes
    docker-compose logs fuzefront-taskmanager
    pause
    exit /b 1
)
timeout /t 5 /nobreak >nul
set /a timeout=timeout-5
echo|set /p="."
goto check_taskmanager_loop

:platform_ready
echo.
echo [SUCCESS] 🎉 FuzeFront Platform is ready!
echo.
echo 🌐 Access URLs:
echo    Frontend:     http://localhost:8080
echo    Backend API:  http://localhost:3001
echo    Task Manager: http://localhost:3002
echo    API Docs:     http://localhost:3001/api-docs
echo.
echo 📊 Health Checks:
echo    Backend:      http://localhost:3001/health
echo    Frontend:     http://localhost:8080/health
echo    Task Manager: http://localhost:3002/health
echo.
echo 🗄️  Database:
echo    PostgreSQL:   localhost:5432
echo    Database:     fuzefront_platform
echo    User:         postgres
echo.
echo 👤 Demo Credentials:
echo    Email:        admin@fuzefront.dev
echo    Password:     admin123
echo.
echo 📦 To stop the platform:
echo    docker-compose down
echo.
echo 📋 To view logs:
echo    docker-compose logs -f [service-name]
echo.
pause 