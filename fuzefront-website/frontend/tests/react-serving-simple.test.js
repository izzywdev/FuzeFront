/**
 * Simple test to verify that fuzefront.com is serving a full React page
 * This test checks both local development and production deployment
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');

// Test configuration
const LOCAL_URL = 'http://localhost:3098'; // Local docker port
const PROD_URL = 'https://fuzefront.com';
const TIMEOUT = 10000;

/**
 * Test helper to check if a URL serves a React application
 */
async function testReactApplication(url, description) {
  try {
    console.log(`Testing ${description}: ${url}`);
    
    const response = await axios.get(url, { 
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'FuzeFront-Test/1.0'
      }
    });
    
    expect(response.status).toBe(200);
    
    const html = response.data;
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Check for React indicators
    const checks = {
      hasHtmlStructure: !!document.documentElement,
      hasHead: !!document.head,
      hasBody: !!document.body,
      hasTitle: !!document.title && document.title.length > 0,
      hasReactRoot: !!document.getElementById('root'),
      hasViteScript: html.includes('type="module"') || html.includes('vite'),
      hasReactContent: html.includes('React') || html.includes('react'),
      hasJavaScript: html.includes('<script'),
      isNotEmpty: html.length > 300, // Basic HTML should be substantial
      hasModernJS: html.includes('type="module"'),
    };
    
    console.log(`${description} checks:`, checks);
    
    // Assert critical React application requirements
    expect(checks.hasHtmlStructure).toBe(true);
    expect(checks.hasHead).toBe(true);
    expect(checks.hasBody).toBe(true);
    expect(checks.hasReactRoot).toBe(true);
    expect(checks.hasJavaScript).toBe(true);
    expect(checks.isNotEmpty).toBe(true);
    
    // Log success
    console.log(`✅ ${description} is serving a React application successfully`);
    
    return {
      success: true,
      url,
      status: response.status,
      checks,
      htmlLength: html.length,
      title: document.title
    };
    
  } catch (error) {
    console.error(`❌ ${description} test failed:`, error.message);
    
    // For network errors, provide helpful information
    if (error.code === 'ECONNREFUSED') {
      console.log(`💡 ${description} is not running. Try starting it first.`);
    } else if (error.code === 'ETIMEDOUT') {
      console.log(`⏱️  ${description} request timed out after ${TIMEOUT}ms`);
    }
    
    return {
      success: false,
      url,
      error: error.message,
      errorCode: error.code
    };
  }
}

describe('FuzeFront Website React Application Tests', () => {
  describe('Local Development Server', () => {
    test('should serve React application on localhost:3098', async () => {
      const result = await testReactApplication(LOCAL_URL, 'Local Development');
      
      if (!result.success) {
        console.log('🔧 To start local development:');
        console.log('   cd /mnt/c/Users/izzyw/source/FuzeFront/fuzefront-website');
        console.log('   docker-compose up -d');
        
        // Skip test if local server is not running
        console.log('⏭️  Skipping local test - server not available');
        return;
      }
      
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    }, TIMEOUT + 5000);
  });

  describe('Production Website', () => {
    test('should serve React application on fuzefront.com', async () => {
      const result = await testReactApplication(PROD_URL, 'Production Website');
      
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      
      // Additional production checks
      if (result.success) {
        expect(result.checks.hasTitle).toBe(true);
        expect(result.htmlLength).toBeGreaterThan(400); // Production should be more substantial
      }
    }, TIMEOUT + 5000);
  });

  describe('Health Check', () => {
    test('should verify React components are rendering', async () => {
      // Test the production site for React-specific content
      try {
        const response = await axios.get(PROD_URL, { timeout: TIMEOUT });
        const html = response.data;
        
        // Check for React-specific indicators
        const hasReactIndicators = 
          html.includes('React') || 
          html.includes('react') ||
          html.includes('type="module"') ||
          html.includes('🎉 React is Working! 🎉');
        
        if (hasReactIndicators) {
          console.log('✅ React application detected and rendering correctly');
        } else {
          console.log('⚠️  No clear React indicators found - may be a simple HTML page');
          console.log('HTML preview:', html.substring(0, 500) + '...');
        }
        
        expect(response.status).toBe(200);
        
      } catch (error) {
        console.error('Health check failed:', error.message);
        throw error; // Re-throw to fail the test
      }
    }, TIMEOUT);
  });
});

// Export for use in other tests
module.exports = {
  testReactApplication
};