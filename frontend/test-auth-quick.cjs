// Quick authentication test
const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Starting authentication test...');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    // Navigate to the app
    console.log('📱 Navigating to app...');
    await page.goto('http://fuzefront.dev.local:8008');
    await page.waitForLoadState('networkidle');
    
    // Check if login form is visible
    console.log('🔍 Checking for login form...');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    console.log('✅ Login form found');
    
    // Fill credentials
    console.log('📝 Filling credentials...');
    await page.fill('input[type="email"]', 'admin@fuzefront.dev');
    await page.fill('input[type="password"]', 'admin123');
    
    // Submit form and wait for response
    console.log('🔐 Submitting login...');
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/auth/login'),
      { timeout: 15000 }
    );
    
    await page.click('button[type="submit"]');
    
    const response = await responsePromise;
    console.log(`📡 Login response: ${response.status()}`);
    
    if (response.status() === 200) {
      console.log('✅ Login API successful');
      
      // Wait for UI updates
      await page.waitForTimeout(3000);
      
      // Check for auth token
      const hasToken = await page.evaluate(() => {
        return !!localStorage.getItem('authToken');
      });
      
      console.log(`🔑 Auth token present: ${hasToken}`);
      
      // Check for authenticated UI
      const hasAppLayout = await page.locator('.app-layout').isVisible().catch(() => false);
      const hasTopBar = await page.locator('.top-bar').isVisible().catch(() => false);
      const hasMainContent = await page.locator('.main-content').isVisible().catch(() => false);
      
      console.log(`🎨 UI Elements - Layout: ${hasAppLayout}, TopBar: ${hasTopBar}, MainContent: ${hasMainContent}`);
      
      // Take screenshot
      await page.screenshot({ path: 'auth-test-success.png', fullPage: true });
      console.log('📸 Screenshot saved as auth-test-success.png');
      
      if (hasToken && (hasAppLayout || hasTopBar || hasMainContent)) {
        console.log('🎉 AUTHENTICATION TEST PASSED!');
      } else {
        console.log('⚠️ Authentication partially successful but UI not fully updated');
      }
    } else {
      console.log('❌ Login failed');
    }
    
  } catch (error) {
    console.error('💥 Test failed:', error.message);
    await page.screenshot({ path: 'auth-test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})(); 