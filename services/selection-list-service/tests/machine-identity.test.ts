// machine-identity.test.ts — the service's own client_credentials identity for
// Security API grant/revoke (lib/machineIdentity.ts), built on
// @fuzefront/service-auth's createServiceAuthClient.
//
// The token client is mocked (virtual) — no network, no Authentik, and no
// dependency on the package build.

const mockGetToken = jest.fn();
const mockCreateClient = jest.fn((_opts: unknown) => ({ getToken: mockGetToken, invalidate: jest.fn() }));

jest.mock(
  '@fuzefront/service-auth',
  () => ({ createServiceAuthClient: (o: unknown) => mockCreateClient(o) }),
  { virtual: true },
);

import {
  getGrantToken,
  machineIdentityConfigured,
  _setGrantTokenProviderForTesting,
  AUTHZ_ADMIN_SCOPE,
  MachineIdentityError,
} from '../src/lib/machineIdentity';

const SAVED = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  mockGetToken.mockReset().mockResolvedValue('minted-machine-token');
  mockCreateClient.mockClear();
  _setGrantTokenProviderForTesting(null); // fresh cache each test
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

it('AUTHZ_ADMIN_SCOPE matches the Security API gate (backend/security authz.ts)', () => {
  expect(AUTHZ_ADMIN_SCOPE).toBe('authz:admin');
});

describe('configured (SECURITY_SERVICE_URL + client id/secret set)', () => {
  beforeEach(() =>
    setEnv({
      NODE_ENV: 'production',
      SECURITY_SERVICE_URL: 'http://fuzefront-security:3002',
      SELECTION_LIST_SERVICE_CLIENT_ID: 'selection-list-service',
      SELECTION_LIST_SERVICE_CLIENT_SECRET: 'not-a-real-secret',
      SELECTION_LIST_SERVICE_TOKEN_SCOPE: undefined,
    }),
  );

  it('mints through service-auth with the authz:admin scope against the Security API ORIGIN', async () => {
    await expect(getGrantToken()).resolves.toBe('minted-machine-token');
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://fuzefront-security:3002', // origin only — service-auth appends /api/v1/security/tokens
        clientId: 'selection-list-service',
        clientSecret: 'not-a-real-secret',
        scope: 'authz:admin',
      }),
    );
  });

  it('reuses one client (caching/refresh/single-flight live in service-auth) across calls', async () => {
    await getGrantToken();
    await getGrantToken();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockGetToken).toHaveBeenCalledTimes(2);
  });

  it('honours an explicit scope override', async () => {
    setEnv({ SELECTION_LIST_SERVICE_TOKEN_SCOPE: 'authz:admin selectionlist:grants' });
    await getGrantToken();
    expect(mockCreateClient.mock.calls[0][0]).toMatchObject({ scope: 'authz:admin selectionlist:grants' });
  });

  it('propagates a token-issuance failure (fail closed) and never falls back to anything else', async () => {
    mockGetToken.mockRejectedValue(new Error('TOKEN_REQUEST_FAILED'));
    await expect(getGrantToken()).rejects.toThrow('TOKEN_REQUEST_FAILED');
  });

  it('machineIdentityConfigured() is true', () => {
    expect(machineIdentityConfigured()).toBe(true);
  });
});

describe('NOT configured — fail closed', () => {
  it.each([
    ['no client id', { SELECTION_LIST_SERVICE_CLIENT_ID: undefined, SELECTION_LIST_SERVICE_CLIENT_SECRET: 'x' }],
    ['no client secret', { SELECTION_LIST_SERVICE_CLIENT_ID: 'x', SELECTION_LIST_SERVICE_CLIENT_SECRET: undefined }],
    ['neither', { SELECTION_LIST_SERVICE_CLIENT_ID: undefined, SELECTION_LIST_SERVICE_CLIENT_SECRET: undefined }],
  ])('production, %s: getGrantToken() throws MachineIdentityError (no silent fallback to a user token)', async (_n, env) => {
    setEnv({ NODE_ENV: 'production', SECURITY_SERVICE_URL: 'http://fuzefront-security:3002', ...env });
    await expect(getGrantToken()).rejects.toBeInstanceOf(MachineIdentityError);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(machineIdentityConfigured()).toBe(false);
  });

  it('non-production against a real/stand-in Security API URL is ALSO fail-closed when unconfigured', async () => {
    setEnv({
      NODE_ENV: 'test',
      SECURITY_SERVICE_URL: 'http://localhost:3002',
      SELECTION_LIST_SERVICE_CLIENT_ID: undefined,
      SELECTION_LIST_SERVICE_CLIENT_SECRET: undefined,
    });
    await expect(getGrantToken()).rejects.toBeInstanceOf(MachineIdentityError);
  });
});

describe('unit-test no-op mode (NODE_ENV=test and no SECURITY_SERVICE_URL)', () => {
  it('returns an inert placeholder (the no-op AuthzClient ignores it; no network)', async () => {
    setEnv({ NODE_ENV: 'test', SECURITY_SERVICE_URL: undefined });
    await expect(getGrantToken()).resolves.toBe('noop-machine-token');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('is NOT taken in production even when SECURITY_SERVICE_URL is unset', async () => {
    setEnv({
      NODE_ENV: 'production',
      SECURITY_SERVICE_URL: undefined,
      SELECTION_LIST_SERVICE_CLIENT_ID: undefined,
      SELECTION_LIST_SERVICE_CLIENT_SECRET: undefined,
    });
    await expect(getGrantToken()).rejects.toBeInstanceOf(MachineIdentityError);
  });
});

describe('injected provider (test seam)', () => {
  it('wins over everything else', async () => {
    _setGrantTokenProviderForTesting({ getToken: async () => 'injected' });
    await expect(getGrantToken()).resolves.toBe('injected');
  });
});
