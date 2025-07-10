#!/usr/bin/env node

/**
 * Network Debug Script for FuzeFront
 * Tests connectivity to backend services
 */

const http = require('http')
const https = require('https')

const BACKEND_URLS = [
  'http://localhost:3004',
  'http://localhost:3001',
  'http://127.0.0.1:3004',
  'http://127.0.0.1:3001',
]

const FRONTEND_URLS = [
  'http://localhost:8085',
  'http://localhost:8080',
  'http://127.0.0.1:8085',
  'http://127.0.0.1:8080',
]

function testUrl(url, timeout = 5000) {
  return new Promise(resolve => {
    const urlObj = new URL(url)
    const client = urlObj.protocol === 'https:' ? https : http

    const startTime = Date.now()

    const req = client.get(url + '/health', { timeout }, res => {
      const responseTime = Date.now() - startTime
      let data = ''

      res.on('data', chunk => (data += chunk))
      res.on('end', () => {
        resolve({
          url,
          success: true,
          status: res.statusCode,
          responseTime,
          headers: res.headers,
          data: data.substring(0, 200), // First 200 chars
        })
      })
    })

    req.on('error', error => {
      const responseTime = Date.now() - startTime
      resolve({
        url,
        success: false,
        error: error.message,
        code: error.code,
        responseTime,
      })
    })

    req.on('timeout', () => {
      req.destroy()
      const responseTime = Date.now() - startTime
      resolve({
        url,
        success: false,
        error: 'Request timeout',
        responseTime,
      })
    })
  })
}

async function testConnectivity() {
  console.log('🔍 FuzeFront Network Connectivity Test')
  console.log('=====================================')
  console.log()

  console.log('🖥️  Testing Backend URLs:')
  for (const url of BACKEND_URLS) {
    const result = await testUrl(url)
    if (result.success) {
      console.log(`✅ ${url} - ${result.status} (${result.responseTime}ms)`)
      if (result.data) {
        try {
          const parsed = JSON.parse(result.data)
          console.log(
            `   Status: ${parsed.status}, Environment: ${parsed.environment}`
          )
        } catch (e) {
          console.log(`   Response: ${result.data.substring(0, 50)}...`)
        }
      }
    } else {
      console.log(`❌ ${url} - ${result.error} (${result.responseTime}ms)`)
    }
  }

  console.log()
  console.log('🌐 Testing Frontend URLs:')
  for (const url of FRONTEND_URLS) {
    const result = await testUrl(url, 3000) // Shorter timeout for frontend
    if (result.success) {
      console.log(`✅ ${url} - ${result.status} (${result.responseTime}ms)`)
    } else {
      console.log(`❌ ${url} - ${result.error} (${result.responseTime}ms)`)
    }
  }

  console.log()
  console.log('🔗 Testing API Endpoints:')

  // Test login endpoint specifically
  for (const baseUrl of BACKEND_URLS) {
    try {
      const result = await testApiEndpoint(baseUrl + '/api/auth/login')
      if (result.success) {
        console.log(
          `✅ ${baseUrl}/api/auth/login - ${result.status} (${result.responseTime}ms)`
        )
      } else {
        console.log(
          `❌ ${baseUrl}/api/auth/login - ${result.error} (${result.responseTime}ms)`
        )
      }
    } catch (error) {
      console.log(`❌ ${baseUrl}/api/auth/login - ${error.message}`)
    }
  }
}

function testApiEndpoint(url) {
  return new Promise(resolve => {
    const urlObj = new URL(url)
    const client = urlObj.protocol === 'https:' ? https : http

    const postData = JSON.stringify({
      email: 'admin@frontfuse.dev',
      password: 'admin123',
    })

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 5000,
    }

    const startTime = Date.now()

    const req = client.request(options, res => {
      const responseTime = Date.now() - startTime
      let data = ''

      res.on('data', chunk => (data += chunk))
      res.on('end', () => {
        resolve({
          success: true,
          status: res.statusCode,
          responseTime,
          headers: res.headers,
          data: data.substring(0, 200),
        })
      })
    })

    req.on('error', error => {
      const responseTime = Date.now() - startTime
      resolve({
        success: false,
        error: error.message,
        code: error.code,
        responseTime,
      })
    })

    req.on('timeout', () => {
      req.destroy()
      const responseTime = Date.now() - startTime
      resolve({
        success: false,
        error: 'Request timeout',
        responseTime,
      })
    })

    req.write(postData)
    req.end()
  })
}

// Run the test
testConnectivity().catch(console.error)
