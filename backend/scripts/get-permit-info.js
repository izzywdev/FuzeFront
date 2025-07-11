#!/usr/bin/env node

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

async function main() {
  try {
    console.log('🔍 Getting Permit.io project and environment information...\n')

    // Make direct API call to get scope since the SDK method might not be available
    const axios = require('axios')
    const permitApi = axios.create({
      baseURL: 'https://api.permit.io',
      headers: {
        Authorization: `Bearer ${process.env.PERMIT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    // Get API key scope
    const scopeResponse = await permitApi.get('/v2/api-key/scope')
    const scope = scopeResponse.data
    console.log('📋 API Key Scope:')
    console.log(`   Organization ID: ${scope.organization_id}`)
    console.log(
      `   Project ID: ${scope.project_id || 'null (organization-level key)'}`
    )
    console.log(
      `   Environment ID: ${scope.environment_id || 'null (project/org-level key)'}`
    )

    // Get projects list
    console.log('\n📁 Projects:')
    const projectsResponse = await permitApi.get('/v2/projects')
    const projects = projectsResponse.data.data || projectsResponse.data

    for (const project of projects) {
      console.log(`   - ${project.name} (${project.key}) - ID: ${project.id}`)

      // Get environments for this project
      try {
        const envsResponse = await permitApi.get(
          `/v2/projects/${project.id}/envs`
        )
        const environments = envsResponse.data.data || envsResponse.data
        console.log(`     Environments:`)
        for (const env of environments) {
          console.log(`       - ${env.name} (${env.key}) - ID: ${env.id}`)
        }
      } catch (error) {
        console.log(`     Could not fetch environments: ${error.message}`)
      }
    }

    // Show current context and API endpoints
    if (scope.project_id && scope.environment_id) {
      console.log('\n🎯 Current Context (Environment-level API key):')
      const project = projects.find(p => p.id === scope.project_id)
      if (project) {
        const envsResponse = await permitApi.get(
          `/v2/projects/${project.id}/envs`
        )
        const environments = envsResponse.data.data || envsResponse.data
        const environment = environments.find(
          e => e.id === scope.environment_id
        )
        console.log(`   Project: ${project.name} (${project.key})`)
        console.log(`   Environment: ${environment.name} (${environment.key})`)

        // Show example API endpoints
        console.log('\n🔗 API Endpoints for current context:')
        console.log(
          `   Resources: /v2/schema/${project.id}/${environment.id}/resources`
        )
        console.log(
          `   Roles: /v2/schema/${project.id}/${environment.id}/roles`
        )
        console.log(`   Users: /v2/facts/${project.id}/${environment.id}/users`)
        console.log(
          `   Tenants: /v2/facts/${project.id}/${environment.id}/tenants`
        )
      }
    } else if (scope.project_id) {
      console.log('\n🎯 Current Context (Project-level API key):')
      const project = projects.find(p => p.id === scope.project_id)
      if (project) {
        console.log(`   Project: ${project.name} (${project.key})`)
        console.log(
          '   ⚠️  You need to specify an environment ID for schema operations.'
        )
      }
    } else {
      console.log('\n🎯 Current Context (Organization-level API key):')
      console.log(
        '   ⚠️  You need to specify project and environment IDs for schema operations.'
      )

      // Show first project/environment as example
      if (projects.length > 0) {
        const firstProject = projects[0]
        try {
          const envsResponse = await permitApi.get(
            `/v2/projects/${firstProject.id}/envs`
          )
          const environments = envsResponse.data.data || envsResponse.data
          if (environments.length > 0) {
            const firstEnv = environments[0]
            console.log(
              '\n💡 Example API endpoints (using first project/environment):'
            )
            console.log(
              `   Resources: /v2/schema/${firstProject.id}/${firstEnv.id}/resources`
            )
            console.log(
              `   Roles: /v2/schema/${firstProject.id}/${firstEnv.id}/roles`
            )
            console.log(
              `   Project: ${firstProject.name} (${firstProject.key})`
            )
            console.log(`   Environment: ${firstEnv.name} (${firstEnv.key})`)
          }
        } catch (error) {
          console.log(
            `   Could not fetch example environment: ${error.message}`
          )
        }
      }
    }

    console.log(
      '\n✅ Use this information to configure your setup script with the correct project/environment IDs.'
    )
  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.response?.data) {
      console.error('API Error Details:', error.response.data)
    }
    process.exit(1)
  }
}

main()
