import { InMemoryProvider } from '@openfeature/server-sdk';
import { getClient, close, __setProviderForTesting } from '../src/server';
import { WEB_EXPOSED_FLAGS, FLAG_KEYS } from '../src/catalog';

/**
 * `getClient()` is the export `backend/applications/src/app-registry/flags.ts`
 * (and the host's /api/flags route) resolve via
 * `require('@fuzefront/feature-flags').getClient()`. It was MISSING, so those
 * callers got `undefined`, fell back to null, and every flag silently took its
 * in-code default regardless of Unleash. These tests pin the contract.
 */
const flags = {
  'fuzefront.account-security.hub': {
    disabled: false,
    variants: { on: true, off: false },
    defaultVariant: 'off',
    // Stand-in for the `developers` segment: ON only for the developer user.
    contextEvaluator: (ctx: any) =>
      ctx?.targetingKey === 'dev-user' ? 'on' : 'off',
  },
  'fuzefront.app-registry.kafka-events-kill-switch': {
    disabled: false,
    variants: { on: true, off: false },
    defaultVariant: 'on',
  },
} as const;

describe('getClient()', () => {
  beforeAll(async () => {
    await __setProviderForTesting(new InMemoryProvider(flags as any));
  });
  afterAll(async () => {
    await close();
  });

  it('is exported and exposes the OpenFeature-shaped read methods', () => {
    const client = getClient();
    expect(typeof client.getBooleanValue).toBe('function');
    expect(typeof client.getStringValue).toBe('function');
    expect(typeof client.getNumberValue).toBe('function');
  });

  // BOTH states of a release flag, per the feature-flags skill.
  it('resolves ON for the targeted (developer) user', async () => {
    const v = await getClient().getBooleanValue(
      'fuzefront.account-security.hub',
      false,
      { userId: 'dev-user' },
    );
    expect(v).toBe(true);
  });

  it('resolves OFF for a non-targeted user (rollout unchanged)', async () => {
    const v = await getClient().getBooleanValue(
      'fuzefront.account-security.hub',
      false,
      { userId: 'someone-else' },
    );
    expect(v).toBe(false);
  });

  it('kill-switch stays ON for everyone (default ON, not segment-gated)', async () => {
    for (const userId of ['dev-user', 'someone-else']) {
      const v = await getClient().getBooleanValue(
        'fuzefront.app-registry.kafka-events-kill-switch',
        true,
        { userId },
      );
      expect(v).toBe(true);
    }
  });

  it('returns the caller default for an unknown flag instead of throwing', async () => {
    await expect(
      getClient().getBooleanValue('fuzefront.does.not-exist', false, { userId: 'dev-user' }),
    ).resolves.toBe(false);
    await expect(
      getClient().getBooleanValue('fuzefront.does.not-exist', true, { userId: 'dev-user' }),
    ).resolves.toBe(true);
  });
});

describe('WEB_EXPOSED_FLAGS catalog', () => {
  it('exposes only browser-facing flags — never server-only ones', () => {
    const keys = WEB_EXPOSED_FLAGS.map(f => f.key);
    expect(keys).toContain('fuzefront.account-security.hub');
    expect(keys).toContain('fuzefront.billing.invoice-history');
    // FF-EPIC-17 identity UI flags must be web-exposed, or flipping them in
    // Unleash leaves the browser UI dark (GET /api/flags never discloses them).
    expect(keys).toContain('fuzefront.identity.personal-context');
    expect(keys).toContain('fuzefront.identity.member-directory');
    expect(keys).toContain('fuzefront.identity.employee-console');
    // Selection Lists UI is browser-gated by useFlag(); without this entry the
    // flag reads permanently OFF in the browser no matter what Unleash says.
    expect(keys).toContain('fuzefront.selection-lists.service');
    // Shared/common lists (SL9): the UI gates the common badge + fork flow on it.
    expect(keys).toContain('fuzefront.selection-lists.shared-lists');
    // Seeding flag is server-only (selection-list-service consumers): it has a
    // FLAG_KEYS constant but must never be disclosed to the browser.
    expect(keys).not.toContain('fuzefront.selection-lists.seed-defaults');
    // root-membership is server-only (security-service provisioning) — the
    // browser must never see it.
    expect(keys).not.toContain('fuzefront.identity.root-membership');
    // Server-only app-registry flags must not be disclosed to the browser.
    expect(keys).not.toContain('fuzefront.app-registry.v1-registry-write');
    expect(keys).not.toContain('fuzefront.app-registry.kafka-events-kill-switch');
  });

  it('names the server-only seeding flag via FLAG_KEYS (not web-exposed)', () => {
    expect(FLAG_KEYS.SELECTION_LISTS_SEED_DEFAULTS).toBe(
      'fuzefront.selection-lists.seed-defaults',
    );
  });

  it('registers the shared-lists flag as a default-OFF release flag', () => {
    expect(FLAG_KEYS.SELECTION_LISTS_SHARED_LISTS).toBe('fuzefront.selection-lists.shared-lists');
    const f = WEB_EXPOSED_FLAGS.find(x => x.key === FLAG_KEYS.SELECTION_LISTS_SHARED_LISTS);
    expect(f).toEqual({
      key: 'fuzefront.selection-lists.shared-lists',
      type: 'release',
      default: false,
    });
  });

  it('classifies fuzefront.apps.org-context-disabled as a default-ON kill-switch, not a release flag', () => {
    // Runtime default is `true` (ON in prod; frontend useFlag fallback is true).
    // A default-ON flag is only valid as an ops-kill-switch per the taxonomy;
    // typing it `release` would violate release => default OFF.
    const f = WEB_EXPOSED_FLAGS.find(x => x.key === FLAG_KEYS.APPS_ORG_CONTEXT_DISABLED);
    expect(f).toEqual({
      key: 'fuzefront.apps.org-context-disabled',
      type: 'ops-kill-switch',
      default: true,
    });
  });

  it('declares release flags fail-safe OFF', () => {
    for (const f of WEB_EXPOSED_FLAGS) {
      if (f.type === 'release') expect(f.default).toBe(false);
      if (f.type === 'ops-kill-switch') expect(f.default).toBe(true);
    }
  });
});
