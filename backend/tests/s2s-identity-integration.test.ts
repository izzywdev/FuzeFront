/**
 * s2s-identity-integration.test.ts
 *
 * Minimal end-to-end integration test for the platform S2S identity foundation
 * (izzywdev/FuzeFront#648 acceptance criterion: "Integration test: token
 * issuance → JWKS validation → permit.check"). Chains all three pieces added by
 * this PR against mocked Authentik / Permit / JWKS transports — no live external
 * dependencies, same pattern as every other Authentik/Permit unit test in this
 * suite.
 *
 * The chain exercised:
 *   1. `registerS2SClient` provisions a client_credentials application in
 *      Authentik (mocked Admin API) and returns client_id/client_secret.
 *   2. The consumer "obtains a token" — here simulated by directly signing a JWT
 *      with the SAME shape Authentik would issue (aud/service/scopes claims,
 *      RS256, matching kid), since exercising Authentik's live token endpoint is
 *      out of scope for a unit-test-only suite. `verifyMachineTokenViaJwks`
 *      verifies that token against the mocked JWKS endpoint.
 *   3. `grantServiceInvoke` grants the resulting service account `invoke` on a
 *      named `ServiceEndpoint` instance in Permit (mocked SDK), and
 *      `checkMachinePermission` confirms `permit.check(...)` is called with the
 *      subject/action/resource the grant implies — proving the whole path from
 *      "a service was registered" to "its token authorizes a specific call" is
 *      wired correctly.
 */

jest.mock('axios', () => {
  const actual = jest.requireActual('axios')
  return { ...actual, post: jest.fn(), get: jest.fn(), isAxiosError: actual.isAxiosError }
})

// Mirrors machine-auth.test.ts's permit mock, but with resourceInstances /
// roleAssignments / check spies so this test can assert on the calls
// grantServiceInvoke + checkMachinePermission make.
const mockPermit = {
  check: jest.fn().mockResolvedValue(true),
  api: {
    users: { sync: jest.fn().mockResolvedValue(undefined) },
    resourceInstances: { create: jest.fn().mockResolvedValue(undefined) },
    roleAssignments: { assign: jest.fn().mockResolvedValue(undefined) },
  },
}
jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: mockPermit,
  destroyPermitClient: jest.fn(),
}))

import axios from 'axios'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import * as s2sJwksFlagModule from '../src/utils/s2sJwksFlag'
import { registerS2SClient } from '../src/authentik/provision-s2s-clients'
import { verifyMachineTokenViaJwks, _clearJwksCacheForTests } from '../src/services/jwks-verify'
import { buildMachineIdentity, TokenIntrospectionResult } from '../src/services/machine-identity'
import {
  grantServiceInvoke,
  checkMachinePermission,
} from '../src/utils/permit/machine-roles'

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>

const ISSUER = 'http://authentik.test/application/o/s2s-fuzecall-backend/'
const ENDPOINT_KEY = 'fuzecall_control_plane'

beforeEach(() => {
  jest.clearAllMocks()
  _clearJwksCacheForTests()
  process.env.AUTHENTIK_ADMIN_TOKEN = 'admin-token'
  process.env.AUTHENTIK_BASE_URL = 'http://authentik.test:9000'
})

afterEach(() => {
  delete process.env.AUTHENTIK_ADMIN_TOKEN
  delete process.env.AUTHENTIK_BASE_URL
})

describe('S2S identity foundation — issuance -> JWKS validation -> permit.check', () => {
  it('wires a newly registered service account through to an authorized invoke check', async () => {
    // ---- Step 1: provision the service in Authentik (mocked) ----------------
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const kid = 'integration-test-kid'
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid, use: 'sig', alg: 'RS256' }

    mockedGet.mockImplementation(async (url: string, config?: any) => {
      if (/\/providers\/oauth2\/\d+\/?$/.test(url)) {
        return { data: { client_id: 'fuzecall-backend-client-id', client_secret: 'fuzecall-backend-secret' } } as any
      }
      if (url.includes('/flows/instances/')) {
        const designation = config?.params?.designation
        return {
          data: {
            results: [
              designation === 'authorization'
                ? { slug: 'default-provider-authorization-implicit-consent', pk: 'auth-pk' }
                : { slug: 'default-provider-invalidation-flow', pk: 'inval-pk' },
            ],
          },
        } as any
      }
      if (url.endsWith('/jwks/')) {
        return { data: { keys: [jwk] } } as any
      }
      return { data: { results: [], pagination: { next: 0 } } } as any
    })
    mockedPost.mockImplementation(async (url: string) => {
      if (url.includes('/propertymappings/provider/scope/')) return { data: { pk: 10 } } as any
      if (url.includes('/providers/oauth2/')) return { data: { pk: 20 } } as any
      if (url.includes('/core/applications/')) return { data: { slug: 's2s-fuzecall-backend' } } as any
      throw new Error(`unexpected POST ${url}`)
    })

    const registration = await registerS2SClient('fuzecall-backend', ['fuzecall:control-plane:auth'])
    expect(registration.clientId).toBe('fuzecall-backend-client-id')

    // ---- Step 2: the consumer's token (signed to match what Authentik would
    // issue for this registration) is verified via the published JWKS --------
    jest.spyOn(s2sJwksFlagModule, 'isS2SJwksAuthEnabled').mockResolvedValue(true)

    const token = jwt.sign(
      {
        aud: registration.audience,
        service: registration.service,
        scopes: registration.scopes,
      },
      privateKey.export({ type: 'pkcs1', format: 'pem' }) as string,
      { algorithm: 'RS256', issuer: ISSUER, expiresIn: '5m', keyid: kid }
    )

    const jwksResult = await verifyMachineTokenViaJwks(token, {
      issuer: ISSUER,
      audience: registration.audience,
    })

    expect(jwksResult.verified).toBe(true)
    if (!jwksResult.verified) return // narrows the type for the assertions below
    expect(jwksResult.payload.service).toBe('fuzecall-backend')
    expect(jwksResult.payload.scopes).toEqual(['fuzecall:control-plane:auth'])

    // ---- Step 3: grant the service account `invoke` on the named Permit
    // ServiceEndpoint instance, then confirm a permission check against it
    // reaches permit.check with the right subject/action/resource -----------
    const granted = await grantServiceInvoke(registration.clientId, ENDPOINT_KEY)
    expect(granted).toBe(true)
    expect(mockPermit.api.resourceInstances.create).toHaveBeenCalledWith({
      key: ENDPOINT_KEY,
      resource: 'ServiceEndpoint',
      tenant: 'default',
    })
    expect(mockPermit.api.roleAssignments.assign).toHaveBeenCalledWith({
      user: `svc:${registration.clientId}`,
      role: 's2s-caller',
      resource_instance: `ServiceEndpoint:${ENDPOINT_KEY}`,
      tenant: 'default',
    })

    // Build the MachineIdentity the way authenticateMachineToken would from an
    // introspection result carrying the same client_id/scopes.
    const introspection: TokenIntrospectionResult = {
      active: true,
      client_id: registration.clientId,
      scope: registration.scopes.join(' '),
    }
    const identity = buildMachineIdentity(introspection)!
    expect(identity.clientId).toBe(registration.clientId)

    const allowed = await checkMachinePermission(identity, 'invoke', {
      type: 'ServiceEndpoint',
      tenant: 'default',
      key: ENDPOINT_KEY,
    })

    expect(allowed).toBe(true)
    expect(mockPermit.check).toHaveBeenCalledWith(`svc:${registration.clientId}`, 'invoke', {
      type: 'ServiceEndpoint',
      tenant: 'default',
      key: ENDPOINT_KEY,
    })
  })

  it('never fetches the JWKS or authorizes when the JWKS-auth flag is OFF (default)', async () => {
    jest.spyOn(s2sJwksFlagModule, 'isS2SJwksAuthEnabled').mockResolvedValue(false)

    const token = jwt.sign({ aud: 's2s', service: 'fuzecall-backend' }, 'irrelevant-since-flag-off', {
      algorithm: 'HS256',
      expiresIn: '5m',
    })

    const result = await verifyMachineTokenViaJwks(token, { issuer: ISSUER, audience: 's2s' })

    expect(result).toEqual({ verified: false, reason: 'flag_disabled' })
    expect(mockedGet).not.toHaveBeenCalled()
  })
})
