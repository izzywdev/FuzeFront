// Load environment variables
require('dotenv').config()

const {
  checkPermitConnection,
} = require('../dist/utils/permit/sync-existing-data')
const { checkPermission } = require('../dist/utils/permit/permission-check')

async function testPermissions() {
  console.log('🧪 Testing Permissions System')
  console.log('='.repeat(50))

  try {
    // Test 1: Check Permit.io connection
    console.log('\n1. Testing Permit.io Connection...')
    const connectionResult = await checkPermitConnection()
    console.log('✅ Connection test:', connectionResult ? 'PASSED' : 'FAILED')

    // Test 2: Test permission check function
    console.log('\n2. Testing Permission Check Function...')
    try {
      const testPermission = await checkPermission({
        user: 'test-user-id',
        action: 'read',
        resource: {
          type: 'Organization',
          tenant: 'test-tenant',
          key: 'test-org-id',
        },
      })
      console.log('✅ Permission check function:', 'WORKING')
      console.log('   Result:', testPermission)
    } catch (error) {
      console.log('⚠️  Permission check function:', 'ERROR')
      console.log('   Error:', error.message)
    }

    // Test 3: Test middleware imports
    console.log('\n3. Testing Middleware Imports...')
    try {
      const { PermissionMiddleware } = require('../dist/middleware/permissions')
      console.log('✅ Middleware import:', 'SUCCESS')
      console.log(
        '   Available methods:',
        Object.keys(PermissionMiddleware).length
      )
    } catch (error) {
      console.log('❌ Middleware import:', 'FAILED')
      console.log('   Error:', error.message)
    }

    console.log('\n' + '='.repeat(50))
    console.log('🎉 Permission system test completed!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run tests
testPermissions().catch(console.error)
