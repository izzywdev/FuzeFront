// flags.shared-lists.test.ts — the release flag `fuzefront.selection-lists.shared-lists` (default OFF).
//
// Fail-safe OFF with no client / a throwing client; the in-code default passed to the client is OFF (release
// flag); the evaluation context is the canonical one (orgId/userId TypeIDs, app); the non-production
// FLAGS_FORCE_ON hatch works for this key only and is inert in production. Authorization never routes
// through it (asserted in the shared-lists route suites: Permit decides, with the flag ON or OFF).

import { FLAGS, isSharedListsEnabled, setFlagClient } from '../src/flags';

const KEY = 'fuzefront.selection-lists.shared-lists';

describe('isSharedListsEnabled', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    delete process.env.FLAGS_FORCE_ON;
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

  it('FLAGS_FORCE_ON turns it ON outside production for this key only; it never works in production', async () => {
    process.env.FLAGS_FORCE_ON = 'fuzefront.selection-lists.service';
    await expect(isSharedListsEnabled()).resolves.toBe(false); // another key forced: not this one
    process.env.FLAGS_FORCE_ON = `fuzefront.selection-lists.service, ${KEY}`;
    await expect(isSharedListsEnabled()).resolves.toBe(true);
    process.env.NODE_ENV = 'production';
    await expect(isSharedListsEnabled()).resolves.toBe(false);
  });
});
