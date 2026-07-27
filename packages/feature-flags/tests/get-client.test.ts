import { InMemoryProvider } from '@openfeature/server-sdk';
import { getClient, close, __setProviderForTesting } from '../src/server';
import { WEB_EXPOSED_FLAGS } from '../src/catalog';

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
    // Server-only app-registry flags must not be disclosed to the browser.
    expect(keys).not.toContain('fuzefront.app-registry.v1-registry-write');
    expect(keys).not.toContain('fuzefront.app-registry.kafka-events-kill-switch');
  });

  it('declares release flags fail-safe OFF', () => {
    for (const f of WEB_EXPOSED_FLAGS) {
      if (f.type === 'release') expect(f.default).toBe(false);
      if (f.type === 'ops-kill-switch') expect(f.default).toBe(true);
    }
  });
});
