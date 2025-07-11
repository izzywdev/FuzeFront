# Manual Playwright Testing Guide for Windows

## 🚨 Terminal Session Issue

The automated terminal commands aren't working in this session. Please run these commands manually in your Windows terminal.

## 🎭 Running Playwright Authentication Tests

### Option 1: Using the Batch File (Easiest)

1. **Open Command Prompt or PowerShell** in the FuzeFront directory
2. **Run the batch file:**
   ```cmd
   run-playwright-tests.bat
   ```

### Option 2: Using PowerShell Script

1. **Open PowerShell** in the FuzeFront directory
2. **Run the PowerShell script:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File run-playwright-tests.ps1
   ```

### Option 3: Manual Step-by-Step Commands

1. **Open Command Prompt or PowerShell**
2. **Navigate to frontend directory:**

   ```cmd
   cd frontend
   ```

3. **Install dependencies (if not already done):**

   ```cmd
   npm install
   ```

4. **Install Playwright browsers:**

   ```cmd
   npx playwright install
   ```

5. **Run the authentication tests:**

   ```cmd
   npm run test:e2e
   ```

6. **View test report:**
   ```cmd
   npm run test:e2e:report
   ```

## 🧪 What the Tests Will Check

### 1. **Basic Authentication Tests** (`tests/auth.spec.ts`)

- ✅ Login form display and elements
- ✅ Successful login with valid credentials (`admin@frontfuse.dev` / `admin123`)
- ✅ Error handling for invalid credentials

### 2. **Advanced Flow Tests** (`tests/auth-flow.spec.ts`)

- 🔍 Network connectivity monitoring
- 🚫 CORS error detection
- 📡 API request/response tracking
- 🔐 Complete authentication flow

## 📊 Expected Test Results

### If Backend is Working:

```
✅ should display login form
✅ should successfully login with valid credentials
✅ should show error for invalid credentials
✅ should handle network connectivity
✅ should complete authentication flow
```

### If Backend is Down:

```
✅ should display login form
❌ should successfully login with valid credentials (Network Error)
❌ should handle network connectivity (Connection refused)
❌ should complete authentication flow (Timeout)
```

### If API URL is Wrong:

```
✅ should display login form
❌ should successfully login with valid credentials (404 Not Found)
❌ should complete authentication flow (Wrong endpoint)
```

## 🔍 Interpreting Results

### ✅ **All Tests Pass**

- Frontend and backend are working correctly
- Authentication flow is functional
- Network connectivity is good

### ❌ **Network/Connection Errors**

- Backend container is not running or accessible
- Check: `docker ps | findstr fuzefront-backend`
- Fix: Restart backend container

### ❌ **CORS Errors**

- Backend CORS configuration issue
- Check backend logs for CORS rejections
- Verify CORS_ORIGINS environment variable

### ❌ **404 Errors**

- API URL mismatch (should be fixed now)
- Backend routes not properly configured
- Check if backend is listening on correct port

## 🛠️ Troubleshooting Commands

### Check Container Status:

```cmd
docker ps -a | findstr fuzefront
```

### Check Backend Logs:

```cmd
docker logs fuzefront-backend-prod --tail 30
```

### Check Frontend Logs:

```cmd
docker logs fuzefront-frontend-prod --tail 20
```

### Test Backend Direct Access:

```cmd
curl http://localhost:3004/health
```

### Test Frontend Direct Access:

```cmd
curl http://localhost:8085/health
```

## 📁 Test Files Location

- **Test Configuration**: `frontend/playwright.config.ts`
- **Basic Auth Tests**: `frontend/tests/auth.spec.ts`
- **Advanced Flow Tests**: `frontend/tests/auth-flow.spec.ts`
- **Page Objects**: `frontend/tests/pages/login-page.ts`
- **Test Environment**: `frontend/tests/test.env`

## 🎯 Next Steps After Running Tests

1. **Share the test results** - Screenshots, videos, and console output
2. **Check the HTML report** - Opens automatically after tests
3. **Review any failures** - Detailed error messages and stack traces
4. **Fix identified issues** - Based on specific test failures

## 📝 Test Report Location

After running tests, find the report at:

- **HTML Report**: `frontend/playwright-report/index.html`
- **Screenshots**: `frontend/test-results/`
- **Videos**: `frontend/test-results/` (on failures)

**Please run the tests manually and share the results!**
