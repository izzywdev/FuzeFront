import {
  PgKeyDefinitionRepository,
  UnsatisfiableDefaultValueError,
} from '../../src/repositories/key-definition.repository';
import { KeyDefinitionEntityId, NamespaceEntityId } from '../../src/types';
import { decodeCursor, encodeCursor } from '../../src/pagination';

function fakePool(queryImpl?: jest.Mock) {
  return { query: queryImpl ?? jest.fn() } as any;
}

const NAMESPACE_ID = 'cns_01h455vb4pex5vsknk084sn02q' as NamespaceEntityId;
const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('PgKeyDefinitionRepository.create — S2 AC4: unsatisfiable defaults never enter the catalog', () => {
  it('rejects BEFORE any query when defaultValue fails the key\'s own schema, and mints no id', async () => {
    const query = jest.fn();
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    await expect(
      repo.create(NAMESPACE_ID, {
        key: 'ui.theme.mode',
        displayName: 'Theme mode',
        valueType: 'enum',
        enumValues: ['light', 'dark'],
        defaultValue: 'purple', // not in enumValues
        allowedScopes: ['user'],
      }),
    ).rejects.toThrow(UnsatisfiableDefaultValueError);

    expect(query).not.toHaveBeenCalled();
  });

  it('inserts and mints a ckd_ id when the default is self-consistent', async () => {
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            namespace_id: params[1],
            key: params[2],
            display_name: params[3],
            description: params[4],
            help_url: params[5],
            category: params[6],
            sort_order: params[7],
            tags: [],
            value_type: params[9],
            schema: null,
            enum_values: JSON.parse(params[11] as string),
            default_value: JSON.parse(params[12] as string),
            allowed_scopes: params[13],
            is_system: params[14],
            is_hidden: params[15],
            is_secret: params[16],
            is_readonly: params[17],
            precedence: params[18],
            requires_restart: params[19],
            deprecated_at: null,
            replaced_by: params[20],
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    const created = await repo.create(NAMESPACE_ID, {
      key: 'ui.theme.mode',
      displayName: 'Theme mode',
      valueType: 'enum',
      enumValues: ['light', 'dark'],
      defaultValue: 'light',
      allowedScopes: ['user', 'org'],
    });

    expect(created.id).toMatch(/^ckd_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(created.key).toBe('ui.theme.mode');
    expect(created.defaultValue).toBe('light');
    // No id was accepted from the caller — capturedParams[0] is the
    // service-minted uuid, never something the input carried (KeyDefinitionInput
    // has no `id` field at all, enforced at the type level).
    expect(capturedParams[0]).toBeDefined();
  });
});

describe('PgKeyDefinitionRepository.update — FFRNT-158 manifest reconciliation', () => {
  const DEFINITION_ID = 'ckd_01h455vb4pex5vsknk084sn02q' as KeyDefinitionEntityId;

  it('rejects BEFORE any query when the new defaultValue fails its own (possibly new) schema', async () => {
    const query = jest.fn();
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    await expect(
      repo.update(DEFINITION_ID, {
        key: 'ui.theme.mode',
        displayName: 'Theme mode',
        valueType: 'enum',
        enumValues: ['light', 'dark'],
        defaultValue: 'purple',
        allowedScopes: ['user'],
      }),
    ).rejects.toThrow(UnsatisfiableDefaultValueError);

    expect(query).not.toHaveBeenCalled();
  });

  it('overwrites metadata and clears deprecated_at (a re-registered key is revived)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            namespace_id: '11111111-1111-7111-8111-111111111111',
            key: 'ui.theme.mode',
            display_name: params[1],
            description: params[2],
            help_url: params[3],
            category: params[4],
            sort_order: params[5],
            tags: JSON.parse(params[6] as string),
            value_type: params[7],
            schema: null,
            enum_values: JSON.parse(params[9] as string),
            default_value: JSON.parse(params[10] as string),
            allowed_scopes: params[11],
            is_system: params[12],
            is_hidden: params[13],
            is_secret: params[14],
            is_readonly: params[15],
            precedence: params[16],
            requires_restart: params[17],
            deprecated_at: null,
            replaced_by: params[18],
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    const updated = await repo.update(DEFINITION_ID, {
      key: 'ui.theme.mode',
      displayName: 'New label',
      valueType: 'enum',
      enumValues: ['light', 'dark'],
      defaultValue: 'light',
      allowedScopes: ['user', 'org'],
    });

    expect(capturedSql).toMatch(/UPDATE config\.config_key_definitions SET/);
    expect(capturedSql).toMatch(/deprecated_at = NULL/);
    expect(capturedSql).toMatch(/WHERE id = \$1/);
    expect(capturedParams[0]).toBeDefined(); // toUuid(DEFINITION_ID) — the native storage form, not the TypeID itself
    expect(updated.id).toBe(DEFINITION_ID);
    expect(updated.displayName).toBe('New label');
    expect(updated.deprecatedAt).toBeNull();
  });
});

describe('PgKeyDefinitionRepository.deprecate', () => {
  it('is a no-op (no query) for an empty id list', async () => {
    const query = jest.fn();
    const repo = new PgKeyDefinitionRepository(fakePool(query));
    await repo.deprecate([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('sets deprecated_at only for ids not already deprecated', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    const idA = 'ckd_01kzrds7mce5e96zrm3hgx80gg' as KeyDefinitionEntityId;
    const idB = 'ckd_01kzrds7mdfwsscregja4h3qjq' as KeyDefinitionEntityId;
    await repo.deprecate([idA, idB]);

    expect(capturedSql).toMatch(/UPDATE config\.config_key_definitions SET deprecated_at = now\(\)/);
    expect(capturedSql).toMatch(/AND deprecated_at IS NULL/);
    expect((capturedParams[0] as string[])).toHaveLength(2);
  });
});

function makeKeyDefRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '0195a8f2-6c3d-7f11-8b2e-000000000001',
    namespace_id: '0195a8f2-6c3d-7f11-8b2e-000000000099',
    key: 'a.key',
    display_name: 'A key',
    description: null,
    help_url: null,
    category: null,
    sort_order: 0,
    tags: [],
    value_type: 'string',
    schema: null,
    enum_values: null,
    default_value: 'x',
    allowed_scopes: ['user'],
    is_system: false,
    is_hidden: false,
    is_secret: false,
    is_readonly: false,
    precedence: 'most-specific-wins',
    requires_restart: false,
    deprecated_at: null,
    replaced_by: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('PgKeyDefinitionRepository.listPage — FFRNT-157 catalog listing', () => {
  it('excludes is_hidden rows by default (server-side omission, per gate-pagination + S5 AC3)', async () => {
    let capturedSql = '';
    const query = jest.fn(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    await repo.listPage(NAMESPACE_ID, { limit: 50, includeHidden: false });

    expect(capturedSql).toMatch(/is_hidden = false/);
  });

  it('omits the is_hidden filter when includeHidden is true', async () => {
    let capturedSql = '';
    const query = jest.fn(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    await repo.listPage(NAMESPACE_ID, { limit: 50, includeHidden: true });

    expect(capturedSql).not.toMatch(/is_hidden = false/);
  });

  it('filters by category and free-text search when supplied', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    await repo.listPage(NAMESPACE_ID, {
      limit: 50,
      includeHidden: false,
      category: 'appearance',
      search: 'theme',
    });

    expect(capturedSql).toMatch(/category = \$\d+/);
    expect(capturedSql).toMatch(/display_name ILIKE .* OR description ILIKE/);
    expect(capturedParams).toContain('appearance');
    expect(capturedParams).toContain('%theme%');
  });

  it('requests limit+1 rows and orders by key ASC (a unique, stable total order)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    await repo.listPage(NAMESPACE_ID, { limit: 20, includeHidden: false });

    expect(capturedSql).toMatch(/ORDER BY key ASC/);
    expect(capturedParams[capturedParams.length - 1]).toBe(21);
  });

  it('reports hasNextPage:false and nextCursor:null on the last page', async () => {
    const rows = [makeKeyDefRow({ key: 'a' }), makeKeyDefRow({ key: 'b' })];
    const query = jest.fn(async () => ({ rows }));
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    const page = await repo.listPage(NAMESPACE_ID, { limit: 20, includeHidden: false });

    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it('reports hasNextPage:true and a usable nextCursor when there is a further page', async () => {
    // limit+1 rows returned -> a further page exists; the extra row is trimmed.
    const rows = [makeKeyDefRow({ key: 'a' }), makeKeyDefRow({ key: 'b' }), makeKeyDefRow({ key: 'c' })];
    const query = jest.fn(async () => ({ rows }));
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    const page = await repo.listPage(NAMESPACE_ID, { limit: 2, includeHidden: false });

    expect(page.items).toHaveLength(2);
    expect(page.items.map((i) => i.key)).toEqual(['a', 'b']);
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(decodeCursor(page.pageInfo.nextCursor!)).toEqual({ key: 'b' });
  });

  it('decodes a supplied cursor into a `key > $n` keyset predicate', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));
    const cursor = encodeCursor({ key: 'b' });

    await repo.listPage(NAMESPACE_ID, { limit: 20, includeHidden: false, cursor });

    expect(capturedSql).toMatch(/key > \$\d+/);
    expect(capturedParams).toContain('b');
  });

  it('walks a full catalog across pages with no gaps or duplicates', async () => {
    // In-memory simulation of the SQL the repository issues, so the
    // walk-the-full-set assertion is exercised without a live Postgres.
    const allRows = Array.from({ length: 25 }, (_, i) => makeKeyDefRow({ key: `key.${String(i).padStart(2, '0')}` }));
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      // The last two bind params are always [cursorKey?, limitPlus1] OR just [limitPlus1].
      const limitPlus1 = params[params.length - 1] as number;
      const cursorKey = params.length > 2 ? (params[params.length - 2] as string) : undefined;
      const startIndex = cursorKey ? allRows.findIndex((r) => r.key > cursorKey) : 0;
      return { rows: allRows.slice(startIndex, startIndex + limitPlus1) };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await repo.listPage(NAMESPACE_ID, { limit: 7, includeHidden: false, cursor });
      seen.push(...page.items.map((it) => it.key));
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.nextCursor!;
    }

    expect(seen).toEqual(allRows.map((r) => r.key));
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
  });
});
