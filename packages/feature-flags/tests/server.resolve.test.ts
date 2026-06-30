import { InMemoryProvider } from '@openfeature/server-sdk';
import {
  getBoolean,
  getString,
  getNumber,
  setContext,
  close,
  __setProviderForTesting,
} from '../src/server';

// Offline, deterministic: OpenFeature InMemoryProvider stands in for Unleash.
const flags = {
  'new-checkout': {
    disabled: false,
    variants: { on: true, off: false },
    defaultVariant: 'on',
  },
  'welcome-banner': {
    disabled: false,
    variants: { v: 'hello' },
    defaultVariant: 'v',
  },
  'max-items': {
    disabled: false,
    variants: { n: 25 },
    defaultVariant: 'n',
  },
  // Context-aware: only "on" when orgId === org-vip.
  'vip-feature': {
    disabled: false,
    variants: { on: true, off: false },
    defaultVariant: 'off',
    contextEvaluator: (ctx: any) =>
      ctx?.orgId === 'org-vip' ? 'on' : 'off',
  },
} as const;

describe('server flag resolution (InMemoryProvider)', () => {
  beforeAll(async () => {
    await __setProviderForTesting(new InMemoryProvider(flags as any));
  });

  afterAll(async () => {
    await close();
  });

  it('getBoolean returns the configured value', async () => {
    expect(await getBoolean('new-checkout', false)).toBe(true);
  });

  it('getString returns the configured value', async () => {
    expect(await getString('welcome-banner', 'default')).toBe('hello');
  });

  it('getNumber returns the configured value', async () => {
    expect(await getNumber('max-items', 0)).toBe(25);
  });

  it('returns the default for an unknown flag (no throw)', async () => {
    expect(await getBoolean('does-not-exist', true)).toBe(true);
    expect(await getString('does-not-exist', 'fallback')).toBe('fallback');
    expect(await getNumber('does-not-exist', 7)).toBe(7);
  });

  it('maps Fuze context (orgId) so constraints can target it', async () => {
    await setContext({ orgId: 'org-vip', userId: 'u1' });
    expect(await getBoolean('vip-feature', false)).toBe(true);

    await setContext({ orgId: 'org-other', userId: 'u2' });
    expect(await getBoolean('vip-feature', false)).toBe(false);
  });

  it('honors a per-call context override', async () => {
    await setContext({ orgId: 'org-other' });
    expect(await getBoolean('vip-feature', false, { orgId: 'org-vip' })).toBe(
      true,
    );
  });
});
