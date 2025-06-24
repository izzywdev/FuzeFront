#!/usr/bin/env node

/**
 * Complete Permit.io Setup Script
 *
 * This script automatically sets up all resources, roles, permissions, and syncs data
 * using the correct project and environment context.
 *
 * Usage:
 *   node scripts/permit-complete-setup.js [options]
 *
 * Options:
 *   --setup-only    Only setup resources and roles, don't sync data
 *   --sync-only     Only sync data, assume setup is done
 *   --force         Force recreate resources even if they exist
 */

const path = require('path')
const axios = require('axios')

// Set up environment
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const PERMIT_API_BASE = 'https://api.permit.io'
const PERMIT_API_KEY = process.env.PERMIT_API_KEY

if (!PERMIT_API_KEY) {
  console.error('❌ PERMIT_API_KEY environment variable is required')
  process.exit(1)
}

// API client setup
const permitApi = axios.create({
  baseURL: PERMIT_API_BASE,
  headers: {
    Authorization: `Bearer ${PERMIT_API_KEY}`,
    'Content-Type': 'application/json',
  },
})

// Add request/response logging
permitApi.interceptors.request.use(request => {
  console.log(`🌐 API Request: ${request.method?.toUpperCase()} ${request.url}`)
  return request
})

permitApi.interceptors.response.use(
  response => {
    console.log(
      `✅ API Response: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`
    )
    return response
  },
  error => {
    console.log(
      `❌ API Error: ${error.response?.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`
    )
    if (error.response?.data) {
      console.log(`   Error details:`, error.response.data)
    }
    return Promise.reject(error)
  }
)

async function getProjectContext() {
  try {
    console.log('🔍 Getting project context...')
    const scope = await permitApi.get('/v2/api-key/scope')
    console.log('📋 API Key Scope:', {
      organization: scope.data.organization_id,
      project: scope.data.project_id,
      environment: scope.data.environment_id,
    })

    // Get the first project and environment if using org-level key
    let projectId = scope.data.project_id
    let environmentId = scope.data.environment_id

    if (!projectId) {
      console.log('🔍 Getting default project and environment...')
      const projectsResponse = await permitApi.get('/v2/projects')
      const projects = projectsResponse.data.data || projectsResponse.data
      if (projects.length > 0) {
        projectId = projects[0].id
        console.log(
          `📁 Using project: ${projects[0].name} (${projects[0].key})`
        )

        if (!environmentId) {
          const envsResponse = await permitApi.get(
            `/v2/projects/${projectId}/envs`
          )
          const environments = envsResponse.data.data || envsResponse.data
          if (environments.length > 0) {
            environmentId = environments[0].id
            console.log(
              `🌍 Using environment: ${environments[0].name} (${environments[0].key})`
            )
          }
        }
      } else {
        throw new Error('No projects found in organization')
      }
    }

    if (!projectId || !environmentId) {
      throw new Error('Could not determine project and environment context')
    }

    return {
      ...scope.data,
      project_id: projectId,
      environment_id: environmentId,
    }
  } catch (error) {
    console.error('❌ Failed to get project context:', error.message)
    throw error
  }
}

async function setupEnvironments(context, force = false) {
  console.log('\n🌍 Setting up Permit.io environments...')

  const environments = [
    {
      key: 'development',
      name: 'Development',
      description: 'Development environment for testing and development',
    },
    {
      key: 'production',
      name: 'Production',
      description: 'Production environment for live applications',
    },
  ]

  for (const env of environments) {
    try {
      console.log(`📝 Creating environment: ${env.name}`)

      const response = await permitApi.post(
        `/v2/projects/${context.project_id}/envs`,
        env
      )
      console.log(`✅ Environment created: ${env.name}`)
    } catch (error) {
      if (error.response?.status === 409) {
        console.log(`ℹ️  Environment already exists: ${env.name}`)
      } else {
        console.error(
          `❌ Failed to create environment ${env.name}:`,
          error.message
        )
      }
    }
  }
}

async function setupResources(context, force = false) {
  console.log('\n🔧 Setting up Permit.io resources...')

  const resources = [
    {
      key: 'Organization',
      name: 'Organization',
      description: 'Organization resource for tenant management',
      actions: {
        create: { name: 'Create', description: 'Create new organizations' },
        read: { name: 'Read', description: 'View organization details' },
        update: { name: 'Update', description: 'Modify organization settings' },
        delete: { name: 'Delete', description: 'Delete organizations' },
        manage: { name: 'Manage', description: 'Full organization management' },
      },
    },
    {
      key: 'App',
      name: 'App',
      description: 'Application resource for federated frontend management',
      actions: {
        create: { name: 'Create', description: 'Create new applications' },
        read: { name: 'Read', description: 'View application details' },
        update: { name: 'Update', description: 'Modify application settings' },
        delete: { name: 'Delete', description: 'Delete applications' },
        install: { name: 'Install', description: 'Install applications' },
        uninstall: { name: 'Uninstall', description: 'Uninstall applications' },
      },
    },
    {
      key: 'UserManagement',
      name: 'User Management',
      description: 'User management resource for organization administration',
      actions: {
        invite: { name: 'Invite', description: 'Invite users to organization' },
        remove: {
          name: 'Remove',
          description: 'Remove users from organization',
        },
        update_role: { name: 'Update Role', description: 'Change user roles' },
        view_members: {
          name: 'View Members',
          description: 'View organization members',
        },
      },
    },
  ]

  for (const resource of resources) {
    try {
      console.log(`📝 Creating resource: ${resource.name}`)

      // Create the resource with its actions
      const resourcePayload = {
        key: resource.key,
        name: resource.name,
        description: resource.description,
        actions: resource.actions,
      }

      const response = await permitApi.post(
        `/v2/projects/${context.project_id}/envs/${context.environment_id}/resources`,
        resourcePayload
      )
      console.log(`✅ Resource created: ${resource.name}`)
    } catch (error) {
      if (error.response?.status === 409) {
        console.log(`ℹ️  Resource already exists: ${resource.name}`)
      } else {
        console.error(
          `❌ Failed to create resource ${resource.name}:`,
          error.message
        )
      }
    }
  }
}

async function setupRoles(context, force = false) {
  console.log('\n👥 Setting up Permit.io roles...')

  const roles = [
    {
      key: 'organization_owner',
      name: 'Organization Owner',
      description: 'Full control over organization and all resources',
      permissions: [
        'Organization:manage',
        'Organization:create',
        'Organization:read',
        'Organization:update',
        'Organization:delete',
        'App:create',
        'App:read',
        'App:update',
        'App:delete',
        'App:install',
        'App:uninstall',
        'UserManagement:invite',
        'UserManagement:remove',
        'UserManagement:update_role',
        'UserManagement:view_members',
      ],
    },
    {
      key: 'organization_admin',
      name: 'Organization Admin',
      description: 'Administrative access to organization resources',
      permissions: [
        'Organization:read',
        'Organization:update',
        'App:create',
        'App:read',
        'App:update',
        'App:delete',
        'App:install',
        'App:uninstall',
        'UserManagement:invite',
        'UserManagement:remove',
        'UserManagement:update_role',
        'UserManagement:view_members',
      ],
    },
    {
      key: 'organization_member',
      name: 'Organization Member',
      description: 'Standard member access to organization resources',
      permissions: [
        'Organization:read',
        'App:read',
        'App:install',
        'App:uninstall',
        'UserManagement:view_members',
      ],
    },
    {
      key: 'organization_viewer',
      name: 'Organization Viewer',
      description: 'Read-only access to organization resources',
      permissions: [
        'Organization:read',
        'App:read',
        'UserManagement:view_members',
      ],
    },
    {
      key: 'app_developer',
      name: 'App Developer',
      description: 'Can create and manage applications',
      permissions: [
        'Organization:read',
        'App:create',
        'App:read',
        'App:update',
        'App:delete',
        'UserManagement:view_members',
      ],
    },
  ]

  for (const role of roles) {
    try {
      console.log(
        `🎭 Creating role: ${role.name} with ${role.permissions.length} permissions`
      )
      await permitApi.post(
        `/v2/schema/${context.project_id}/${context.environment_id}/roles`,
        role
      )
      console.log(`✅ Role '${role.name}' created successfully`)
    } catch (error) {
      if (error.response?.status === 409) {
        if (force) {
          console.log(`🔄 Role '${role.name}' exists, updating...`)
          try {
            await permitApi.patch(
              `/v2/schema/${context.project_id}/${context.environment_id}/roles/${role.key}`,
              role
            )
            console.log(`✅ Role '${role.name}' updated successfully`)
          } catch (updateError) {
            console.log(
              `⚠️  Could not update role '${role.name}':`,
              updateError.response?.data?.message || updateError.message
            )
          }
        } else {
          console.log(`→ Role '${role.name}' already exists`)
        }
      } else {
        console.error(
          `❌ Failed to create role '${role.name}':`,
          error.response?.data?.message || error.message
        )
      }
    }
  }
}

async function syncExistingData() {
  console.log('\n🔄 Syncing existing data to Permit.io...')

  try {
    const { syncExistingDataToPermit } = await import(
      '../dist/utils/permit/sync-existing-data.js'
    )
    await syncExistingDataToPermit()
    console.log('✅ Data sync completed successfully')
  } catch (error) {
    console.error('❌ Data sync failed:', error)
    throw error
  }
}

async function validateSetup(context) {
  console.log('\n🔍 Validating Permit.io setup...')

  try {
    // Check resources
    const resourcesResponse = await permitApi.get(
      `/v2/schema/${context.project_id}/${context.environment_id}/resources`
    )
    const resources = resourcesResponse.data.data || resourcesResponse.data

    const requiredResources = ['Organization', 'App', 'UserManagement']
    const foundResources = []

    for (const required of requiredResources) {
      const found = resources.find(r => r.key === required)
      if (found) {
        foundResources.push(required)
        console.log(
          `✅ Resource found: ${required} (${Object.keys(found.actions || {}).length} actions)`
        )
      } else {
        console.error(`❌ Required resource missing: ${required}`)
        return false
      }
    }

    // Check roles
    const rolesResponse = await permitApi.get(
      `/v2/schema/${context.project_id}/${context.environment_id}/roles`
    )
    const roles = rolesResponse.data.data || rolesResponse.data

    const requiredRoles = [
      'organization_owner',
      'organization_admin',
      'organization_member',
      'organization_viewer',
    ]
    const foundRoles = []

    for (const required of requiredRoles) {
      const found = roles.find(r => r.key === required)
      if (found) {
        foundRoles.push(required)
        console.log(`✅ Role found: ${required}`)
      } else {
        console.error(`❌ Required role missing: ${required}`)
        return false
      }
    }

    console.log(`\n🎉 Setup validation successful!`)
    console.log(`📊 Summary:`)
    console.log(
      `   Resources: ${foundResources.length}/${requiredResources.length}`
    )
    console.log(`   Roles: ${foundRoles.length}/${requiredRoles.length}`)

    return true
  } catch (error) {
    console.error('❌ Setup validation failed:', error.message)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const setupOnly = args.includes('--setup-only')
  const syncOnly = args.includes('--sync-only')
  const force = args.includes('--force')

  console.log('🚀 FuzeFront Permit.io Complete Setup')
  console.log('=====================================\n')

  try {
    // Get project context
    const context = await getProjectContext()

    if (!syncOnly) {
      // Setup environments, resources and roles
      await setupEnvironments(context, force)
      await setupResources(context, force)
      await setupRoles(context, force)

      // Validate setup
      const isValid = await validateSetup(context)
      if (!isValid) {
        console.error(
          '❌ Setup validation failed. Please check the errors above.'
        )
        process.exit(1)
      }
    }

    if (!setupOnly) {
      // Sync existing data
      await syncExistingData()
    }

    console.log('\n🎉 Complete setup finished successfully!')
    console.log('\n📋 What was accomplished:')
    console.log('   ✅ Resources created (Organization, App, UserManagement)')
    console.log('   ✅ Roles defined (Owner, Admin, Member, Viewer, Developer)')
    console.log('   ✅ Permissions assigned to roles')
    if (!setupOnly) {
      console.log('   ✅ Existing data synced to Permit.io')
    }

    console.log('\n🔗 Next steps:')
    console.log('   1. Visit https://app.permit.io to review your setup')
    console.log('   2. Test permissions in your application')
    console.log('   3. Monitor the Permit.io PDP container logs')
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message)
    if (error.response?.data) {
      console.error('API Error Details:', error.response.data)
    }
    process.exit(1)
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
