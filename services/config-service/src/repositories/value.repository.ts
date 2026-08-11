import { Pool } from 'pg';
import { assertRef, fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { ConfigValue, KeyDefinitionEntityId, Scope, ScopeType } from '../types';

/** S3 AC3: a write at a tier the key's `allowedScopes` excludes is refused. */
export class ScopeNotAllowedError extends Error {
  constructor(public readonly scopeType: ScopeType) {
    super(`scope '${scopeType}' is not in this key's allowedScopes`);
    this.name = 'ScopeNotAllowedError';
  }
}

/**
 * S3 AC4: a `scope_id` that does not resolve to a real portal/org/user is
 * mapped to a clear error rather than surfacing as an unhandled DB exception.
 *
 * `scope_id` cannot carry a real FK to three different tables (S3 risk note),
 * so this is the "service-layer existence check" mitigation the risk note
 * proposes — implemented today as the L0 layer of
 * governance/identifier-standard.md §5 (a prefix/format check, no network
 * call). Full existence verification (L1: a ref_index projection) is not
 * built in this PR.
 */
export class InvalidScopeReferenceError extends Error {
  constructor(
    public readonly scopeType: ScopeType,
    public readonly scopeId: string | null,
    public readonly cause?: unknown,
  ) {
    super(`scope_id '${String(scopeId)}' is not a valid ${scopeType} reference`);
    this.name = 'InvalidScopeReferenceError';
  }
}

/** The entity type a non-platform scope tier's `scopeId` references. */
const SCOPE_ENTITY_TYPE = {
  portal: 'portal',
  org: 'organization',
  user: 'user',
} as const;

/**
 * Validates a scope's shape (null invariant + L0 assertRef()) and converts
 * `scopeId` from its wire form to the native-uuid storage form — the pair
 * (scope_type, scope_id) is ALWAYS resolved together, per
 * identifier-standard.md §3, never on a bare id.
 *
 * Returns the storage-form `scope_id` (null for `platform`).
 */
function assertValidScopeAndToStorageId(scope: Scope): string | null {
  if (scope.scopeType === 'platform') {
    if (scope.scopeId != null) {
      throw new InvalidScopeReferenceError(scope.scopeType, scope.scopeId);
    }
    return null;
  }
  if (scope.scopeId == null) {
    throw new InvalidScopeReferenceError(scope.scopeType, scope.scopeId);
  }
  const entityType = SCOPE_ENTITY_TYPE[scope.scopeType as 'portal' | 'org' | 'user'];
  try {
    const validated = assertRef(entityType, scope.scopeId);
    return toUuid(validated);
  } catch (err) {
    throw new InvalidScopeReferenceError(scope.scopeType, scope.scopeId, err);
  }
}

export interface SetValueInput {
  definitionId: KeyDefinitionEntityId;
  /** The definition's `allowedScopes`, supplied by the caller (avoids a join here). */
  allowedScopes: ScopeType[];
  scope: Scope;
  value: unknown;
  isLocked?: boolean;
  lockReason?: string | null;
  setByUserId?: string | null;
}

export interface ValueRepository {
  /**
   * Every stored row for the given definitions, at any of the given scopes.
   * The primary feed for the resolution engine (src/resolver/resolve.ts),
   * which is itself DB-free — this is the one query that fetches its inputs.
   */
  listForDefinitions(definitionIds: KeyDefinitionEntityId[], scopes: Scope[]): Promise<ConfigValue[]>;
  /** Upserts the override at `input.scope`. Refuses a disallowed or invalid scope BEFORE writing. */
  setValue(input: SetValueInput): Promise<ConfigValue>;
  /** Removes the override at `scope`, so the key resolves from its parent again. */
  unsetValue(definitionId: KeyDefinitionEntityId, scope: Scope): Promise<void>;
}

interface ValueRow {
  id: string;
  definition_id: string;
  scope_type: ScopeType;
  scope_id: string | null;
  value: unknown;
  is_locked: boolean;
  lock_reason: string | null;
  set_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Renders a storage-form scope back to its wire-typed form at the serialization boundary. */
function scopeIdToWire(scopeType: ScopeType, storageScopeId: string | null): string | null {
  if (scopeType === 'platform' || storageScopeId == null) return null;
  const entityType = SCOPE_ENTITY_TYPE[scopeType as 'portal' | 'org' | 'user'];
  return fromUuid(entityType, storageScopeId);
}

function mapRow(r: ValueRow): ConfigValue {
  return {
    id: r.id,
    definitionId: fromUuid('keyDefinition', r.definition_id),
    scopeType: r.scope_type,
    scopeId: scopeIdToWire(r.scope_type, r.scope_id),
    value: r.value,
    isLocked: r.is_locked,
    lockReason: r.lock_reason,
    setByUserId: r.set_by_user_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export class PgValueRepository implements ValueRepository {
  constructor(private readonly pool: Pool) {}

  async listForDefinitions(definitionIds: KeyDefinitionEntityId[], scopes: Scope[]): Promise<ConfigValue[]> {
    if (definitionIds.length === 0 || scopes.length === 0) return [];

    // A polymorphic (scope_type, scope_id) pair is always matched together
    // (identifier-standard.md §3) — never scope_id alone.
    const scopeConds: string[] = [];
    const params: unknown[] = [definitionIds.map((id) => toUuid(id))];
    let i = 2;
    for (const s of scopes) {
      if (s.scopeType === 'platform') {
        scopeConds.push(`scope_type = 'platform'`);
      } else {
        params.push(s.scopeType, assertValidScopeAndToStorageId(s));
        scopeConds.push(`(scope_type = $${i} AND scope_id = $${i + 1})`);
        i += 2;
      }
    }

    const res = await this.pool.query<ValueRow>(
      `SELECT id, definition_id, scope_type, scope_id, value, is_locked, lock_reason, set_by_user_id, created_at, updated_at
         FROM config_values
        WHERE definition_id = ANY($1::uuid[]) AND (${scopeConds.join(' OR ')})`,
      params,
    );
    return res.rows.map(mapRow);
  }

  async setValue(input: SetValueInput): Promise<ConfigValue> {
    if (!input.allowedScopes.includes(input.scope.scopeType)) {
      throw new ScopeNotAllowedError(input.scope.scopeType);
    }
    const storageScopeId = assertValidScopeAndToStorageId(input.scope);

    // Two partial unique indexes back this table (migration 003): the
    // platform singleton tier conflicts on (definition_id) alone, every other
    // tier on (definition_id, scope_type, scope_id). A single INSERT can only
    // target one arbiter index, so the conflict target is chosen here.
    const conflictTarget =
      input.scope.scopeType === 'platform'
        ? `(definition_id) WHERE scope_type = 'platform'`
        : `(definition_id, scope_type, scope_id) WHERE scope_type <> 'platform'`;

    const res = await this.pool.query<ValueRow>(
      `INSERT INTO config_values (definition_id, scope_type, scope_id, value, is_locked, lock_reason, set_by_user_id)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       ON CONFLICT ${conflictTarget} DO UPDATE
            SET value = EXCLUDED.value,
                is_locked = EXCLUDED.is_locked,
                lock_reason = EXCLUDED.lock_reason,
                set_by_user_id = EXCLUDED.set_by_user_id,
                updated_at = now()
       RETURNING id, definition_id, scope_type, scope_id, value, is_locked, lock_reason, set_by_user_id, created_at, updated_at`,
      [
        toUuid(input.definitionId),
        input.scope.scopeType,
        storageScopeId,
        JSON.stringify(input.value),
        input.isLocked ?? false,
        input.lockReason ?? null,
        input.setByUserId ?? null,
      ],
    );
    return mapRow(res.rows[0]);
  }

  async unsetValue(definitionId: KeyDefinitionEntityId, scope: Scope): Promise<void> {
    const storageScopeId = assertValidScopeAndToStorageId(scope);
    if (scope.scopeType === 'platform') {
      await this.pool.query(
        `DELETE FROM config_values WHERE definition_id = $1 AND scope_type = 'platform'`,
        [toUuid(definitionId)],
      );
    } else {
      await this.pool.query(
        `DELETE FROM config_values WHERE definition_id = $1 AND scope_type = $2 AND scope_id = $3`,
        [toUuid(definitionId), scope.scopeType, storageScopeId],
      );
    }
  }
}
