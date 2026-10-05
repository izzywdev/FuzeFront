// offline-provider.test.ts — the ONE explicit offline OpenFeature provider that
// replaces the per-service FLAGS_FORCE_ON escape hatches.
//
// What this pins (the whole contract of the provider + its env mapping):
//   - ON:     a listed key resolves true
//   - absent: an unlisted key resolves the CALLER's default (never forced)
//   - prod:   NODE_ENV=production is refused (throws FlagsConfigError) and the
//             evaluation stays at the in-code default — a stray env var can
//             never light up a dark feature in production
//   - Unleash wins: offline requested WITH Unleash configured => offline is
//             ignored (logged), Unleash is used
//   - optionsFromEnv(): FUZE_FLAGS_PROVIDER / FUZE_FLAGS_OFFLINE_ON parsing,
//             with whitespace and commas

import { OpenFeature } from '@openfeature/server-sdk';
import {
  init,
  getBoolean,
  close,
  optionsFromEnv,
  FlagsConfigError,
} from '../src/server';

const ON_KEY = 'fuzefront.selection-lists.service';
const OTHER_KEY = 'fuzefront.some.other-flag';

describe('offline provider', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(async () => {
    await close();
    // The OpenFeature provider is a process-wide singleton; close() does not
    // restore the no-op default, so reset it between tests. Otherwise a provider
    // installed by one test leaks into the next (e.g. the production-refusal
    // test, which installs nothing and must see only the in-code defaults).
    await OpenFeature.clearProviders();
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    jest.restoreAllMocks();
  });

  it('resolves a listed key to true (ON)', async () => {
    process.env.NODE_ENV = 'test';
    await init({ provider: 'offline', offline: { on: [ON_KEY] } });
    await expect(getBoolean(ON_KEY, false)).resolves.toBe(true);
  });

  it('resolves an unlisted key to the caller default (never forced on)', async () => {
    process.env.NODE_ENV = 'test';
    await init({ provider: 'offline', offline: { on: [ON_KEY] } });
    // caller default OFF stays OFF
    await expect(getBoolean(OTHER_KEY, false)).resolves.toBe(false);
    // caller default ON (e.g. a kill-switch) stays ON
    await expect(getBoolean(OTHER_KEY, true)).resolves.toBe(true);
  });

  it('refuses in production and leaves evaluation at the in-code default', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      init({ provider: 'offline', offline: { on: [ON_KEY] } }),
    ).rejects.toBeInstanceOf(FlagsConfigError);
    // No provider installed -> the listed key is NOT forced on; default wins.
    await expect(getBoolean(ON_KEY, false)).resolves.toBe(false);
  });

  it('is ignored (with a logged error) when Unleash is configured — Unleash wins', async () => {
    process.env.NODE_ENV = 'test';
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // url set alongside offline: offline must be ignored. No real Unleash is
    // reachable, so the Unleash provider degrades and the key resolves to the
    // caller default (NOT forced true by an offline provider that never ran).
    await init({
      provider: 'offline',
      offline: { on: [ON_KEY] },
      url: 'http://unleash.invalid:4242/api',
      clientToken: 'not-a-real-token',
      readyTimeoutMs: 50,
    });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/offline.*ignored/i);
    await expect(getBoolean(ON_KEY, false)).resolves.toBe(false);
  });
});

describe('optionsFromEnv()', () => {
  it('maps FUZE_FLAGS_PROVIDER=offline and trims a whitespaced, comma-separated ON list', () => {
    const opts = optionsFromEnv({
      FUZE_FLAGS_PROVIDER: 'offline',
      FUZE_FLAGS_OFFLINE_ON: `  ${ON_KEY} , , ${OTHER_KEY}  ,`,
    } as NodeJS.ProcessEnv);
    expect(opts.provider).toBe('offline');
    expect(opts.offline?.on).toEqual([ON_KEY, OTHER_KEY]);
  });

  it('leaves provider undefined and ON list empty when nothing is set', () => {
    const opts = optionsFromEnv({} as NodeJS.ProcessEnv);
    expect(opts.provider).toBeUndefined();
    expect(opts.offline?.on).toEqual([]);
  });

  it('passes Unleash url/token through from the standard env vars', () => {
    const opts = optionsFromEnv({
      UNLEASH_URL: 'http://unleash.test:4242/api',
      UNLEASH_CLIENT_TOKEN: 'client-token',
    } as NodeJS.ProcessEnv);
    expect(opts.url).toBe('http://unleash.test:4242/api');
    expect(opts.clientToken).toBe('client-token');
    expect(opts.provider).toBeUndefined();
  });
});
