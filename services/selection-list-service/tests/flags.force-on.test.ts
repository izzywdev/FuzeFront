/**
 * FLAGS_FORCE_ON escape hatch — the fix for the integration/acceptance suite
 * being unpassable in CI.
 *
 * Every route is gated behind `isSelectionListsEnabled()`, a release flag that
 * defaults OFF and whose only source of truth is Unleash. CI has no Unleash,
 * so the client degrades to the default and every route answers 404 "Service
 * not enabled." — correct behaviour that made 134 of 148 integration tests
 * fail against a service working exactly as designed.
 *
 * The hatch mirrors backend/src/routes/flags.ts, including its hard gate to
 * non-production. That gate is the security-relevant half: it is what stops a
 * stray env var lighting up a dark feature in prod, so it is tested as
 * carefully as the happy path.
 */
const FLAG_KEY = 'fuzefront.selection-lists.service';

describe('FLAGS_FORCE_ON', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.FLAGS_FORCE_ON;
    delete process.env.NODE_ENV;
  });
  afterAll(() => {
    process.env = ORIGINAL;
  });

  async function isEnabled(): Promise<boolean> {
    // Re-require after each env change: the helper reads process.env at call
    // time, but resetModules keeps the flag-client singleton from leaking.
    const mod = await import('../src/flags');
    mod.setFlagClient(null);
    return mod.isSelectionListsEnabled({ organizationId: 'org-1', userId: 'u-1' });
  }

  it('is OFF by default with no Unleash — the behaviour that broke CI', async () => {
    await expect(isEnabled()).resolves.toBe(false);
  });

  it('forces the flag ON when the key is listed', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FLAGS_FORCE_ON = FLAG_KEY;
    await expect(isEnabled()).resolves.toBe(true);
  });

  it('accepts the key among a comma-separated list, with whitespace', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FLAGS_FORCE_ON = ` some.other.flag , ${FLAG_KEY} ,x.y `;
    await expect(isEnabled()).resolves.toBe(true);
  });

  it('ignores flags it was not given', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FLAGS_FORCE_ON = 'some.other.flag';
    await expect(isEnabled()).resolves.toBe(false);
  });

  it('REFUSES to force anything when NODE_ENV=production', async () => {
    // The security property. A stray env var must never light up a dark
    // feature in prod; prod targeting is done in Unleash, never by env.
    process.env.NODE_ENV = 'production';
    process.env.FLAGS_FORCE_ON = FLAG_KEY;
    await expect(isEnabled()).resolves.toBe(false);
  });
});
