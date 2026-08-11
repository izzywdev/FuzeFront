import { PgNamespaceRepository } from '../../src/repositories/namespace.repository';

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
    expect(capturedSql).toMatch(/INSERT INTO config_namespaces/);
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
