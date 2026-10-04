/**
 * fuzefront.selection-lists.seed-defaults — release flag, default OFF, server-only.
 *
 * Gates BOTH seeding consumers (org-created + seed-requested). This suite pins
 * the helper `isSeedDefaultsEnabled`: default OFF, both states, the exact flag
 * key + in-code default + evaluation context, independence from the master
 * gate, and fail-closed on every failure mode. The consumers themselves are a
 * later wave; they must call this helper per message.
 */
const SEED_KEY = 'fuzefront.selection-lists.seed-defaults';
const MASTER_KEY = 'fuzefront.selection-lists.service';

describe('isSeedDefaultsEnabled (fuzefront.selection-lists.seed-defaults)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.FLAGS_FORCE_ON;
    delete process.env.NODE_ENV;
  });
  afterAll(() => {
    process.env = ORIGINAL;
  });

  async function load() {
    const mod = await import('../src/flags');
    mod.setFlagClient(null);
    return mod;
  }

  it('declares the exact key', async () => {
    const { FLAGS } = await load();
    expect(FLAGS.SELECTION_LISTS_SEED_DEFAULTS).toBe(SEED_KEY);
  });

  it('is OFF by default when no flag client is available (release default OFF)', async () => {
    const { isSeedDefaultsEnabled } = await load();
    await expect(isSeedDefaultsEnabled({ organizationId: 'org-1' })).resolves.toBe(false);
  });

  it('asks the client with an in-code default of false and the org-targeted context', async () => {
    const { isSeedDefaultsEnabled, setFlagClient } = await load();
    const getBooleanValue = jest.fn().mockResolvedValue(false);
    setFlagClient({ getBooleanValue });
    await isSeedDefaultsEnabled({ organizationId: 'org-1' });
    expect(getBooleanValue).toHaveBeenCalledWith(
      SEED_KEY,
      false,
      expect.objectContaining({ orgId: 'org-1', app: 'selection-list-service' })
    );
  });

  it('flag OFF path: provider says false => false', async () => {
    const { isSeedDefaultsEnabled, setFlagClient } = await load();
    setFlagClient({ getBooleanValue: async () => false });
    await expect(isSeedDefaultsEnabled({ organizationId: 'org-1' })).resolves.toBe(false);
  });

  it('flag ON path: provider says true => true', async () => {
    const { isSeedDefaultsEnabled, setFlagClient } = await load();
    setFlagClient({ getBooleanValue: async () => true });
    await expect(isSeedDefaultsEnabled({ organizationId: 'org-1' })).resolves.toBe(true);
  });

  it('is per-org: ON for one org, OFF for another', async () => {
    const { isSeedDefaultsEnabled, setFlagClient } = await load();
    setFlagClient({
      getBooleanValue: async (_k, _d, ctx) => ctx?.orgId === 'org-on',
    });
    await expect(isSeedDefaultsEnabled({ organizationId: 'org-on' })).resolves.toBe(true);
    await expect(isSeedDefaultsEnabled({ organizationId: 'org-off' })).resolves.toBe(false);
  });

  it('is independent of the master gate (evaluates only its own key)', async () => {
    const { isSeedDefaultsEnabled, isSelectionListsEnabled, setFlagClient } = await load();
    const getBooleanValue = jest.fn(async (key: string) => key === MASTER_KEY);
    setFlagClient({ getBooleanValue });
    await expect(isSelectionListsEnabled({ organizationId: 'o' })).resolves.toBe(true);
    await expect(isSeedDefaultsEnabled({ organizationId: 'o' })).resolves.toBe(false);
  });

  it('fails closed when the flag service throws', async () => {
    const { isSeedDefaultsEnabled, setFlagClient } = await load();
    setFlagClient({
      getBooleanValue: async () => {
        throw new Error('unleash unreachable');
      },
    });
    await expect(isSeedDefaultsEnabled({ organizationId: 'org-1' })).resolves.toBe(false);
  });

  it('fails closed when the flag service rejects', async () => {
    const { isSeedDefaultsEnabled, setFlagClient } = await load();
    setFlagClient({ getBooleanValue: () => Promise.reject(new Error('timeout')) });
    await expect(isSeedDefaultsEnabled({ organizationId: 'org-1' })).resolves.toBe(false);
  });

  it('FLAGS_FORCE_ON hatch works for the new key outside production only', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FLAGS_FORCE_ON = SEED_KEY;
    let mod = await load();
    await expect(mod.isSeedDefaultsEnabled({ organizationId: 'o' })).resolves.toBe(true);

    jest.resetModules();
    process.env.NODE_ENV = 'production';
    mod = await load();
    await expect(mod.isSeedDefaultsEnabled({ organizationId: 'o' })).resolves.toBe(false);
  });

  it('forcing only the master gate does not turn seeding on', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FLAGS_FORCE_ON = MASTER_KEY;
    const { isSeedDefaultsEnabled } = await load();
    await expect(isSeedDefaultsEnabled({ organizationId: 'o' })).resolves.toBe(false);
  });
});
