import { ErrorCode, type Provider, type ResolutionDetails } from '@openfeature/server-sdk';

/**
 * Graceful-degradation contract:
 *  (a) init() against an unreachable URL resolves within the bounded timeout
 *      and never throws/hangs.
 *  (b) every getX returns the caller's default when the provider errors or was
 *      never initialized, and nothing throws.
 */
describe('server graceful degradation', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('getX returns defaults when no provider was ever initialized', async () => {
    jest.isolateModules(() => {});
    const mod = await import('../src/server');
    await mod.close(); // ensure clean default (no-op) provider
    expect(await mod.getBoolean('flag', true)).toBe(true);
    expect(await mod.getBoolean('flag', false)).toBe(false);
    expect(await mod.getString('flag', 'd')).toBe('d');
    expect(await mod.getNumber('flag', 42)).toBe(42);
    await mod.close();
  });

  it('init() resolves within the bounded timeout when the provider import fails', async () => {
    jest.resetModules();
    // Simulate the Unleash provider package being unresolvable/throwing.
    jest.doMock(
      'unleash-openfeature-provider-server',
      () => {
        throw new Error('module not found / unreachable');
      },
      { virtual: true },
    );
    const mod = await import('../src/server');

    const start = Date.now();
    await expect(
      mod.init({
        url: 'http://127.0.0.1:1/api', // unreachable
        clientToken: 'x',
        readyTimeoutMs: 1000,
      }),
    ).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(3000);

    // After a failed init, evaluations still degrade to defaults.
    expect(await mod.getBoolean('flag', true)).toBe(true);
    expect(await mod.getString('flag', 'fb')).toBe('fb');
    await mod.close();
  });

  it('init() resolves within timeout when a provider hangs (never becomes ready)', async () => {
    jest.resetModules();
    // A provider whose initialize() never resolves.
    const hangingProvider: Provider = {
      metadata: { name: 'hanging' },
      runsOn: 'server',
      initialize: () => new Promise<void>(() => {}),
      resolveBooleanEvaluation: (_f, def): ResolutionDetails<boolean> => ({
        value: def,
        errorCode: ErrorCode.PROVIDER_NOT_READY,
        reason: 'ERROR',
      }),
      resolveStringEvaluation: (_f, def): ResolutionDetails<string> => ({
        value: def,
        reason: 'ERROR',
      }),
      resolveNumberEvaluation: (_f, def): ResolutionDetails<number> => ({
        value: def,
        reason: 'ERROR',
      }),
      resolveObjectEvaluation: (_f, def: any): ResolutionDetails<any> => ({
        value: def,
        reason: 'ERROR',
      }),
    };
    jest.doMock(
      'unleash-openfeature-provider-server',
      () => ({ UnleashProvider: function () { return hangingProvider; } }),
      { virtual: true },
    );
    const mod = await import('../src/server');

    const start = Date.now();
    await expect(
      mod.init({ url: 'http://x/api', clientToken: 't', readyTimeoutMs: 500 }),
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(2500);

    // Provider not ready -> defaults, no throw.
    expect(await mod.getBoolean('flag', true)).toBe(true);
    expect(await mod.getNumber('flag', 9)).toBe(9);
    await mod.close();
  });

  it('getX returns defaults when the provider errors on every resolution', async () => {
    jest.resetModules();
    const mod = await import('../src/server');
    const erroringProvider: Provider = {
      metadata: { name: 'erroring' },
      runsOn: 'server',
      resolveBooleanEvaluation: () => {
        throw new Error('boom');
      },
      resolveStringEvaluation: () => {
        throw new Error('boom');
      },
      resolveNumberEvaluation: () => {
        throw new Error('boom');
      },
      resolveObjectEvaluation: () => {
        throw new Error('boom');
      },
    };
    await mod.__setProviderForTesting(erroringProvider);

    expect(await mod.getBoolean('flag', false)).toBe(false);
    expect(await mod.getString('flag', 'safe')).toBe('safe');
    expect(await mod.getNumber('flag', -1)).toBe(-1);
    await mod.close();
  });
});
