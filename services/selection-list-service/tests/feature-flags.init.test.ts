// feature-flags.init.test.ts — rollout blocker B4: the release flag could never
// turn ON in a deployed service because nothing called @fuzefront/feature-flags'
// init(). These tests pin the wiring and BOTH flag states after init:
//
//   - init() is called with UNLEASH_URL / UNLEASH_CLIENT_TOKEN / UNLEASH_APP_NAME
//     (+ the standard evaluation context), and shutdown closes the provider
//   - unconfigured / unloadable / throwing init  => fail-closed OFF, never fatal
//   - flag ON  path: provider says true  => /v1/selection-lists is served
//   - flag OFF path: provider says false / unreachable => 404 (feature dark)
//
// The package is injected through the existing seams (initFeatureFlags `load`,
// flags.ts setFlagClient), so the suite does not depend on the package build and
// is not order-dependent (a jest.mock of a resolvable module is, across files).

const mockInit = jest.fn();
const mockClose = jest.fn();
const mockGetBooleanValue = jest.fn();
const fakeModule = {
  init: (...a: unknown[]) => mockInit(...a),
  close: (...a: unknown[]) => mockClose(...a),
};
const fakeClient = { getBooleanValue: (...a: unknown[]) => mockGetBooleanValue(...a) };

jest.mock('../src/db', () => {
  const db: any = jest.fn();
  db.raw = jest.fn().mockResolvedValue({ rows: [] });
  return { db };
});

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { setFlagClient, isSelectionListsEnabled } from '../src/flags';
import { initFeatureFlags, closeFeatureFlags } from '../src/lib/featureFlags';

const FLAG = 'fuzefront.selection-lists.service';
const ENV = {
  UNLEASH_URL: 'http://unleash.test:4242/api',
  UNLEASH_CLIENT_TOKEN: 'client-token-not-a-real-secret',
  UNLEASH_APP_NAME: 'selection-list-service',
  NODE_ENV: 'production',
} as NodeJS.ProcessEnv;

beforeEach(() => {
  mockInit.mockReset().mockResolvedValue(undefined);
  mockClose.mockReset().mockResolvedValue(undefined);
  mockGetBooleanValue.mockReset();
  setFlagClient(fakeClient); // what flags.ts gets from the package's getClient() after init()
});
afterEach(async () => {
  await closeFeatureFlags();
  setFlagClient(null);
  delete process.env.FUZE_FLAGS_PROVIDER;
  delete process.env.FUZE_FLAGS_OFFLINE_ON;
});

describe('initFeatureFlags', () => {
  it('calls init() with the Unleash env and the standard evaluation context', async () => {
    await expect(initFeatureFlags({ env: ENV, load: () => fakeModule })).resolves.toBe('initialized');
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      { url: 'http://unleash.test:4242/api', clientToken: 'client-token-not-a-real-secret', appName: 'selection-list-service' },
      { environment: 'prod', app: 'selection-list-service' },
    );
  });

  it('defaults the app name and maps a non-production NODE_ENV to FLAG_ENV / local', async () => {
    const env = { UNLEASH_URL: ENV.UNLEASH_URL, UNLEASH_CLIENT_TOKEN: ENV.UNLEASH_CLIENT_TOKEN, NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    await initFeatureFlags({ env, load: () => fakeModule });
    expect(mockInit.mock.calls[0][0].appName).toBe('selection-list-service');
    expect(mockInit.mock.calls[0][1].environment).toBe('local');
  });

  it.each([
    ['UNLEASH_URL', { ...ENV, UNLEASH_URL: undefined }],
    ['UNLEASH_CLIENT_TOKEN', { ...ENV, UNLEASH_CLIENT_TOKEN: undefined }],
  ])('skips (never throws) when %s is missing — flags use in-code defaults (OFF)', async (_n, env) => {
    await expect(initFeatureFlags({ env: env as NodeJS.ProcessEnv, load: () => fakeModule })).resolves.toBe('skipped-unconfigured');
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('skips when the package cannot be loaded', async () => {
    await expect(initFeatureFlags({ env: ENV, load: () => null })).resolves.toBe('skipped-unavailable');
  });

  it('never throws when init() itself rejects (Unleash/provider failure) — reports "failed"', async () => {
    mockInit.mockRejectedValue(new Error('unleash unreachable'));
    await expect(initFeatureFlags({ env: ENV, load: () => fakeModule })).resolves.toBe('failed');
  });

  it('closeFeatureFlags() closes the provider after a successful init, and is safe when init never ran', async () => {
    await closeFeatureFlags(); // never initialised: no-op
    expect(mockClose).not.toHaveBeenCalled();
    await initFeatureFlags({ env: ENV, load: () => fakeModule });
    await closeFeatureFlags();
    expect(mockClose).toHaveBeenCalledTimes(1);
    await closeFeatureFlags(); // idempotent
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('closeFeatureFlags() swallows a close() failure (shutdown must continue)', async () => {
    await initFeatureFlags({ env: ENV, load: () => fakeModule });
    mockClose.mockRejectedValue(new Error('close failed'));
    await expect(closeFeatureFlags()).resolves.toBeUndefined();
  });
});

describe('release flag fuzefront.selection-lists.service — BOTH states through the client path', () => {
  it('ON: the provider answers true -> enabled, with the org/user context mapped for targeting', async () => {
    mockGetBooleanValue.mockResolvedValue(true);
    await expect(isSelectionListsEnabled({ organizationId: 'org_a', userId: 'usr_a' })).resolves.toBe(true);
    expect(mockGetBooleanValue).toHaveBeenCalledWith(
      FLAG,
      false, // in-code default is OFF (release flag)
      expect.objectContaining({ app: 'selection-list-service', orgId: 'org_a', userId: 'usr_a' }),
    );
  });

  it('OFF: the provider answers false -> disabled', async () => {
    mockGetBooleanValue.mockResolvedValue(false);
    await expect(isSelectionListsEnabled({ organizationId: 'org_a' })).resolves.toBe(false);
  });

  it('fail-closed: the provider throws (Unleash unreachable) -> OFF, not an error', async () => {
    mockGetBooleanValue.mockRejectedValue(new Error('unleash down'));
    await expect(isSelectionListsEnabled({ organizationId: 'org_a' })).resolves.toBe(false);
  });

  describe('through the HTTP gate', () => {
    const SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-flags-init';
    const auth = () => ({ Authorization: `Bearer ${jwt.sign({ userId: 'usr_1', orgId: 'org_1' }, SECRET)}` });
    beforeAll(() => {
      process.env.JWT_SECRET = SECRET;
    });

    it('flag ON (provider true): the gate lets /v1/selection-lists/quota through to the router', async () => {
      mockGetBooleanValue.mockResolvedValue(true);
      const res = await request(createApp()).get('/v1/selection-lists/not-an-id').set(auth());
      // 400 = the request got PAST the flag gate and was rejected by edge id validation.
      expect(res.status).toBe(400);
    });

    it('flag OFF (provider false): the gate answers 404 before any router runs', async () => {
      mockGetBooleanValue.mockResolvedValue(false);
      const res = await request(createApp()).get('/v1/selection-lists/not-an-id').set(auth());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    // The offline provider forces the release flag ON exactly like the old
    // FLAGS_FORCE_ON hatch did, but through the REAL OpenFeature client path:
    // a listed key resolves true, so POST /v1/selection-lists gets past the gate
    // (then edge validation rejects the empty body with 400). The OFF counterpart
    // (no provider -> 404 NOT_FOUND) is the contract dark.spec.ts asserts against
    // the live service for the CI matrix's `off` leg.
    it('offline provider ON (flag in the on-list): POST /v1/selection-lists gets past the gate', async () => {
      setFlagClient(offlineClient([FLAG]));
      const res = await request(createApp()).post('/v1/selection-lists').set(auth()).send({});
      expect(res.status).not.toBe(404);
    });

    it('no provider (flag OFF): POST /v1/selection-lists is 404 NOT_FOUND (feature dark)', async () => {
      setFlagClient(null); // fail-safe default OFF, same path as an Unleash outage
      const res = await request(createApp()).post('/v1/selection-lists').set(auth()).send({});
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});

// A stand-in for the offline InMemoryProvider: keys in the on-list resolve true,
// every other key falls through to the caller's in-code default — the exact
// semantics of @fuzefront/feature-flags' offline provider, exercised here through
// flags.ts's real client seam (the package dist is not built for this unit suite).
function offlineClient(onKeys: string[]) {
  return {
    getBooleanValue: async (key: string, defaultValue: boolean) =>
      onKeys.includes(key) ? true : defaultValue,
  };
}

describe('initFeatureFlags offline branch (replaces the FLAGS_FORCE_ON hatch)', () => {
  const OFFLINE_ENV = {
    FUZE_FLAGS_PROVIDER: 'offline',
    FUZE_FLAGS_OFFLINE_ON: `  ${FLAG} , , other.flag `,
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv;

  it('installs the offline provider with the trimmed on-list and standard context', async () => {
    await expect(initFeatureFlags({ env: OFFLINE_ENV, load: () => fakeModule })).resolves.toBe('initialized');
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      { provider: 'offline', offline: { on: [FLAG, 'other.flag'] }, appName: 'selection-list-service' },
      { environment: 'local', app: 'selection-list-service' },
    );
  });

  it('is NOT taken when Unleash is configured — Unleash wins (no offline options passed)', async () => {
    const env = { ...OFFLINE_ENV, UNLEASH_URL: 'http://unleash.test:4242/api', UNLEASH_CLIENT_TOKEN: 'tok' };
    await expect(initFeatureFlags({ env, load: () => fakeModule })).resolves.toBe('initialized');
    expect(mockInit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ url: 'http://unleash.test:4242/api', clientToken: 'tok' }),
    );
    expect(mockInit.mock.calls[0][0].provider).toBeUndefined();
  });

  it('fails closed (never throws) when the provider refuses — e.g. production refusal', async () => {
    // The real provider throws FlagsConfigError in production; here the injected
    // init rejects to stand in for that. initFeatureFlags must report "failed",
    // leaving the flag OFF rather than propagating.
    mockInit.mockRejectedValue(new Error('offline provider refused in production'));
    await expect(initFeatureFlags({ env: OFFLINE_ENV, load: () => fakeModule })).resolves.toBe('failed');
  });

  it('skips (unconfigured) when neither Unleash nor the offline provider is requested', async () => {
    const env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    await expect(initFeatureFlags({ env, load: () => fakeModule })).resolves.toBe('skipped-unconfigured');
    expect(mockInit).not.toHaveBeenCalled();
  });
});
