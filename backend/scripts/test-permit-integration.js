#!/usr/bin/env node

/**
 * Test script for Permit.io integration
 *
 * Tests:
 * 1. User creation and sync to Permit.io
 * 2. Organization creation and tenant creation
 * 3. Role assignment
 */

const path = require('path')
const { v4: uuidv4 } = require('uuid')

// Set up environment
require('dotenv').config({ path: path.join(__dirname, '../.env') })

async function testUserCreation() {
  console.log('🧪 Testing user creation and Permit.io sync...')

  try {
    // Import the compiled modules
    const { syncUserToPermit } = await import(
      '../dist/utils/permit/user-sync.js'
    )

    const testUser = {
      id: uuidv4(),
      email: 'test-user@example.com',
      firstName: 'Test',
      lastName: 'User',
      roles: ['user'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    console.log(`📝 Creating test user: ${testUser.email}`)

    // Try to sync user to Permit.io
    const result = await syncUserToPermit(testUser)

    if (result) {
      console.log(`✅ User sync successful: ${testUser.id}`)
      return testUser
    } else {
      console.log(`❌ User sync failed: ${testUser.id}`)
      return null
    }
  } catch (error) {
    console.error('❌ User creation test failed:', error.message)
    return null
  }
}

async function testOrganizationCreation(testUser) {
  console.log('\n🧪 Testing organization creation and tenant sync...')

  try {
    // Import the compiled modules
    const { createTenantInPermit } = await import(
      '../dist/utils/permit/tenant-management.js'
    )
    const { assignOrganizationRole } = await import(
      '../dist/utils/permit/role-assignment.js'
    )

    const testOrg = {
      id: uuidv4(),
      name: 'Test Organization',
      slug: 'test-org-' + Date.now(),
      parent_id: undefined,
      owner_id: testUser.id,
      type: 'organization',
      settings: { theme: 'dark' },
      metadata: { test: true },
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    console.log(`📝 Creating test organization: ${testOrg.name}`)

    // Try to create tenant in Permit.io
    const tenantResult = await createTenantInPermit(testOrg)

    if (tenantResult) {
      console.log(`✅ Tenant creation successful: ${testOrg.id}`)

      // Try to assign owner role
      console.log(`🎭 Assigning owner role to user: ${testUser.id}`)
      const roleResult = await assignOrganizationRole(
        testUser.id,
        testOrg.id,
        'owner'
      )

      if (roleResult) {
        console.log(`✅ Role assignment successful`)
        return testOrg
      } else {
        console.log(`❌ Role assignment failed`)
        return testOrg // Still return org even if role assignment failed
      }
    } else {
      console.log(`❌ Tenant creation failed: ${testOrg.id}`)
      return null
    }
  } catch (error) {
    console.error('❌ Organization creation test failed:', error.message)
    return null
  }
}

async function testPermissionCheck(testUser, testOrg) {
  console.log('\n🧪 Testing permission checking...')

  try {
    // Import the compiled modules
    const { checkPermission } = await import(
      '../dist/utils/permit/permission-check.js'
    )

    console.log(`🔍 Checking if user can manage organization...`)

    // Check if user has organization management permission
    const hasPermission = await checkPermission(
      testUser.id,
      'manage',
      'Organization',
      testOrg.id
    )

    if (hasPermission) {
      console.log(
        `✅ Permission check successful: User can manage organization`
      )
    } else {
      console.log(`❌ Permission check failed: User cannot manage organization`)
    }

    return hasPermission
  } catch (error) {
    console.error('❌ Permission check test failed:', error.message)
    return false
  }
}

async function cleanup(testUser, testOrg) {
  console.log('\n🧹 Cleaning up test data...')

  try {
    // Import the compiled modules
    const { deleteUserFromPermit } = await import(
      '../dist/utils/permit/user-sync.js'
    )
    const { deleteTenantFromPermit } = await import(
      '../dist/utils/permit/tenant-management.js'
    )

    // Clean up test data from Permit.io
    if (testUser) {
      console.log(`🗑️  Deleting test user: ${testUser.id}`)
      await deleteUserFromPermit(testUser.id)
    }

    if (testOrg) {
      console.log(`🗑️  Deleting test tenant: ${testOrg.id}`)
      await deleteTenantFromPermit(testOrg.id)
    }

    console.log(`✅ Cleanup completed`)
  } catch (error) {
    console.error('⚠️  Cleanup failed (this is usually okay):', error.message)
  }
}

async function main() {
  console.log('🚀 FuzeFront Permit.io Integration Test')
  console.log('======================================\n')

  let testUser = null
  let testOrg = null

  try {
    // Test 1: User creation
    testUser = await testUserCreation()
    if (!testUser) {
      console.log('❌ User creation test failed, skipping organization tests')
      return
    }

    // Test 2: Organization creation
    testOrg = await testOrganizationCreation(testUser)
    if (!testOrg) {
      console.log(
        '❌ Organization creation test failed, skipping permission tests'
      )
      return
    }

    // Test 3: Permission checking
    await testPermissionCheck(testUser, testOrg)

    console.log('\n🎉 All tests completed!')
    console.log('\n📊 Summary:')
    console.log(`   User sync: ${testUser ? '✅' : '❌'}`)
    console.log(`   Organization tenant: ${testOrg ? '✅' : '❌'}`)
    console.log(`   Permission system: Ready for testing`)
  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message)
  } finally {
    // Always try to cleanup
    await cleanup(testUser, testOrg)
  }
}

// Handle errors gracefully
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled rejection:', error)
  process.exit(1)
})

process.on('uncaughtException', error => {
  console.error('❌ Uncaught exception:', error)
  process.exit(1)
})

main().catch(error => {
  console.error('❌ Main function failed:', error)
  process.exit(1)
})
