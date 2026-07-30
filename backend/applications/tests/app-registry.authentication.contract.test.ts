import express from 'express'
import request from 'supertest'
import appRegistryRouter from '../src/routes/app-registry'

function buildApp() {
  const app = express()
  app.use('/api/v1/app-registry', appRegistryRouter)
  return app
}

function expectUnauthenticated(response: request.Response) {
  expect(response.status).toBe(401)
  expect(response.type).toMatch(/json/)
  expect(Object.keys(response.body)).toEqual(['error'])
  expect(typeof response.body.error).toBe('string')
  expect(response.body.error).not.toHaveLength(0)
}

describe('app registry authentication contract', () => {
  it('rejects an unauthenticated GET /api/v1/app-registry/apps request', async () => {
    const response = await request(buildApp()).get('/api/v1/app-registry/apps')
    expectUnauthenticated(response)
  })

  it('rejects an unauthenticated POST /api/v1/app-registry/apps request', async () => {
    const response = await request(buildApp()).post('/api/v1/app-registry/apps')
    expectUnauthenticated(response)
  })

  it('rejects an unauthenticated GET /api/v1/app-registry/apps/:slug request', async () => {
    const response = await request(buildApp()).get('/api/v1/app-registry/apps/clock')
    expectUnauthenticated(response)
  })
})
