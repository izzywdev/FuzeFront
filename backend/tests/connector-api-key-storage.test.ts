import express from 'express'
import request from 'supertest'
import axios from 'axios'
import { createConnectorPlatformRouter } from '../src/connector-platform'

jest.mock('axios')
jest.mock('../src/config/database', () => ({ db: undefined }))
jest.mock('../src/middleware/auth', () => ({ authenticateToken: (req: any, _res: unknown, next: () => void) => {
  req.user = { activeOrganizationId: req.header('x-active-organization') || null }
  next()
} }))
const mockExchange = jest.fn(async () => ({ accessToken: 'verified-delegation' }))
jest.mock('@fuzefront/service-auth', () => ({
  createWorkloadAuthClient: () => ({ getToken: async () => 'verified-workload' }),
  createDelegationClient: () => ({ exchange: mockExchange }),
}))

const app = express().use(express.json()).use('/connectors', createConnectorPlatformRouter([
  { id: 'anthropic', name: 'Anthropic', authentication: 'api-key' },
], { fuzekeysUrl: 'https://keys.invalid' }))
const store = () => request(app).post('/connectors/anthropic/credential')
  .set('Authorization', 'Bearer authenticated-user').send({ api_key: 'fixture-key' })

beforeEach(() => { jest.resetAllMocks(); mockExchange.mockResolvedValue({ accessToken: 'verified-delegation' }) })

test('delegates using the selected organization and the authenticated bearer', async () => {
  ;(axios.put as jest.Mock).mockResolvedValue({ status: 200, data: { status: 'updated' } })
  await request(app).post('/connectors/anthropic/credential')
    .set('Authorization', 'Bearer authenticated-user')
    .set('x-active-organization', '22222222-2222-4222-8222-222222222222')
    .send({ api_key: 'fixture-key' }).expect(201)
  expect(mockExchange).toHaveBeenCalledWith(expect.objectContaining({
    subjectToken: 'authenticated-user', tenant: '22222222-2222-4222-8222-222222222222',
  }))
})

test('omits organization for a personal credential scope', async () => {
  ;(axios.put as jest.Mock).mockResolvedValue({ status: 200, data: { status: 'updated' } })
  await store().expect(201)
  expect(mockExchange).toHaveBeenCalledWith(expect.objectContaining({
    subjectToken: 'authenticated-user', tenant: undefined,
  }))
})

test('Keys staged credentials return pending approval instead of connected', async () => {
  ;(axios.put as jest.Mock).mockResolvedValue({ status: 202, data: { status: 'authorization_pending' } })
  const response = await store().expect(202)
  expect(response.body).toEqual({ status: 'authorization_pending', provider: 'anthropic', retry_after_authorization: true })
  expect(JSON.stringify(response.body)).not.toContain('fixture-key')
  expect(axios.put).toHaveBeenCalledWith('https://keys.invalid/api/v1/connectors/anthropic/credential',
    { credential: { access_token: 'fixture-key' }, identity_email: undefined, configuration: {} },
    { headers: { Authorization: 'Bearer verified-workload', 'X-Fuze-Delegation': 'Bearer verified-delegation' }, timeout: 10000 })
})

test('only a confirmed Keys update returns connected', async () => {
  ;(axios.put as jest.Mock).mockResolvedValue({ status: 200, data: { status: 'updated' } })
  const response = await store().expect(201)
  expect(response.body).toEqual({ status: 'connected', provider: 'anthropic' })
})

test.each([
  { status: 202, data: { status: 'updated' } },
  { status: 200, data: { status: 'authorization_pending' } },
  { status: 200, data: {} },
])('ambiguous Keys response %j fails closed at the route', async upstream => {
  ;(axios.put as jest.Mock).mockResolvedValue(upstream)
  await store().expect(502)
})

test('Keys transport failure does not report connected', async () => {
  ;(axios.put as jest.Mock).mockRejectedValue(new Error('unavailable'))
  await store().expect(502)
})
