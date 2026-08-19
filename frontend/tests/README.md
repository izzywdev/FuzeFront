# FuzeFront Frontend E2E Tests

This directory contains End-to-End (E2E) tests for the FuzeFront frontend application using Playwright.

## Prerequisites

1. **FuzeFront Production Environment Running**

   - Backend: `http://localhost:3004`
   - Frontend: `http://localhost:8085`
   - Database: Connected to shared PostgreSQL

2. **Start the production environment:**
   ```bash
   # From root directory
   docker-compose -f docker-compose.prod.yml up -d
   ```

## Running Tests

### All E2E Tests

```bash
npm run test:e2e
```

### Run Tests with UI (Interactive)

```bash
npm run test:e2e:ui
```

### Run Tests in Debug Mode

```bash
npm run test:e2e:debug
```

### Run Tests with Browser Visible

```bash
npm run test:e2e:headed
```

### View Test Report

```bash
npm run test:e2e:report
```

## Test Scenarios

### Authentication Tests

- ✅ Display login form
- ✅ Successful login with valid credentials
- ✅ Handle invalid credentials
- ✅ CORS error detection
- ✅ API endpoint verification
- 📸 Screenshots for debugging

## Test Credentials

**Default Test User:**

- Email: `admin@frontfuse.dev`
- Password: `admin123`
