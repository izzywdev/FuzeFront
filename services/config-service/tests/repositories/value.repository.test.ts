import { configureIdentity, mintId } from '@izzywdev/fuzefront-identity';
import {
  InvalidScopeReferenceError,
  PgValueRepository,
  ScopeNotAllowedError,
} from '../../src/repositories/value.repository';
import { KeyDefinitionEntityId, Scope } from '../../src/types';

// governance/identifier-standard.md §8: portal/organization/user ids are not
// yet family-wide backfilled to the prefixed form, so config-service widens
// assertRef() to accept legacy bare UUIDs for them (mirrors src/index.ts's
// bootstrap call). Configured here so repository tests exercise the SAME
// acceptance behaviour production will see.
beforeAll(() => {
  configureIdentity({ legacyUuidTypes: new Set(['portal', 'organization', 'user']) });
});

function fakePool(queryImpl?: jest.Mock) {
  return { query: queryImpl ?? jest.fn() } as any;
}

const NOW = new Date('2026-01-01T00:00:00.000Z');
const DEFINITION_ID = mintId('keyDefinition') as KeyDefinitionEntityId;
const LEGACY_ORG_UUID = '11111111-1111-7111-8111-111111111111';
const PREFIXED_USER_ID = mintId('user');

describe('PgValueRepository.setValue — allowedScopes refusal (S3 AC3)', () => {
  it('refuses BEFORE writing when the target scope is excluded from allowedScopes', async () => {
    const query = jest.fn();
    const repo = new PgValueRepository(fakePool(query));

    await expect(
      repo.setValue({
        definitionId: DEFINITION_ID,
        allowedScopes: ['platform', 'org'], // no 'user'
        scope: { scopeType: 'user', scopeId: PREFIXED_USER_ID },
        value: 'x',
      }),
    ).rejects.toThrow(ScopeNotAllowedError);

    expect(query).not.toHaveBeenCalled();
  });
});

describe('PgValueRepository.setValue — invalid scope reference (S3 AC4)', () => {
  it('refuses BEFORE writing when scope_id is not a valid reference of its declared type', async () => {
    const query = jest.fn();
    const repo = new PgValueRepository(fakePool(query));

    await expect(
      repo.setValue({
        definitionId: DEFINITION_ID,
        allowedScopes: ['org'],
        scope: { scopeType: 'org', scopeId: 'not-a-uuid-or-typeid' },
        value: 'x',
      }),
    ).rejects.toThrow(InvalidScopeReferenceError);

    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a scope_id belonging to the WRONG entity type (type confusion) — a usr_ id for an org scope", async () => {
    const query = jest.fn();
    const repo = new PgValueRepository(fakePool(query));

    await expect(
      repo.setValue({
        definitionId: DEFINITION_ID,
        allowedScopes: ['org'],
        scope: { scopeType: 'org', scopeId: PREFIXED_USER_ID }, // usr_… where org_… is expected
        value: 'x',
      }),
    ).rejects.toThrow(InvalidScopeReferenceError);
  });

  it('refuses `platform` with a non-null scopeId (platform is a singleton)', async () => {
    const query = jest.fn();
    const repo = new PgValueRepository(fakePool(query));

    await expect(
      repo.setValue({
        definitionId: DEFINITION_ID,
        allowedScopes: ['platform'],
        scope: { scopeType: 'platform', scopeId: 'anything' },
        value: 'x',
      }),
    ).rejects.toThrow(InvalidScopeReferenceError);
  });

  it('refuses a non-platform scope with a null scopeId', async () => {
    const query = jest.fn();
    const repo = new PgValueRepository(fakePool(query));

    await expect(
      repo.setValue({
        definitionId: DEFINITION_ID,
        allowedScopes: ['org'],
        scope: { scopeType: 'org', scopeId: null },
        value: 'x',
      }),
    ).rejects.toThrow(InvalidScopeReferenceError);
  });

  it('accepts a LEGACY bare UUID for org (widened at bootstrap — most real org ids are still bare UUIDs today)', async () => {
    const query = jest.fn(async (_sql: string, params: unknown[]) => ({
      rows: [
        {
          id: 'row-1',
          definition_id: params[0],
          scope_type: params[1],
          scope_id: params[2],
          value: JSON.parse(params[3] as string),
          is_locked: params[4],
          lock_reason: params[5],
          set_by_user_id: params[6],
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    }));
    const repo = new PgValueRepository(fakePool(query));

    const result = await repo.setValue({
      definitionId: DEFINITION_ID,
      allowedScopes: ['org'],
      scope: { scopeType: 'org', scopeId: LEGACY_ORG_UUID },
      value: 'x',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.scopeId).toMatch(/^org_/); // rendered back to wire form
  });
});

describe('PgValueRepository.setValue — conflict target selection', () => {
  it("targets the platform singleton partial index when scopeType is 'platform'", async () => {
    let capturedSql = '';
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      return {
        rows: [
          {
            id: 'row-1',
            definition_id: params[0],
            scope_type: params[1],
            scope_id: params[2],
            value: JSON.parse(params[3] as string),
            is_locked: params[4],
            lock_reason: params[5],
            set_by_user_id: params[6],
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      };
    });
    const repo = new PgValueRepository(fakePool(query));

    await repo.setValue({
      definitionId: DEFINITION_ID,
      allowedScopes: ['platform'],
      scope: { scopeType: 'platform', scopeId: null },
      value: 'x',
    });

    expect(capturedSql).toMatch(/ON CONFLICT \(definition_id\) WHERE scope_type = 'platform'/);
  });

  it('targets the scoped partial index for non-platform tiers', async () => {
    let capturedSql = '';
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      return {
        rows: [
          {
            id: 'row-1',
            definition_id: params[0],
            scope_type: params[1],
            scope_id: params[2],
            value: JSON.parse(params[3] as string),
            is_locked: params[4],
            lock_reason: params[5],
            set_by_user_id: params[6],
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      };
    });
    const repo = new PgValueRepository(fakePool(query));

    await repo.setValue({
      definitionId: DEFINITION_ID,
      allowedScopes: ['user'],
      scope: { scopeType: 'user', scopeId: PREFIXED_USER_ID },
      value: 'x',
    });

    expect(capturedSql).toMatch(
      /ON CONFLICT \(definition_id, scope_type, scope_id\) WHERE scope_type <> 'platform'/,
    );
  });
});

describe('PgValueRepository.unsetValue', () => {
  it('deletes the platform singleton row without a scope_id parameter', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgValueRepository(fakePool(query));

    await repo.unsetValue(DEFINITION_ID, { scopeType: 'platform', scopeId: null });

    expect(capturedSql).toMatch(/scope_type = 'platform'/);
    expect(capturedParams).toHaveLength(1);
  });

  it('deletes a scoped row by (definition_id, scope_type, scope_id)', async () => {
    let capturedSql = '';
    const query = jest.fn(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });
    const repo = new PgValueRepository(fakePool(query));

    await repo.unsetValue(DEFINITION_ID, { scopeType: 'user', scopeId: PREFIXED_USER_ID });

    expect(capturedSql).toMatch(/scope_type = \$2 AND scope_id = \$3/);
  });
});

describe('PgValueRepository.listForDefinitions', () => {
  it('returns [] without querying when definitionIds or scopes is empty', async () => {
    const query = jest.fn();
    const repo = new PgValueRepository(fakePool(query));

    expect(await repo.listForDefinitions([], [{ scopeType: 'platform', scopeId: null }])).toEqual([]);
    expect(await repo.listForDefinitions([DEFINITION_ID], [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('builds one OR-ed condition per scope in the chain', async () => {
    let capturedSql = '';
    const query = jest.fn(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });
    const repo = new PgValueRepository(fakePool(query));
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'org', scopeId: LEGACY_ORG_UUID },
      { scopeType: 'user', scopeId: PREFIXED_USER_ID },
    ];

    await repo.listForDefinitions([DEFINITION_ID], chain);

    expect(capturedSql).toMatch(/scope_type = 'platform'/);
    expect(capturedSql).toMatch(/scope_type = \$2 AND scope_id = \$3/);
    expect(capturedSql).toMatch(/scope_type = \$4 AND scope_id = \$5/);
  });
});

describe('PgValueRepository.listAllForDefinition — FFRNT-158 manifest-compatibility check', () => {
  it('queries by definition_id alone, with no scope filter', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: 'row-1',
            definition_id: params[0],
            scope_type: 'org',
            scope_id: LEGACY_ORG_UUID,
            value: 'dark',
            is_locked: false,
            lock_reason: null,
            set_by_user_id: null,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      };
    });
    const repo = new PgValueRepository(fakePool(query));

    const rows = await repo.listAllForDefinition(DEFINITION_ID);

    expect(capturedSql).toMatch(/WHERE definition_id = \$1/);
    expect(capturedSql).not.toMatch(/ANY\(/);
    expect(capturedParams).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('dark');
  });
});
