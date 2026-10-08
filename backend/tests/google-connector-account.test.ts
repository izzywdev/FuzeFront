import axios from 'axios'
import { googleAccountIdentity, requireGoogleBinding, requireGoogleScopes, refreshGoogleCredential } from '../src/connector-platform/google-account'

jest.mock('axios')
const http = axios as jest.Mocked<typeof axios>
const scope = 'https://www.googleapis.com/auth/gmail.readonly'
const identity = { subject: 'stable-google-subject', client_id: 'configured-client' }

beforeEach(() => jest.resetAllMocks())

test('requires a verified Google subject rather than email alone', async () => {
  http.get.mockResolvedValue({ data: { email: 'same@example.com', email_verified: true } })
  await expect(googleAccountIdentity('token', 'configured-client')).rejects.toThrow('renewed')
  http.get.mockResolvedValue({ data: { sub: identity.subject, email: 'same@example.com', email_verified: true } })
  await expect(googleAccountIdentity('token', 'configured-client')).resolves.toEqual({ identity, email: 'same@example.com' })
})

test('rejects legacy or different-client bindings before refreshing', async () => {
  expect(() => requireGoogleBinding(undefined, 'configured-client')).toThrow('renewed')
  expect(() => requireGoogleBinding(identity, 'other-client')).toThrow('renewed')
  await expect(refreshGoogleCredential({ refresh_token: 'secret' }, identity, 'other-client', 'configured-secret', [scope])).rejects.toThrow('renewed')
  expect(http.post).not.toHaveBeenCalled()
})

test('refresh uses its own configured OAuth client and preserves refresh only for the same verified subject', async () => {
  http.post.mockResolvedValue({ data: { access_token: 'new-access', expires_in: 120 } })
  http.get.mockResolvedValue({ data: { sub: identity.subject, email: 'new@example.com', email_verified: true } })
  const result = await refreshGoogleCredential({ access_token: 'old', refresh_token: 'refresh', scope }, identity, identity.client_id, 'configured-secret', [scope])
  expect(result.refresh_token).toBe('refresh')
  expect(result.access_token).toBe('new-access')
  const form = http.post.mock.calls[0][1] as URLSearchParams
  expect(form.get('client_id')).toBe('configured-client')
  expect(form.get('client_secret')).toBe('configured-secret')
  http.get.mockResolvedValue({ data: { sub: 'different-subject', email: 'new@example.com', email_verified: true } })
  await expect(refreshGoogleCredential({ refresh_token: 'refresh', scope }, identity, identity.client_id, 'configured-secret', [scope])).rejects.toThrow('renewed')
})

test('requires actual granted resource scopes and rejects a narrowed refreshed grant', async () => {
  expect(() => requireGoogleScopes({}, [scope])).toThrow('renewed')
  http.post.mockResolvedValue({ data: { access_token: 'new', scope: 'openid email' } })
  http.get.mockResolvedValue({ data: { sub: identity.subject, email: 'verified@example.com', email_verified: true } })
  await expect(refreshGoogleCredential({ refresh_token: 'refresh', scope }, identity, identity.client_id, 'configured-secret', [scope])).rejects.toThrow('renewed')
})
