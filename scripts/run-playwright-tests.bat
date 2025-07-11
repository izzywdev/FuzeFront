@echo off
echo Running FuzeFront Playwright Authentication Tests
echo =================================================

echo.
echo Step 1: Installing frontend dependencies...
cd frontend
call npm install

echo.
echo Step 2: Installing Playwright browsers...
call npx playwright install

echo.
echo Step 3: Running authentication tests...
call npm run test:e2e

echo.
echo Step 4: Showing test report...
call npm run test:e2e:report

echo.
echo Tests completed!
pause 