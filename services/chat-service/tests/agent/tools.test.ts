// tools.test.ts — read-only RAG tool (search_docs) + the three mutating tools
// (create_org, invite_member, update_settings). Backend client + retriever mocked.

import { createSearchDocsTool } from '../../src/agent/tools/search-docs';
import { createCreateOrgTool } from '../../src/agent/tools/create-org';
import { createInviteMemberTool } from '../../src/agent/tools/invite-member';
import { createUpdateSettingsTool } from '../../src/agent/tools/update-settings';
import { buildToolRegistry } from '../../src/agent/tools';

function makeBackend() {
  return {
    createOrg: jest.fn().mockResolvedValue({ id: 'org-9' }),
    inviteMember: jest.fn().mockResolvedValue({ ok: true }),
    updateOrgSettings: jest.fn().mockResolvedValue({ ok: true }),
  };
}

describe('search_docs tool', () => {
  it('is read-only and Permit-mapped to docs:read', () => {
    const tool = createSearchDocsTool({ retrieve: jest.fn() } as any);
    expect(tool.name).toBe('search_docs');
    expect(tool.mutating).toBe(false);
    expect(tool.permit).toEqual({ resource: 'docs', action: 'read' });
  });

  it('retrieves chunks and returns them as RagSource citations', async () => {
    const retriever = {
      retrieve: jest.fn().mockResolvedValue([
        {
          text: 'FuzeFront uses Module Federation.',
          source: 'docs/readme.md',
          title: 'README',
          url: 'https://x/readme',
          distance: 0.1,
        },
      ]),
    };
    const tool = createSearchDocsTool(retriever as any);
    const result = await tool.execute({ query: 'what is fuzefront' }, { userId: 'u1', orgId: 'o1' });

    expect(retriever.retrieve).toHaveBeenCalledWith('what is fuzefront', { topK: 5 });
    expect(result.chunks).toHaveLength(1);
    expect(result.sources).toEqual([
      {
        title: 'README',
        url: 'https://x/readme',
        excerpt: 'FuzeFront uses Module Federation.',
      },
    ]);
  });

  it('truncates long excerpts in citations', async () => {
    const longText = 'x'.repeat(500);
    const retriever = {
      retrieve: jest.fn().mockResolvedValue([
        { text: longText, source: 's', title: 't', url: '', distance: 0 },
      ]),
    };
    const tool = createSearchDocsTool(retriever as any);
    const result = await tool.execute({ query: 'q' }, { userId: 'u1', orgId: 'o1' });
    expect(result.sources[0].excerpt.length).toBeLessThanOrEqual(300);
  });
});

describe('create_org tool', () => {
  it('is mutating and Permit-mapped to organization:create', () => {
    const tool = createCreateOrgTool(makeBackend() as any);
    expect(tool.name).toBe('create_org');
    expect(tool.mutating).toBe(true);
    expect(tool.permit).toEqual({ resource: 'organization', action: 'create' });
  });

  it('validates args and rejects an empty name', async () => {
    const tool = createCreateOrgTool(makeBackend() as any);
    await expect(
      tool.execute({ name: '', slug: 'x' } as any, { userId: 'u', orgId: 'o', token: 't' } as any),
    ).rejects.toThrow();
  });

  it('execute() calls the backend client with the bearer token and returns a summary', async () => {
    const backend = makeBackend();
    const tool = createCreateOrgTool(backend as any);
    const result = await tool.execute(
      { name: 'Acme', slug: 'acme', description: 'd' },
      { userId: 'u', orgId: 'o', token: 'jwt-1' } as any,
    );
    expect(backend.createOrg).toHaveBeenCalledWith('jwt-1', {
      name: 'Acme',
      slug: 'acme',
      description: 'd',
    });
    expect(result).toEqual({ success: true, summary: 'Created organization "Acme".' });
  });
});

describe('invite_member tool', () => {
  it('is mutating and Permit-mapped to organization:invite', () => {
    const tool = createInviteMemberTool(makeBackend() as any);
    expect(tool.name).toBe('invite_member');
    expect(tool.mutating).toBe(true);
    expect(tool.permit).toEqual({ resource: 'organization', action: 'invite' });
  });

  it('validates email', async () => {
    const tool = createInviteMemberTool(makeBackend() as any);
    await expect(
      tool.execute(
        { orgId: 'o', email: 'not-an-email', role: 'member' } as any,
        { userId: 'u', orgId: 'o', token: 't' } as any,
      ),
    ).rejects.toThrow();
  });

  it('execute() invites via the backend client', async () => {
    const backend = makeBackend();
    const tool = createInviteMemberTool(backend as any);
    const result = await tool.execute(
      { orgId: 'org-1', email: 'a@b.c', role: 'member' },
      { userId: 'u', orgId: 'o', token: 'jwt-1' } as any,
    );
    expect(backend.inviteMember).toHaveBeenCalledWith('jwt-1', {
      orgId: 'org-1',
      email: 'a@b.c',
      role: 'member',
    });
    expect(result.success).toBe(true);
  });
});

describe('update_settings tool', () => {
  it('is mutating and Permit-mapped to organization:update', () => {
    const tool = createUpdateSettingsTool(makeBackend() as any);
    expect(tool.name).toBe('update_settings');
    expect(tool.mutating).toBe(true);
    expect(tool.permit).toEqual({ resource: 'organization', action: 'update' });
  });

  it('rejects empty settings', async () => {
    const tool = createUpdateSettingsTool(makeBackend() as any);
    await expect(
      tool.execute(
        { orgId: 'org-1', settings: {} } as any,
        { userId: 'u', orgId: 'o', token: 't' } as any,
      ),
    ).rejects.toThrow();
  });

  it('execute() updates settings via the backend client', async () => {
    const backend = makeBackend();
    const tool = createUpdateSettingsTool(backend as any);
    const result = await tool.execute(
      { orgId: 'org-1', settings: { name: 'New' } },
      { userId: 'u', orgId: 'o', token: 'jwt-1' } as any,
    );
    expect(backend.updateOrgSettings).toHaveBeenCalledWith('jwt-1', {
      orgId: 'org-1',
      settings: { name: 'New' },
    });
    expect(result.success).toBe(true);
  });
});

describe('buildToolRegistry', () => {
  it('registers search_docs and exposes it by name', () => {
    const registry = buildToolRegistry({
      retriever: { retrieve: jest.fn() } as any,
      backend: makeBackend() as any,
    });
    expect(registry.get('search_docs')).toBeDefined();
    expect(registry.list().map((t) => t.name)).toContain('search_docs');
  });

  it('registers the three mutating tools with correct names', () => {
    const registry = buildToolRegistry({
      retriever: { retrieve: jest.fn() } as any,
      backend: makeBackend() as any,
    });
    expect(registry.get('create_org')?.mutating).toBe(true);
    expect(registry.get('invite_member')?.mutating).toBe(true);
    expect(registry.get('update_settings')?.mutating).toBe(true);
  });
});
