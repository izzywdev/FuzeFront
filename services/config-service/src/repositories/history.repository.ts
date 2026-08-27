/**
 * The append-only change trail (FF-EPIC-18 / FFRNT-280): every `set`/`unset`/
 * `lock`/`unlock` (`PUT /v1/config`) and `reveal`
 * (`POST /v1/config/secrets/reveal`) appends one row here; nothing is ever
 * updated or deleted — see migrations/004_config_history.sql and
 * openapi.yaml `ConfigHistoryEntry`.
 *
 * `append()` takes a `Pool` (or a `PoolClient` passed as one, matching
 * `PgValueRepository`'s own convention — see src/routes/config.write.ts's
 * `new PgValueRepository(client as unknown as Pool)`) so the write surface
 * can record history INSIDE the same transaction as the value change it
 * describes: a rolled-back write must never leave an orphan history entry
 * behind, which "wrap the same client" gives for free.
 */

import { Pool } from 'pg';
import { assertRef, fromUuid, mintId, toUuid } from '@izzywdev/fuzefront-identity';
import {
  Actor,
  ActorType,
  ConfigHistoryAction,
  ConfigHistoryEntry,
  ConfigHistoryEntryId,
  KeyDefinitionEntityId,
  Scope,
  ScopeType,
} from '../types';
import { decodeCursor, encodeCursor, PageInfo } from '../pagination';

/** The entity type a non-platform scope tier's `scopeId` references — mirrors value.repository.ts. */
const SCOPE_ENTITY_TYPE = {
  portal: 'portal',
  org: 'organization',
  user: 'user',
} as const;

function scopeIdToStorage(scope: Scope): string | null {
  if (scope.scopeType === 'platform') return null;
  const entityType = SCOPE_ENTITY_TYPE[scope.scopeType as 'portal' | 'org' | 'user'];
  return toUuid(assertRef(entityType, scope.scopeId));
}

function scopeIdToWire(scopeType: ScopeType, storageScopeId: string | null): string | null {
  if (scopeType === 'platform' || storageScopeId == null) return null;
  const entityType = SCOPE_ENTITY_TYPE[scopeType as 'portal' | 'org' | 'user'];
  return fromUuid(entityType, storageScopeId);
}

export interface AppendHistoryInput {
  definitionId: KeyDefinitionEntityId;
  namespace: string;
  key: string;
  scope: Scope;
  action: ConfigHistoryAction;
  /** Ignored (stored as `null`) when `redacted` is true. */
  oldValue?: unknown;
  /** Ignored (stored as `null`) when `redacted` is true. */
  newValue?: unknown;
  /** True when the key is `isSecret` at write time — a point-in-time copy, not re-derived later. */
  redacted: boolean;
  actor: Actor;
  reason?: string | null;
  revertOf?: ConfigHistoryEntryId | null;
}

export interface ListHistoryArgs {
  namespace: string;
  key: string;
  scope: Scope;
  limit: number;
  /** Opaque keyset cursor (previous page's nextCursor); undefined for page 1. */
  cursor?: string;
}

export interface ListHistoryResult {
  items: ConfigHistoryEntry[];
  pageInfo: PageInfo;
}

export interface HistoryRepository {
  /** Appends one immutable entry. Never updates or deletes an existing row. */
  append(input: AppendHistoryInput): Promise<ConfigHistoryEntry>;
  /**
   * Cursor page for ONE key at ONE exact scope, newest first (openapi.yaml
   * `listConfigHistory`). Keyset on (occurred_at, id) DESC, matching
   * migration 004's index — both are on every row and `id` is unique, so the
   * pair is a stable total order even when multiple entries share an
   * `occurred_at` (e.g. two ops applied in the same PUT /v1/config batch).
   */
  listPage(args: ListHistoryArgs): Promise<ListHistoryResult>;
}

interface HistoryRow {
  id: string;
  namespace: string;
  key: string;
  scope_type: ScopeType;
  scope_id: string | null;
  action: ConfigHistoryAction;
  old_value: unknown;
  new_value: unknown;
  redacted: boolean;
  actor_type: ActorType;
  actor_id: string | null;
  reason: string | null;
  revert_of: string | null;
  occurred_at: Date;
}

function mapRow(r: HistoryRow): ConfigHistoryEntry {
  return {
    id: fromUuid('configHistory', r.id),
    namespace: r.namespace,
    key: r.key,
    scope: { scopeType: r.scope_type, scopeId: scopeIdToWire(r.scope_type, r.scope_id) },
    action: r.action,
    oldValue: r.redacted ? null : (r.old_value ?? null),
    newValue: r.redacted ? null : (r.new_value ?? null),
    redacted: r.redacted,
    actor: { actorType: r.actor_type, actorId: r.actor_id },
    reason: r.reason,
    revertOf: r.revert_of ? fromUuid('configHistory', r.revert_of) : null,
    occurredAt: r.occurred_at.toISOString(),
  };
}

interface HistoryCursor {
  occurredAt: string;
  id: string;
}

const SELECT_COLUMNS = `
  id, namespace, key, scope_type, scope_id, action, old_value, new_value,
  redacted, actor_type, actor_id, reason, revert_of, occurred_at
`;

export class PgHistoryRepository implements HistoryRepository {
  constructor(private readonly pool: Pool) {}

  async append(input: AppendHistoryInput): Promise<ConfigHistoryEntry> {
    const id = mintId('configHistory');
    // Redaction wins over whatever old/new values were supplied — an isSecret
    // key's plaintext must never land in this table, regardless of what the
    // caller passed in (openapi.yaml: "oldValue/newValue are then always null
    // regardless of action").
    const oldValue = input.redacted ? null : (input.oldValue ?? null);
    const newValue = input.redacted ? null : (input.newValue ?? null);

    const res = await this.pool.query<HistoryRow>(
      `INSERT INTO config.config_history (
         id, definition_id, namespace, key, scope_type, scope_id, action,
         old_value, new_value, redacted, actor_type, actor_id, reason, revert_of
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14
       )
       RETURNING ${SELECT_COLUMNS}`,
      [
        toUuid(id),
        toUuid(input.definitionId),
        input.namespace,
        input.key,
        input.scope.scopeType,
        scopeIdToStorage(input.scope),
        input.action,
        JSON.stringify(oldValue),
        JSON.stringify(newValue),
        input.redacted,
        input.actor.actorType,
        // Stored verbatim, same as config_values.set_by_user_id
        // (value.repository.ts) — the JWT `userId` claim is not run through
        // assertRef()/toUuid() there either, so this stays consistent rather
        // than applying a stricter check to one of the two id-shaped columns
        // that record "who" and not the other.
        input.actor.actorId ?? null,
        input.reason ?? null,
        input.revertOf ? toUuid(input.revertOf) : null,
      ],
    );
    return mapRow(res.rows[0]);
  }

  async listPage(args: ListHistoryArgs): Promise<ListHistoryResult> {
    const conds: string[] = ['namespace = $1', 'key = $2', 'scope_type = $3'];
    const params: unknown[] = [args.namespace, args.key, args.scope.scopeType];

    if (args.scope.scopeType === 'platform') {
      conds.push('scope_id IS NULL');
    } else {
      params.push(scopeIdToStorage(args.scope));
      conds.push(`scope_id = $${params.length}`);
    }

    const cursor = args.cursor ? decodeCursor<HistoryCursor>(args.cursor) : null;
    if (cursor && cursor.occurredAt && cursor.id) {
      params.push(cursor.occurredAt, cursor.id);
      const i = params.length - 1;
      // Row-value comparison on the same (occurred_at, id) DESC order as
      // ORDER BY below — mirrors namespace.repository.ts's listPage.
      conds.push(`(occurred_at, id) < ($${i}::timestamptz, $${i + 1}::uuid)`);
    }

    params.push(args.limit + 1);
    const limitParamIdx = params.length;

    const res = await this.pool.query<HistoryRow>(
      `SELECT ${SELECT_COLUMNS} FROM config.config_history
        WHERE ${conds.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC
        LIMIT $${limitParamIdx}`,
      params,
    );

    const hasNextPage = res.rows.length > args.limit;
    const rows = hasNextPage ? res.rows.slice(0, args.limit) : res.rows;
    const items = rows.map(mapRow);
    const last = rows[rows.length - 1];
    const nextCursor =
      hasNextPage && last ? encodeCursor({ occurredAt: last.occurred_at.toISOString(), id: last.id }) : null;

    return { items, pageInfo: { hasNextPage, nextCursor } };
  }
}
