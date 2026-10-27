/** Failed change-password attempts are rate-limited (like login brute-force protection). */
import express from 'express'
import request from 'supertest'
import securityRouter from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import { CurrentPasswordInvalidError } from '../src/providers/authentik/AuthentikIdentityProvider'

it('returns 429 RATE_LIMITED after 10 failed attempts', async () => {
  setIdentityProvider({ changePassword: jest.fn().mockRejectedValue(new CurrentPasswordInvalidError()) } as any)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  const hit = () =>
    request(app).post('/api/v1/security/password/change').set('Authorization', 'Bearer t')
      .send({ currentPassword: 'x', newPassword: 'y' })
  for (let i = 0; i < 10; i++) expect((await hit()).status).toBe(400)
  const res = await hit()
  expect(res.status).toBe(429)
  expect(res.body.code).toBe('RATE_LIMITED')
  setIdentityProvider(null)
})
