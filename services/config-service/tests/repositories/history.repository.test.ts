/**
 * Unit tests for PgHistoryRepository (FF-EPIC-18 / FFRNT-280), mirroring
 * tests/repositories/value.repository.test.ts's convention: a mocked
 * `pg.Pool.query` capturing SQL/params, no real database.
 */

import { randomUUID } from 'crypto';
import { configureIdentity, mintId } from '@izzywdev/fuzefront-identity';
import { PgHistoryRepository } from '../../src/repositories/history.repository';
import { KeyDefinitionEntityId, Scope } from '../../src/types';
import { decodeCursor, encodeCursor } from '../../src/pagination';

// Same widening as value.repository.test.ts — org/portal/user ids are not
// yet family-wide backfilled to the prefixed TypeID form.
beforeAll(() => {
  configureIdentity({ legacyUuidTypes: new Set(['portal', 'organization', 'user']) });
});

function fakePool(queryImpl?: jest.Mock) {
  return { query: queryImpl ?? jest.fn() } as any;
}

const NOW = new Date('2026-01-01T00:00:00.000Z');
const DEFINITION_ID = mintId('keyDefinition') as KeyDefinitionEntityId;
const LEGACY_ORG_UUID = '11111111-1111-7111-8111-111111111111';

function historyRowFromInsertParams(params: unknown[]) {
  const [id, definitionId, namespace, key, scopeType, scopeId, action, oldValueJson, newValueJson, redacted, actorType, actorId, reason, revertOf] =
    params as any[];
  return {
    id,
    definition_id: definitionId,
    namespace,
    key,
    scope_type: scopeType,
    scope_id: scopeId,
    action,
    old_value: JSON.parse(oldValueJson),
    new_value: JSON.parse(newValueJson),
    redacted,
    actor_type: actorType,
    actor_id: actorId,
    reason,
    revert_of: revertOf,
    occurred_at: NOW,
  };
}

describe('PgHistoryRepository.append', () => {
  it('mints its own id (cvh_ prefix) — never accepts a caller-supplied one', async () => {
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      capturedParams = params;
      return { rows: [historyRowFromInsertParams(params)] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    const entry = await repo.append({
      definitionId: DEFINITION_ID,
      namespace: 'fuzefront.chat',
      key: 'ui.theme.density',
      scope: { scopeType: 'platform', scopeId: null },
      action: 'set',
      oldValue: 'comfortable',
      newValue: 'compact',
      redacted: false,
      actor: { actorType: 'user', actorId: 'usr_1' },
      reason: 'testing',
    });

    expect(entry.id).toMatch(/^cvh_/);
    expect(capturedParams[6]).toBe('set');
  });

  it('redaction wins: an isSecret entry stores null for old/new value regardless of what was passed in', async () => {
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      capturedParams = params;
      return { rows: [historyRowFromInsertParams(params)] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    const entry = await repo.append({
      definitionId: DEFINITION_ID,
      namespace: 'fuzefront.chat',
      key: 'api.token',
      scope: { scopeType: 'platform', scopeId: null },
      action: 'set',
      oldValue: 'old-secret-plaintext',
      newValue: 'new-secret-plaintext',
      redacted: true,
      actor: { actorType: 'user', actorId: 'usr_1' },
      reason: 'rotation',
    });

    // Never even serialized to the params the query received.
    expect(capturedParams[7]).toBe('null');
    expect(capturedParams[8]).toBe('null');
    expect(entry.oldValue).toBeNull();
    expect(entry.newValue).toBeNull();
    expect(entry.redacted).toBe(true);
  });

  it('a system actor carries a null actorId', async () => {
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      capturedParams = params;
      return { rows: [historyRowFromInsertParams(params)] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    const entry = await repo.append({
      definitionId: DEFINITION_ID,
      namespace: 'fuzefront.chat',
      key: 'k',
      scope: { scopeType: 'platform', scopeId: null },
      action: 'set',
      newValue: 'v',
      redacted: false,
      actor: { actorType: 'system', actorId: null },
    });

    expect(capturedParams[11]).toBeNull();
    expect(entry.actor).toEqual({ actorType: 'system', actorId: null });
  });

  it('scopeId is null exactly when scopeType is platform, and set otherwise', async () => {
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      capturedParams = params;
      return { rows: [historyRowFromInsertParams(params)] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    await repo.append({
      definitionId: DEFINITION_ID,
      namespace: 'fuzefront.chat',
      key: 'k',
      scope: { scopeType: 'org', scopeId: LEGACY_ORG_UUID },
      action: 'unset',
      redacted: false,
      actor: { actorType: 'user', actorId: 'usr_1' },
    });

    expect(capturedParams[4]).toBe('org');
    expect(capturedParams[5]).toBe(LEGACY_ORG_UUID);
  });

  it('carries revertOf through when supplied, converted to storage form', async () => {
    const revertOfId = mintId('configHistory');
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      capturedParams = params;
      return { rows: [historyRowFromInsertParams(params)] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    const entry = await repo.append({
      definitionId: DEFINITION_ID,
      namespace: 'fuzefront.chat',
      key: 'k',
      scope: { scopeType: 'platform', scopeId: null },
      action: 'set',
      newValue: 'v',
      redacted: false,
      actor: { actorType: 'user', actorId: 'usr_1' },
      revertOf: revertOfId,
    });

    expect(capturedParams[13]).toBeTruthy();
    expect(entry.revertOf).toBe(revertOfId);
  });
});

describe('PgHistoryRepository.listPage', () => {
  it('filters by namespace + key + exact scope, and paginates newest-first (occurred_at, id) DESC', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    const scope: Scope = { scopeType: 'org', scopeId: LEGACY_ORG_UUID };
    await repo.listPage({ namespace: 'fuzefront.chat', key: 'ui.theme.density', scope, limit: 20 });

    expect(capturedSql).toMatch(/namespace = \$1/);
    expect(capturedSql).toMatch(/key = \$2/);
    expect(capturedSql).toMatch(/scope_type = \$3/);
    expect(capturedSql).toMatch(/scope_id = \$4/);
    expect(capturedSql).toMatch(/ORDER BY occurred_at DESC, id DESC/);
    expect(capturedParams[0]).toBe('fuzefront.chat');
    expect(capturedParams[1]).toBe('ui.theme.density');
    expect(capturedParams[2]).toBe('org');
    expect(capturedParams[3]).toBe(LEGACY_ORG_UUID);
    // limit + 1, to detect a further page without a second query.
    expect(capturedParams[capturedParams.length - 1]).toBe(21);
  });

  it('matches scope_id IS NULL (not a param) for the platform singleton tier', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    await repo.listPage({ namespace: 'fuzefront.chat', key: 'k', scope: { scopeType: 'platform', scopeId: null }, limit: 20 });

    expect(capturedSql).toMatch(/scope_id IS NULL/);
    // Only namespace, key, scopeType, and limit — no scope_id param.
    expect(capturedParams).toHaveLength(4);
  });

  it('round-trips the cursor via a row-value comparison on (occurred_at, id)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    const cursor = encodeCursor({ occurredAt: '2026-01-01T00:00:00.000Z', id: 'cvh_x' });
    await repo.listPage({
      namespace: 'fuzefront.chat',
      key: 'k',
      scope: { scopeType: 'platform', scopeId: null },
      limit: 10,
      cursor,
    });

    expect(capturedSql).toMatch(/\(occurred_at, id\) < \(\$4::timestamptz, \$5::uuid\)/);
    expect(capturedParams[3]).toBe('2026-01-01T00:00:00.000Z');
    expect(capturedParams[4]).toBe('cvh_x');
  });

  it('a malformed cursor degrades to page 1 rather than erroring', async () => {
    let capturedSql = '';
    const query = jest.fn(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });
    const repo = new PgHistoryRepository(fakePool(query));

    await repo.listPage({
      namespace: 'fuzefront.chat',
      key: 'k',
      scope: { scopeType: 'platform', scopeId: null },
      limit: 10,
      cursor: 'not-a-real-cursor',
    });

    expect(capturedSql).not.toMatch(/occurred_at, id\) </);
  });

  it('detects a further page by fetching limit+1 and trims to limit, with a decodable nextCursor', async () => {
    const ids = Array.from({ length: 3 }, () => randomUUID());
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: ids[i],
      namespace: 'fuzefront.chat',
      key: 'k',
      scope_type: 'platform',
      scope_id: null,
      action: 'set',
      old_value: null,
      new_value: 'v',
      redacted: false,
      actor_type: 'user',
      actor_id: 'usr_1',
      reason: null,
      revert_of: null,
      occurred_at: new Date(2026, 0, 1 + i),
    }));
    const query = jest.fn(async () => ({ rows }));
    const repo = new PgHistoryRepository(fakePool(query));

    const result = await repo.listPage({
      namespace: 'fuzefront.chat',
      key: 'k',
      scope: { scopeType: 'platform', scopeId: null },
      limit: 2,
    });

    expect(result.items).toHaveLength(2);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.nextCursor).toBeTruthy();
    const decoded = decodeCursor<{ occurredAt: string; id: string }>(result.pageInfo.nextCursor!);
    expect(decoded?.id).toBe(ids[1]);
  });
});
