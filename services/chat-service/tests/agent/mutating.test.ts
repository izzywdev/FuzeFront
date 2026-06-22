// mutating.test.ts — whitelisted mutating tools (create_org, update_settings).
// They declare mutating:true + a Permit mapping, validate args, and call the
// PlatformClient with the forwarded token. The LLM/backend are mocked.

import {
  createCreateOrgTool,
  createUpdateSettingsTool,
  slugify,
  buildMutatingTools,
  type MutatingToolContext,
} from '../../src/agent/tools/mutating';

const ctx: MutatingToolContext = { userId: 'u1', orgId: 'org-1', token: 'tok-abc' };

describe('slugify', () => {
  it('lowercases, hyphenates, and trims', () => {
    expect(slugify('  Acme Corp!! ')).toBe('acme-corp');
    expect(slugify('Hello   World')).toBe('hello-world');
  });
});

describe('create_org tool', () => {
  it('is mutating and maps to organization:create', () => {
    const tool = createCreateOrgTool({ createOrganization: jest.fn() });
    expect(tool.mutating).toBe(true);
    expect(tool.permit).toEqual({ resource: 'organization', action: 'create' });
  });

  it('calls createOrganization with a derived slug and the token', async () => {
    const createOrganization = jest.fn().mockResolvedValue({ id: 'org-9', name: 'Acme' });
    const tool = createCreateOrgTool({ createOrganization });
    const out = await tool.execute({ name: 'Acme' }, ctx);
    expect(createOrganization).toHaveBeenCalledWith({ name: 'Acme', slug: 'acme' }, 'tok-abc');
    expect(out).toEqual({ id: 'org-9', name: 'Acme' });
  });

  it('rejects an empty name', async () => {
    const tool = createCreateOrgTool({ createOrganization: jest.fn() });
    await expect(tool.execute({ name: '   ' }, ctx)).rejects.toThrow(/name/);
  });
});

describe('update_settings tool', () => {
  it('is mutating and maps to organization:update', () => {
    const tool = createUpdateSettingsTool({ updateOrganizationSettings: jest.fn() });
    expect(tool.mutating).toBe(true);
    expect(tool.permit).toEqual({ resource: 'organization', action: 'update' });
  });

  it('updates the caller current org with the patch', async () => {
    const updateOrganizationSettings = jest.fn().mockResolvedValue({ id: 'org-1' });
    const tool = createUpdateSettingsTool({ updateOrganizationSettings });
    await tool.execute({ settings: { name: 'New' } }, ctx);
    expect(updateOrganizationSettings).toHaveBeenCalledWith(
      { orgId: 'org-1', patch: { name: 'New' } },
      'tok-abc',
    );
  });

  it('rejects a missing settings object', async () => {
    const tool = createUpdateSettingsTool({ updateOrganizationSettings: jest.fn() });
    await expect(tool.execute({ settings: undefined as any }, ctx)).rejects.toThrow(/settings/);
  });
});

describe('buildMutatingTools', () => {
  it('returns the whitelisted mutating tools', () => {
    const tools = buildMutatingTools({} as any);
    expect(tools.map((t) => t.name).sort()).toEqual(['create_org', 'update_settings']);
    expect(tools.every((t) => t.mutating)).toBe(true);
  });
});
