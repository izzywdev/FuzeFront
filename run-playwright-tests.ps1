# FuzeFront Playwright Authentication Tests
Write-Host "🎭 Running FuzeFront Playwright Authentication Tests" -ForegroundColor Blue
Write-Host "=" * 60

# Change to frontend directory
Write-Host "`n📁 Changing to frontend directory..." -ForegroundColor Yellow
Set-Location frontend

# Install dependencies
Write-Host "`n📦 Installing frontend dependencies..." -ForegroundColor Yellow
npm install

# Install Playwright browsers
Write-Host "`n🌐 Installing Playwright browsers..." -ForegroundColor Yellow
npx playwright install

# Run the tests
Write-Host "`n🧪 Running authentication tests..." -ForegroundColor Yellow
npm run test:e2e

# Show results
Write-Host "`n📊 Test Results:" -ForegroundColor Green
Write-Host "Check the HTML report that should open automatically" -ForegroundColor Gray
Write-Host "Or run: npm run test:e2e:report" -ForegroundColor Gray

Write-Host "`n✅ Tests completed!" -ForegroundColor Green 