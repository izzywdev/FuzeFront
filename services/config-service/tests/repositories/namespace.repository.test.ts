import { PgNamespaceRepository } from '../../src/repositories/namespace.repository';
import { decodeCursor, encodeCursor } from '../../src/pagination';

function fakePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>) {
  return { query: jest.fn(queryImpl) } as any;
}

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('PgNamespaceRepository.upsert', () => {
  it('mints a fresh cns_ id and inserts a new namespace (xmax=0 -> inserted:true)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const pool = fakePool(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            namespace: params[1],
            display_name: params[2],
            description: params[3],
            owner_app_id: params[4],
            created_at: NOW,
            updated_at: NOW,
            inserted: true,
          },
        ],
      };
    });
    const repo = new PgNamespaceRepository(pool);

    const { namespace, created } = await repo.upsert({
      namespace: 'fuzefront.chat',
      displayName: 'Chat',
      description: 'Chat settings',
    });

    expect(created).toBe(true);
    expect(namespace.namespace).toBe('fuzefront.chat');
    expect(namespace.displayName).toBe('Chat');
    // Server-minted, wire-typed: cns_ prefix, never the raw uuid.
    expect(namespace.id).toMatch(/^cns_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(capturedSql).toMatch(/INSERT INTO config\.config_namespaces/);
    expect(capturedSql).toMatch(/ON CONFLICT \(namespace\) DO UPDATE/);
    // The create body never lets a caller choose the id — it is minted here,
    // not read off `input`.
    expect(capturedParams[0]).not.toBe('fuzefront.chat');
  });

  it('is idempotent on `namespace`: re-registering returns inserted:false', async () => {
    const pool = fakePool(async (_sql, params) => ({
      rows: [
        {
          id: '0195a8f2-6c3d-7f11-8b2e-000000000002', // an existing row's storage uuid, not the fresh mint
          namespace: params[1],
          display_name: params[2],
          description: params[3],
          owner_app_id: params[4],
          created_at: NOW,
          updated_at: NOW,
          inserted: false,
        },
      ],
    }));
    const repo = new PgNamespaceRepository(pool);

    const { created } = await repo.upsert({ namespace: 'fuzefront.chat', displayName: 'Chat v2' });

    expect(created).toBe(false);
  });
});

describe('PgNamespaceRepository.findByName / findById', () => {
  it('returns null when no row matches', async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const repo = new PgNamespaceRepository(pool);

    expect(await repo.findByName('fuzefront.nonexistent')).toBeNull();
  });

  it('maps a found row to the wire-typed Namespace shape', async () => {
    const pool = fakePool(async () => ({
      rows: [
        {
          id: '0195a8f2-6c3d-7f11-8b2e-000000000001',
          namespace: 'fuzefront.chat',
          display_name: 'Chat',
          description: null,
          owner_app_id: null,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    }));
    const repo = new PgNamespaceRepository(pool);

    const found = await repo.findByName('fuzefront.chat');
    expect(found).not.toBeNull();
    expect(found!.id).toMatch(/^cns_/);
    expect(found!.namespace).toBe('fuzefront.chat');
  });
});

/** A canonical, fromUuid()-parseable UUID for test fixtures. */
function uuidFor(n: number): string {
  return `0195a8f2-6c3d-7f11-8b2e-${String(n).padStart(12, '0')}`;
}

function makeNamespaceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '0195a8f2-6c3d-7f11-8b2e-000000000001',
    namespace: 'fuzefront.chat',
    display_name: 'Chat',
    description: null,
    owner_app_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('PgNamespaceRepository.listPage — FFRNT-157', () => {
  it('orders by created_at DESC, id DESC and requests limit+1 rows', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgNamespaceRepository(fakePool(query));

    await repo.listPage({ limit: 10 });

    expect(capturedSql).toMatch(/ORDER BY created_at DESC, id DESC/);
    expect(capturedParams[capturedParams.length - 1]).toBe(11);
  });

  it('reports hasNextPage:false and nextCursor:null on the last page', async () => {
    const rows = [makeNamespaceRow({ id: uuidFor(1), namespace: 'a' })];
    const query = jest.fn(async () => ({ rows }));
    const repo = new PgNamespaceRepository(fakePool(query));

    const page = await repo.listPage({ limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it('reports hasNextPage:true, trims the extra row, and encodes a (createdAt, id) cursor', async () => {
    const rows = [
      makeNamespaceRow({ id: uuidFor(1), namespace: 'ns-1', created_at: new Date('2026-01-03T00:00:00.000Z') }),
      makeNamespaceRow({ id: uuidFor(2), namespace: 'ns-2', created_at: new Date('2026-01-02T00:00:00.000Z') }),
    ];
    const query = jest.fn(async () => ({ rows }));
    const repo = new PgNamespaceRepository(fakePool(query));

    const page = await repo.listPage({ limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].namespace).toBe('ns-1');
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(decodeCursor(page.pageInfo.nextCursor!)).toEqual({
      createdAt: '2026-01-03T00:00:00.000Z',
      id: uuidFor(1),
    });
  });

  it('decodes a supplied cursor into a keyset predicate on (created_at, id)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgNamespaceRepository(fakePool(query));
    const cursor = encodeCursor({ createdAt: '2026-01-01T00:00:00.000Z', id: uuidFor(9) });

    await repo.listPage({ limit: 10, cursor });

    expect(capturedSql).toMatch(/WHERE \(created_at, id\) < \(\$1::timestamptz, \$2::uuid\)/);
    expect(capturedParams[0]).toBe('2026-01-01T00:00:00.000Z');
    expect(capturedParams[1]).toBe(uuidFor(9));
  });

  it('ignores a malformed cursor rather than erroring — degrades to page 1', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const repo = new PgNamespaceRepository(fakePool(query));

    await expect(repo.listPage({ limit: 10, cursor: 'not-a-real-cursor' })).resolves.toEqual({
      items: [],
      pageInfo: { hasNextPage: false, nextCursor: null },
    });
  });

  it('walks a full set across pages with no gaps or duplicates under a stable ordering', async () => {
    const allRows = Array.from({ length: 23 }, (_, i) =>
      makeNamespaceRow({
        id: uuidFor(22 - i),
        namespace: `ns-${String(22 - i).padStart(2, '0')}`,
        created_at: new Date(2026, 0, 1, 0, 0, 22 - i), // newest (highest i) first, DESC order
      }),
    );
    const sorted = [...allRows].sort(
      (a, b) => (b.created_at as Date).getTime() - (a.created_at as Date).getTime() || (b.id > a.id ? 1 : -1),
    );

    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      const limitPlus1 = params[params.length - 1] as number;
      const hasCursor = params.length > 1;
      let startIndex = 0;
      if (hasCursor) {
        const cursorCreatedAt = (params[0] as string);
        const cursorId = params[1] as string;
        startIndex = sorted.findIndex(
          (r) => (r.created_at as Date).toISOString() === cursorCreatedAt && r.id === cursorId,
        ) + 1;
      }
      return { rows: sorted.slice(startIndex, startIndex + limitPlus1) };
    });
    const repo = new PgNamespaceRepository(fakePool(query));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await repo.listPage({ limit: 6, cursor });
      seen.push(...page.items.map((it) => it.namespace));
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.nextCursor!;
    }

    expect(seen).toEqual(sorted.map((r) => r.namespace));
    expect(new Set(seen).size).toBe(seen.length);
  });
});
