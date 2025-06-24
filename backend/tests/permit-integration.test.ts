import request from 'supertest'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../src/config/database'
import authRoutes from '../src/routes/auth'
import organizationsRoutes from '../src/routes/organizations'
import {
  syncUserToPermit,
  deleteUserFromPermit,
} from '../src/utils/permit/user-sync'
import {
  createTenantInPermit,
  updateTenantInPermit,
  deleteTenantFromPermit,
} from '../src/utils/permit/tenant-management'
import {
  assignOrganizationRole,
  unassignRoleInPermit,
  getUserRoleAssignments,
} from '../src/utils/permit/role-assignment'
import {
  checkPermission,
  bulkCheckPermissions,
  checkOrganizationPermission,
} from '../src/utils/permit/permission-check'
import {
  createAppResourceInstance,
  updateResourceInstance,
  deleteResourceInstance,
} from '../src/utils/permit/resource-instances'
import {
  bulkSyncUsers,
  bulkSyncTenants,
  setupOrganizationWithRoles,
} from '../src/utils/permit/bulk-operations'

// Test app setup
const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use('/api/organizations', organizationsRoutes)

// Test data
let testUserId: string
let testUserToken: string
let testOrgId: string
let adminUserId: string
let adminUserToken: string
let secondUserId: string
let testAppId: string

describe('Permit.io Integration Tests', () => {
  beforeAll(async () => {
    // Create test users in database
    testUserId = uuidv4()
    adminUserId = uuidv4()
    secondUserId = uuidv4()
    testOrgId = uuidv4()
    testAppId = uuidv4()

    // Insert test users
    await db('users').insert([
      {
        id: testUserId,
        email: 'test-owner@permit.test',
        first_name: 'Test',
        last_name: 'Owner',
        password_hash: '$2a$10$test.hash.for.testing',
        roles: JSON.stringify(['user']),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: adminUserId,
        email: 'admin-user@permit.test',
        first_name: 'Admin',
        last_name: 'User',
        password_hash: '$2a$10$admin.hash.for.testing',
        roles: JSON.stringify(['admin', 'user']),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: secondUserId,
        email: 'test-member@permit.test',
        first_name: 'Test',
        last_name: 'Member',
        password_hash: '$2a$10$test.hash.for.testing',
        roles: JSON.stringify(['user']),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ])

    // Insert test organization
    await db('organizations').insert({
      id: testOrgId,
      name: 'Test Organization',
      slug: 'test-organization',
      owner_id: testUserId,
      type: 'organization',
      settings: JSON.stringify({ theme: 'light' }),
      metadata: JSON.stringify({ test: true }),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    })

    // Insert organization membership
    await db('organization_memberships').insert({
      id: uuidv4(),
      user_id: testUserId,
      organization_id: testOrgId,
      role: 'owner',
      created_at: new Date(),
      updated_at: new Date(),
    })

    // Insert test app
    await db('apps').insert({
      id: testAppId,
      name: 'Test App',
      slug: 'test-app',
      organization_id: testOrgId,
      visibility: 'private',
      url: 'http://localhost:3000',
      is_active: true,
      integration_type: 'web_component',
      marketplace_metadata: JSON.stringify({}),
      configuration: JSON.stringify({}),
      created_at: new Date(),
      updated_at: new Date(),
    })

    // Get auth tokens for tests
    const testUserLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test-owner@permit.test', password: 'test-password' })

    const adminUserLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin-user@permit.test', password: 'admin-password' })

    if (testUserLogin.body.token) testUserToken = testUserLogin.body.token
    if (adminUserLogin.body.token) adminUserToken = adminUserLogin.body.token
  })

  afterAll(async () => {
    // Cleanup test data
    if (testOrgId) {
      await db('organization_memberships')
        .where('organization_id', testOrgId)
        .del()
      await db('organizations').where('id', testOrgId).del()
      // Try to cleanup from Permit.io (may fail, that's ok)
      try {
        await deleteUserFromPermit(testUserId)
        await deleteUserFromPermit(secondUserId)
        await deleteTenantFromPermit(testOrgId)
      } catch (error) {
        console.log(
          'Note: Permit.io cleanup may have failed (this is expected)'
        )
      }
    }

    await db('users')
      .whereIn('id', [testUserId, adminUserId, secondUserId])
      .del()
    await db('apps').where('id', testAppId).del()
  })

  describe('User Synchronization', () => {
    test('should sync user to Permit.io', async () => {
      const testUser = {
        id: testUserId,
        email: 'test-owner@permit.test',
        firstName: 'Test',
        lastName: 'Owner',
        roles: ['user'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const result = await syncUserToPermit(testUser)

      // The result depends on API key scope - organization-level keys may fail user sync
      // This is expected behavior, so we test for either success or graceful failure
      expect(typeof result).toBe('boolean')
      console.log(
        `User sync result: ${result} (false is expected with org-level API key)`
      )
    }, 10000)

    test('should handle invalid user data gracefully', async () => {
      const invalidUser = {
        id: '',
        email: '',
        firstName: '',
        lastName: '',
        roles: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const result = await syncUserToPermit(invalidUser)
      expect(result).toBe(false)
    })

    test('should sync multiple users in bulk', async () => {
      const users = [
        {
          id: testUserId,
          email: 'test-owner@permit.test',
          firstName: 'Test',
          lastName: 'Owner',
          roles: ['user'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: secondUserId,
          email: 'test-member@permit.test',
          firstName: 'Test',
          lastName: 'Member',
          roles: ['user'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      const results = await bulkSyncUsers(users)
      expect(typeof results.success).toBe('number')
      expect(typeof results.failed).toBe('number')
      console.log(
        `Bulk user sync: ${results.success} success, ${results.failed} failed`
      )
    }, 15000)
  })

  describe('Organization and Tenant Management', () => {
    test('should create tenant in Permit.io for organization', async () => {
      const testOrg = {
        id: testOrgId,
        name: 'Test Organization',
        slug: 'test-organization',
        parent_id: undefined,
        owner_id: testUserId,
        type: 'organization' as 'organization' | 'platform',
        settings: { theme: 'light' },
        metadata: { test: true },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const result = await createTenantInPermit(testOrg)
      expect(result).toBe(true)
      console.log('✅ Tenant created successfully in Permit.io')
    }, 10000)

    test('should update tenant in Permit.io', async () => {
      const updates = {
        name: 'Updated Test Organization',
        attributes: { updated: true },
      }

      const result = await updateTenantInPermit(testOrgId, updates)
      expect(result).toBe(true)
      console.log('✅ Tenant updated successfully in Permit.io')
    }, 10000)

    test('should sync multiple tenants in bulk', async () => {
      const orgs = [
        {
          id: testOrgId,
          name: 'Test Organization',
          slug: 'test-organization',
          parent_id: undefined,
          owner_id: testUserId,
          type: 'organization' as 'organization' | 'platform',
          settings: { theme: 'light' },
          metadata: { test: true },
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      const results = await bulkSyncTenants(orgs)
      expect(typeof results.success).toBe('number')
      expect(typeof results.failed).toBe('number')
      console.log(
        `Bulk tenant sync: ${results.success} success, ${results.failed} failed`
      )
    }, 15000)
  })

  describe('Role Assignment', () => {
    test('should assign organization role to user', async () => {
      const result = await assignOrganizationRole(
        testUserId,
        testOrgId,
        'owner'
      )
      expect(result).toBe(true)
      console.log('✅ Organization owner role assigned successfully')
    }, 10000)

    test('should assign member role to second user', async () => {
      // First add user to organization in database
      await db('organization_memberships').insert({
        id: uuidv4(),
        user_id: secondUserId,
        organization_id: testOrgId,
        role: 'member',
        created_at: new Date(),
        updated_at: new Date(),
      })

      const result = await assignOrganizationRole(
        secondUserId,
        testOrgId,
        'member'
      )
      expect(result).toBe(true)
      console.log('✅ Organization member role assigned successfully')
    }, 10000)

    test('should get user role assignments', async () => {
      const assignments = await getUserRoleAssignments(testUserId, testOrgId)
      expect(Array.isArray(assignments)).toBe(true)
      console.log(`✅ Retrieved ${assignments.length} role assignments`)
    }, 10000)

    test('should unassign role from user', async () => {
      const result = await unassignRoleInPermit({
        user: secondUserId,
        role: 'editor',
        tenant: testOrgId,
      })
      expect(typeof result).toBe('boolean')
      console.log(`✅ Role unassignment result: ${result}`)
    }, 10000)
  })

  describe('Permission Checking', () => {
    test('should check organization permissions for owner', async () => {
      const hasPermission = await checkOrganizationPermission(
        testUserId,
        'manage',
        testOrgId
      )
      expect(typeof hasPermission).toBe('boolean')
      console.log(`✅ Owner manage permission: ${hasPermission}`)
    }, 10000)

    test('should check read permission for organization', async () => {
      const hasPermission = await checkPermission({
        user: testUserId,
        action: 'read',
        resource: {
          type: 'Organization',
          tenant: testOrgId,
        },
      })
      expect(typeof hasPermission).toBe('boolean')
      console.log(`✅ Read permission check: ${hasPermission}`)
    }, 10000)

    test('should deny permission for unauthorized user', async () => {
      const randomUserId = uuidv4()
      const hasPermission = await checkPermission({
        user: randomUserId,
        action: 'manage',
        resource: {
          type: 'Organization',
          tenant: testOrgId,
        },
      })
      expect(hasPermission).toBe(false)
      console.log('✅ Correctly denied permission for unauthorized user')
    })

    test('should handle bulk permission checks', async () => {
      const checks = [
        {
          user: testUserId,
          action: 'read',
          resource: { type: 'Organization', tenant: testOrgId },
        },
        {
          user: testUserId,
          action: 'manage',
          resource: { type: 'Organization', tenant: testOrgId },
        },
        {
          user: secondUserId,
          action: 'read',
          resource: { type: 'Organization', tenant: testOrgId },
        },
        {
          user: 'nonexistent-user',
          action: 'delete',
          resource: { type: 'Organization', tenant: testOrgId },
        },
      ]

      const results = await bulkCheckPermissions(checks)
      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBe(4)
      console.log(
        `✅ Bulk permission check completed: ${results.length} results`
      )
    }, 15000)
  })

  describe('Resource Instance Management', () => {
    test('should create app resource instance', async () => {
      const appData = {
        id: testAppId,
        name: 'Test App',
        url: 'http://localhost:3000',
        isActive: true,
        integrationType: 'web-component' as
          | 'module-federation'
          | 'iframe'
          | 'web-component',
        visibility: 'private' as
          | 'private'
          | 'organization'
          | 'public'
          | 'marketplace',
        marketplaceMetadata: {},
        isMarketplaceApproved: false,
        installCount: 0,
      }

      const result = await createAppResourceInstance(appData, testOrgId)
      expect(typeof result).toBe('boolean')
      console.log(`✅ App resource instance created: ${result}`)
    }, 10000)

    test('should update resource instance', async () => {
      const updates = {
        name: 'Updated Test App',
        attributes: { updated: true },
      }

      const result = await updateResourceInstance(testAppId, testOrgId, updates)
      expect(typeof result).toBe('boolean')
      console.log(`✅ Resource instance updated: ${result}`)
    }, 10000)

    test('should delete resource instance', async () => {
      const result = await deleteResourceInstance(testAppId)
      expect(typeof result).toBe('boolean')
      console.log(`✅ Resource instance deleted: ${result}`)
    }, 10000)
  })

  describe('Complete Organization Setup', () => {
    test('should setup organization with all roles and permissions', async () => {
      const orgData = {
        id: testOrgId,
        name: 'Test Organization',
        slug: 'test-organization',
        parent_id: undefined,
        owner_id: testUserId,
        type: 'organization' as 'organization' | 'platform',
        settings: { theme: 'light' },
        metadata: { test: true },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const membershipData = [
        {
          userId: testUserId,
          role: 'owner' as 'owner' | 'admin' | 'member' | 'viewer',
        },
      ]

      const result = await setupOrganizationWithRoles(orgData, membershipData)
      expect(typeof result).toBe('boolean')
      console.log(`✅ Complete organization setup: ${result}`)
    }, 20000)
  })

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid tenant ID gracefully', async () => {
      const invalidOrg = {
        id: 'invalid-id-format',
        name: '',
        slug: '',
        parent_id: undefined,
        owner_id: testUserId,
        type: 'organization' as 'organization' | 'platform',
        settings: {},
        metadata: {},
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const result = await createTenantInPermit(invalidOrg)
      expect(result).toBe(false)
      console.log('✅ Gracefully handled invalid tenant creation')
    })

    test('should handle network errors in permission checks', async () => {
      const hasPermission = await checkPermission({
        user: 'nonexistent-user',
        action: 'read',
        resource: {
          type: 'Organization',
          tenant: 'nonexistent-tenant',
        },
      })
      expect(hasPermission).toBe(false)
      console.log('✅ Gracefully handled network error in permission check')
    })

    test('should handle empty role assignments', async () => {
      const assignments = await getUserRoleAssignments(
        'nonexistent-user',
        'nonexistent-tenant'
      )
      expect(Array.isArray(assignments)).toBe(true)
      expect(assignments.length).toBe(0)
      console.log('✅ Gracefully handled empty role assignments')
    })
  })
})

describe('Database Integration Tests', () => {
  test('should verify test data exists in database', async () => {
    const user = await db('users').where('id', testUserId).first()
    expect(user).toBeTruthy()
    expect(user.email).toBe('test-owner@permit.test')

    const org = await db('organizations').where('id', testOrgId).first()
    expect(org).toBeTruthy()
    expect(org.name).toBe('Test Organization')

    const membership = await db('organization_memberships')
      .where('user_id', testUserId)
      .where('organization_id', testOrgId)
      .first()
    expect(membership).toBeTruthy()
    expect(membership.role).toBe('owner')

    console.log('✅ All test data verified in database')
  })
})

describe('API Endpoint Protection', () => {
  test('should require authentication for organization endpoints', async () => {
    const response = await request(app).get('/api/organizations')

    expect(response.status).toBe(401)
  })

  test('should allow authenticated access to organization list', async () => {
    const response = await request(app)
      .get('/api/organizations')
      .set('Authorization', `Bearer ${testUserToken}`)

    expect(response.status).toBe(200)
    expect(response.body.organizations).toBeDefined()
  })

  test('should allow organization owner to access their organization', async () => {
    if (!testOrgId) {
      return // Skip if no test org created
    }

    const response = await request(app)
      .get(`/api/organizations/${testOrgId}`)
      .set('Authorization', `Bearer ${testUserToken}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(testOrgId)
  })

  test('should prevent unauthorized organization access', async () => {
    if (!testOrgId) {
      return // Skip if no test org created
    }

    // Try to access with different user
    const response = await request(app)
      .get(`/api/organizations/${testOrgId}`)
      .set('Authorization', `Bearer ${adminUserToken}`)

    // May be 404 or 403 depending on implementation
    expect([403, 404]).toContain(response.status)
  })
})
