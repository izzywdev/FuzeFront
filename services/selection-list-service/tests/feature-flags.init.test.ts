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
// The package is virtual-mocked so the suite does not depend on its build.

const mockInit = jest.fn();
const mockClose = jest.fn();
const mockGetBooleanValue = jest.fn();

jest.mock(
  '@fuzefront/feature-flags',
  () => ({
    init: (...a: unknown[]) => mockInit(...a),
    close: (...a: unknown[]) => mockClose(...a),
    getClient: () => ({ getBooleanValue: (...a: unknown[]) => mockGetBooleanValue(...a) }),
  }),
  { virtual: true },
);

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
  setFlagClient(null); // use the real lazy-require path -> the virtual mock above
});
afterEach(async () => {
  await closeFeatureFlags();
  delete process.env.FLAGS_FORCE_ON;
});

describe('initFeatureFlags', () => {
  it('calls init() with the Unleash env and the standard evaluation context', async () => {
    await expect(initFeatureFlags({ env: ENV })).resolves.toBe('initialized');
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      { url: 'http://unleash.test:4242/api', clientToken: 'client-token-not-a-real-secret', appName: 'selection-list-service' },
      { environment: 'prod', app: 'selection-list-service' },
    );
  });

  it('defaults the app name and maps a non-production NODE_ENV to FLAG_ENV / local', async () => {
    const env = { UNLEASH_URL: ENV.UNLEASH_URL, UNLEASH_CLIENT_TOKEN: ENV.UNLEASH_CLIENT_TOKEN, NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    await initFeatureFlags({ env });
    expect(mockInit.mock.calls[0][0].appName).toBe('selection-list-service');
    expect(mockInit.mock.calls[0][1].environment).toBe('local');
  });

  it.each([
    ['UNLEASH_URL', { ...ENV, UNLEASH_URL: undefined }],
    ['UNLEASH_CLIENT_TOKEN', { ...ENV, UNLEASH_CLIENT_TOKEN: undefined }],
  ])('skips (never throws) when %s is missing — flags use in-code defaults (OFF)', async (_n, env) => {
    await expect(initFeatureFlags({ env: env as NodeJS.ProcessEnv })).resolves.toBe('skipped-unconfigured');
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('skips when the package cannot be loaded', async () => {
    await expect(initFeatureFlags({ env: ENV, load: () => null })).resolves.toBe('skipped-unavailable');
  });

  it('never throws when init() itself rejects (Unleash/provider failure) — reports "failed"', async () => {
    mockInit.mockRejectedValue(new Error('unleash unreachable'));
    await expect(initFeatureFlags({ env: ENV })).resolves.toBe('failed');
  });

  it('closeFeatureFlags() closes the provider after a successful init, and is safe when init never ran', async () => {
    await closeFeatureFlags(); // never initialised: no-op
    expect(mockClose).not.toHaveBeenCalled();
    await initFeatureFlags({ env: ENV });
    await closeFeatureFlags();
    expect(mockClose).toHaveBeenCalledTimes(1);
    await closeFeatureFlags(); // idempotent
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('closeFeatureFlags() swallows a close() failure (shutdown must continue)', async () => {
    await initFeatureFlags({ env: ENV });
    mockClose.mockRejectedValue(new Error('close failed'));
    await expect(closeFeatureFlags()).resolves.toBeUndefined();
  });
});

describe('release flag fuzefront.selection-lists.service — BOTH states through the real client path', () => {
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

    it('FLAGS_FORCE_ON (existing CI pattern) turns it ON outside production with no provider at all', async () => {
      mockGetBooleanValue.mockResolvedValue(false);
      process.env.FLAGS_FORCE_ON = FLAG;
      const res = await request(createApp()).get('/v1/selection-lists/not-an-id').set(auth());
      expect(res.status).toBe(400); // past the gate
    });
  });
});
