// flags.shared-lists.test.ts — the release flag `fuzefront.selection-lists.shared-lists` (default OFF).
//
// Fail-safe OFF with no client / a throwing client; the in-code default passed to the client is OFF (release
// flag); the evaluation context is the canonical one (orgId/userId TypeIDs, app); the non-production
// FLAGS_FORCE_ON hatch works for this key only and is inert in production. Authorization never routes
// through it (asserted in the shared-lists route suites: Permit decides, with the flag ON or OFF).

import { FLAGS, isSharedListsEnabled, setFlagClient } from '../src/flags';
import { initFeatureFlags } from '../src/lib/featureFlags';

const KEY = 'fuzefront.selection-lists.shared-lists';

describe('isSharedListsEnabled', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    delete process.env.FLAGS_FORCE_ON; // the retired hatch: must have no effect
    process.env.NODE_ENV = 'test';
    setFlagClient(null);
  });
  afterAll(() => {
    process.env = ENV;
    setFlagClient(null);
  });

  it('is the documented key, default OFF', () => {
    expect(FLAGS.SELECTION_LISTS_SHARED_LISTS).toBe(KEY);
  });

  it('is OFF with no flag client (release flag fail-safe)', async () => {
    await expect(isSharedListsEnabled({ organizationId: 'org_1', userId: 'usr_1' })).resolves.toBe(false);
  });

  it('asks the client for exactly this key with default false and the canonical context', async () => {
    const seen: Array<{ key: string; dflt: boolean; ctx: any }> = [];
    setFlagClient({
      getBooleanValue: async (key, dflt, ctx) => {
        seen.push({ key, dflt, ctx });
        return true;
      },
    });
    await expect(isSharedListsEnabled({ organizationId: 'org_01h455vb4pex5vsknk084sn02q', userId: 'usr_01h455vb4pex5vsknk084sn02q' })).resolves.toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe(KEY);
    expect(seen[0].dflt).toBe(false);
    expect(seen[0].ctx).toMatchObject({ app: 'selection-list-service', orgId: expect.stringMatching(/^org_/), userId: expect.stringMatching(/^usr_/) });
  });

  it('follows the client value, and is OFF when the client throws', async () => {
    setFlagClient({ getBooleanValue: async () => false });
    await expect(isSharedListsEnabled()).resolves.toBe(false);
    setFlagClient({
      getBooleanValue: async () => {
        throw new Error('unleash down');
      },
    });
    await expect(isSharedListsEnabled()).resolves.toBe(false);
  });

  it('the retired FLAGS_FORCE_ON env has NO effect (no escape hatch outside the OpenFeature client)', async () => {
    process.env.FLAGS_FORCE_ON = `fuzefront.selection-lists.service,${KEY}`;
    await expect(isSharedListsEnabled()).resolves.toBe(false);
  });

  it('the offline provider (FUZE_FLAGS_OFFLINE_ON) forces it ON only when the key is in the on-list, via the OpenFeature client', async () => {
    const calls: Array<{ options: any; context: any }> = [];
    const fakeModule = { init: async (options: any, context: any) => { calls.push({ options, context }); } };
    const env = { FUZE_FLAGS_PROVIDER: 'offline', FUZE_FLAGS_OFFLINE_ON: `fuzefront.selection-lists.service, ${KEY}` };
    await expect(initFeatureFlags({ env: env as any, load: () => fakeModule as any })).resolves.toBe('initialized');
    expect(calls[0].options).toMatchObject({ provider: 'offline', offline: { on: ['fuzefront.selection-lists.service', KEY] } });
    // the stand-in client below has the offline InMemoryProvider's semantics: listed keys true, others the default
    const onList = calls[0].options.offline.on as string[];
    setFlagClient({ getBooleanValue: async (key, dflt) => (onList.includes(key) ? true : dflt) });
    await expect(isSharedListsEnabled()).resolves.toBe(true);
    setFlagClient({ getBooleanValue: async (key, dflt) => (key === 'fuzefront.selection-lists.service' ? true : dflt) });
    await expect(isSharedListsEnabled()).resolves.toBe(false); // master ON, shared-lists not listed => OFF
  });
});
