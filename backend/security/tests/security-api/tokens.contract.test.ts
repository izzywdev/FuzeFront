/**
 * Contract tests: M2M token issuance + introspection. Fail-closed introspection
 * (unknown/expired → { active: false }) is the headline assertion.
 */
import { agent, RUNNING_AGAINST } from './harness'
import { assertSchema } from './spec'
import { SEED } from './mockIdentityProvider'

describe(`m2m tokens (against ${RUNNING_AGAINST})`, () => {
  describe('POST /tokens — issue', () => {
    it('200 → TokenIssueResponse for valid client credentials', async () => {
      const res = await agent()
        .post('/api/v1/security/tokens')
        .send({ clientId: SEED.m2mClientId, clientSecret: SEED.m2mClientSecret, scope: 'read' })
      expect(res.status).toBe(200)
      assertSchema('TokenIssueResponse', res.body)
      expect(res.body.tokenType).toBe('Bearer')
      expect(typeof res.body.accessToken).toBe('string')
    })

    it('401 → ErrorBody on bad client credentials (fail-closed)', async () => {
      const res = await agent()
        .post('/api/v1/security/tokens')
        .send({ clientId: SEED.m2mClientId, clientSecret: 'wrong' })
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
      expect(res.body).not.toHaveProperty('accessToken')
    })

    it('400 → ErrorBody on malformed body', async () => {
      const res = await agent().post('/api/v1/security/tokens').send({ clientId: 'x' })
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })
  })

  describe('POST /tokens/introspect', () => {
    it('200 → { active: true } for a freshly issued token', async () => {
      const issued = await agent()
        .post('/api/v1/security/tokens')
        .send({ clientId: SEED.m2mClientId, clientSecret: SEED.m2mClientSecret })
      const res = await agent()
        .post('/api/v1/security/tokens/introspect')
        .send({ token: issued.body.accessToken })
      expect(res.status).toBe(200)
      assertSchema('TokenIntrospection', res.body)
      expect(res.body.active).toBe(true)
    })

    it('200 → { active: false } for an unknown token (FAIL-CLOSED, never permissive)', async () => {
      const res = await agent()
        .post('/api/v1/security/tokens/introspect')
        .send({ token: 'unknown-token-xyz' })
      expect(res.status).toBe(200)
      assertSchema('TokenIntrospection', res.body)
      expect(res.body.active).toBe(false)
    })
  })
})
