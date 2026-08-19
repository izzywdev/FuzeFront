@echo off
echo Cleaning up FrontFuse ports...

echo Checking port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    echo Killing process %%a using port 3001
    taskkill /F /PID %%a
)

echo Checking port 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    echo Killing process %%a using port 5173
    taskkill /F /PID %%a
)

echo Checking port 3002...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3002 ^| findstr LISTENING') do (
    echo Killing process %%a using port 3002
    taskkill /F /PID %%a
)

echo Cleanup complete!
pause 