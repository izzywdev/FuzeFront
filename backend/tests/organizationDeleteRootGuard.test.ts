import request from 'supertest'
import express from 'express'
import organizationsRoutes from '../src/routes/organizations'
import authRoutes from '../src/routes/auth'
import { initializeDatabaseConnection, db } from '../src/config/database'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

// The platform root organization is the anchor for every portal-scope check and
// every user's baseline membership. DELETE /api/organizations/:id must refuse to
// delete it (ROOT_ORG_PROTECTED), regardless of who asks — the guard runs before
// the owner check. See routes/organizations.ts. Mirrors the apps.test.ts harness:
// real auth + organizations routers against the migrated/seeded test Postgres.
function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use('/api/organizations', organizationsRoutes)
  return app
}

describe('DELETE /api/organizations/:id — root org guard', () => {
  let app: express.Application
  let authToken: string

  beforeAll(async () => {
    initializeDatabaseConnection()
    app = buildApp()

    const loginResponse = await request(app).post('/api/auth/login').send({
      email: 'admin@fuzefront.dev',
      password: 'admin123',
    })
    expect(loginResponse.status).toBe(200)
    authToken = loginResponse.body.token
  })

  it('refuses to delete the platform root organization with 403 ROOT_ORG_PROTECTED', async () => {
    const response = await request(app)
      .delete(`/api/organizations/${ROOT_ORG_ID}`)
      .set('Authorization', `Bearer ${authToken}`)

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ROOT_ORG_PROTECTED')

    // And the row is still active — nothing was soft-deleted.
    const root = await db('organizations').where('id', ROOT_ORG_ID).first()
    expect(root?.is_active).toBe(true)
  })
})
