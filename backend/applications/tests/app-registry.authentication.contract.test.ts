import express from 'express'
import request from 'supertest'
import appRegistryRouter from '../src/routes/app-registry'

describe('POST /api/v1/app-registry/apps authentication contract', () => {
  it('rejects a request with no authentication', async () => {
    const app = express()
    app.use('/api/v1/app-registry', appRegistryRouter)

    const response = await request(app).post('/api/v1/app-registry/apps')

    expect(response.status).toBe(401)
    expect(response.type).toMatch(/json/)
    expect(Object.keys(response.body)).toEqual(['error'])
    expect(typeof response.body.error).toBe('string')
    expect(response.body.error).not.toHaveLength(0)
  })
})
