// boot.platform-org-config.test.ts - src/index.ts refuses to start (logger.fatal + process.exit(1)) when
// SELECTION_LIST_PLATFORM_ORG_ID is set to something the identity codec cannot decode, instead of starting with every
// platform feature silently disabled as if the org projection merely had not caught up.

const exitCalls: number[] = [];
const fatalCalls: Array<{ err?: { name?: string; message?: string } }> = [];

jest.mock('../src/db', () => ({ db: { destroy: async () => undefined, raw: async () => ({ rows: [] }) } }));
jest.mock('../src/db/migrate', () => ({ run: async () => [] }));
jest.mock('../src/seed', () => ({ initSeeding: async () => undefined }));
jest.mock('../src/seed/reconciler', () => ({ isReconcilerEnabled: () => false, startReconciler: () => ({}) }));
jest.mock('../src/app', () => ({ createApp: () => ({ listen: () => { throw new Error('the server must not start'); } }) }));
jest.mock('../src/events/consumer', () => ({ startLifecycleConsumers: async () => ({ disconnect: async () => undefined }) }));
jest.mock('../src/events/outboxPublisher', () => ({ startOutboxRelayFromEnv: async () => null }));
jest.mock('../src/lib/featureFlags', () => ({ initFeatureFlags: async () => undefined, closeFeatureFlags: async () => undefined }));
jest.mock('../src/lib/http', () => ({ installProcessHandlers: () => undefined }));
jest.mock('../src/lib/machineIdentity', () => ({ logMachineIdentityStatus: () => undefined }));
jest.mock('../src/lib/logger', () => {
  const log: any = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    fatal: (o: any) => fatalCalls.push(o),
    child: () => log,
  };
  return { logger: log, getLog: () => log };
});

describe('boot: SELECTION_LIST_PLATFORM_ORG_ID that the identity codec cannot decode is a FATAL config error', () => {
  const prev = { env: process.env.SELECTION_LIST_PLATFORM_ORG_ID, secret: process.env.JWT_SECRET };
  afterEach(() => {
    jest.restoreAllMocks();
    if (prev.env === undefined) delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    else process.env.SELECTION_LIST_PLATFORM_ORG_ID = prev.env;
    if (prev.secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev.secret;
    exitCalls.length = 0;
    fatalCalls.length = 0;
  });

  const boot = async (value: string, stopOnExit = true) => {
    process.env.JWT_SECRET = 'boot-test-secret';
    process.env.SELECTION_LIST_PLATFORM_ORG_ID = value;
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
      // stop main() where the real process would stop (only the first call: the catch-all calls exit again)
      if (stopOnExit && exitCalls.length === 1) throw new Error(`process.exit(${code})`);
    }) as never);
    await new Promise<void>((resolve) => {
      jest.isolateModules(() => {
        require('../src/index');
      });
      setTimeout(resolve, 150); // main() is async; let it reach its first exit
    });
  };

  it.each(['org_notatypeid', 'org_' + 'z'.repeat(26), 'org_0'])('%s -> logger.fatal(PlatformOrgConfigError) and exit(1); the server never starts', async (bad) => {
    await boot(bad);
    expect(exitCalls[0]).toBe(1);
    expect(fatalCalls[0].err?.name).toBe('PlatformOrgConfigError');
    expect(fatalCalls[0].err?.message).toMatch(/must be a valid org_… TypeID/);
  });

  it('a valid but not yet projected TypeID is NOT fatal (the documented asynchronous state): boot continues to the server start', async () => {
    await boot('org_01jpmf4z1yf88rpb9z9sd6pzg0', false);
    // it got past the platform-org check: the (mocked) server start is what throws, not a PlatformOrgConfigError
    expect(fatalCalls.some((f) => f.err?.name === 'PlatformOrgConfigError')).toBe(false);
  });
});
