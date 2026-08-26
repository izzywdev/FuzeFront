/**
 * A minimal in-memory stand-in for the three tables the write surface
 * touches (`config_namespaces`, `config_key_definitions`, `config_values`),
 * driving the EXACT SQL text the Pg*Repository classes issue (matched by
 * characteristic substrings, not a real parser).
 *
 * Why not the simpler `{ query: jest.fn() }` style `fakePool()` from
 * tests/repositories/*.test.ts: those tests each exercise ONE repository
 * call in isolation with a canned single-shot response. The write ROUTES
 * orchestrate several repository calls across a real `BEGIN`/`COMMIT`/
 * `ROLLBACK` transaction, and the two behaviours this story is riskiest on —
 * "unset vs pin-the-parent's-value produce different persisted state" and
 * "a failed batch leaves nothing written" — are only genuinely provable
 * against something that actually REMEMBERS state across calls and actually
 * ROLLS BACK. Snapshot/restore on BEGIN/COMMIT/ROLLBACK gives that without
 * a real Postgres.
 */

interface NamespaceRow {
  id: string;
  namespace: string;
  display_name: string;
  description: string | null;
  owner_app_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface KeyDefRow {
  id: string;
  namespace_id: string;
  key: string;
  display_name: string;
  description: string | null;
  help_url: string | null;
  category: string | null;
  sort_order: number;
  tags: unknown;
  value_type: string;
  schema: unknown;
  enum_values: unknown;
  default_value: unknown;
  allowed_scopes: string[];
  is_system: boolean;
  is_hidden: boolean;
  is_secret: boolean;
  is_readonly: boolean;
  precedence: string;
  requires_restart: boolean;
  deprecated_at: Date | null;
  replaced_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ValueRow {
  id: string;
  definition_id: string;
  scope_type: string;
  scope_id: string | null;
  value: unknown;
  is_locked: boolean;
  lock_reason: string | null;
  set_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface State {
  namespaces: NamespaceRow[];
  keyDefs: KeyDefRow[];
  values: ValueRow[];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (_k, val) => val);
}

let seq = 0;
/** Monotonic fake "now()" — distinct on every call, so version hashes change deterministically. */
function nextTimestamp(): Date {
  seq += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, seq));
}
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export class FakeDb {
  private state: State = { namespaces: [], keyDefs: [], values: [] };
  private snapshots: State[] = [];

  seedNamespace(row: Partial<NamespaceRow> & { id: string; namespace: string }): void {
    this.state.namespaces.push({
      display_name: 'Test namespace',
      description: null,
      owner_app_id: null,
      created_at: nextTimestamp(),
      updated_at: nextTimestamp(),
      ...row,
    });
  }

  seedKeyDef(row: Partial<KeyDefRow> & { id: string; namespace_id: string; key: string; value_type: string }): void {
    this.state.keyDefs.push({
      display_name: row.key,
      description: null,
      help_url: null,
      category: null,
      sort_order: 0,
      tags: [],
      schema: null,
      enum_values: null,
      default_value: null,
      allowed_scopes: ['platform', 'portal', 'org', 'user'],
      is_system: false,
      is_hidden: false,
      is_secret: false,
      is_readonly: false,
      precedence: 'most-specific-wins',
      requires_restart: false,
      deprecated_at: null,
      replaced_by: null,
      created_at: nextTimestamp(),
      updated_at: nextTimestamp(),
      ...row,
    });
  }

  seedValue(row: Partial<ValueRow> & { definition_id: string; scope_type: string; scope_id: string | null; value: unknown }): void {
    this.state.values.push({
      id: nextId('val'),
      is_locked: false,
      lock_reason: null,
      set_by_user_id: null,
      created_at: nextTimestamp(),
      updated_at: nextTimestamp(),
      ...row,
    });
  }

  /** Rows currently in config_values — for assertions after a route call. */
  get valueRows(): ValueRow[] {
    return this.state.values;
  }
  get keyDefRows(): KeyDefRow[] {
    return this.state.keyDefs;
  }

  private query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> => {
    const s = sql.trim();

    if (s === 'BEGIN') {
      this.snapshots.push(clone(this.state));
      return { rows: [] };
    }
    if (s === 'COMMIT') {
      this.snapshots.pop();
      return { rows: [] };
    }
    if (s === 'ROLLBACK') {
      const snap = this.snapshots.pop();
      if (snap) this.state = snap;
      return { rows: [] };
    }

    // ── config_namespaces ────────────────────────────────────────────────
    if (s.includes('FROM config_namespaces') && s.includes('WHERE namespace = $1')) {
      const row = this.state.namespaces.find((n) => n.namespace === params[0]);
      return { rows: row ? [row] : [] };
    }
    if (s.includes('INSERT INTO config_namespaces')) {
      const [id, namespace, displayName, description, ownerAppId] = params as [string, string, string, string | null, string | null];
      let row = this.state.namespaces.find((n) => n.namespace === namespace);
      let inserted = false;
      if (!row) {
        row = { id, namespace, display_name: displayName, description, owner_app_id: ownerAppId, created_at: nextTimestamp(), updated_at: nextTimestamp() };
        this.state.namespaces.push(row);
        inserted = true;
      } else {
        row.display_name = displayName;
        row.description = description;
        row.owner_app_id = ownerAppId;
        row.updated_at = nextTimestamp();
      }
      return { rows: [{ ...row, inserted }] };
    }

    // ── config_key_definitions ───────────────────────────────────────────
    if (s.startsWith('SELECT') && s.includes('FROM config_key_definitions') && s.includes('WHERE namespace_id = $1') && !s.includes('AND key')) {
      const rows = this.state.keyDefs.filter((d) => d.namespace_id === params[0]);
      return { rows };
    }
    if (s.includes('INSERT INTO config_key_definitions')) {
      const [
        id, namespaceId, key, displayName, description, helpUrl, category, sortOrder, tags,
        valueType, schema, enumValues, defaultValue, allowedScopes,
        isSystem, isHidden, isSecret, isReadonly, precedence, requiresRestart, replacedBy,
      ] = params as any[];
      const row: KeyDefRow = {
        id, namespace_id: namespaceId, key, display_name: displayName, description, help_url: helpUrl,
        category, sort_order: sortOrder, tags: JSON.parse(tags), value_type: valueType,
        schema: schema ? JSON.parse(schema) : null, enum_values: enumValues ? JSON.parse(enumValues) : null,
        default_value: JSON.parse(defaultValue), allowed_scopes: allowedScopes,
        is_system: isSystem, is_hidden: isHidden, is_secret: isSecret, is_readonly: isReadonly,
        precedence, requires_restart: requiresRestart, deprecated_at: null, replaced_by: replacedBy,
        created_at: nextTimestamp(), updated_at: nextTimestamp(),
      };
      this.state.keyDefs.push(row);
      return { rows: [row] };
    }
    if (s.includes('UPDATE config_key_definitions SET deprecated_at')) {
      const ids = params[0] as string[];
      for (const d of this.state.keyDefs) {
        if (ids.includes(d.id) && d.deprecated_at === null) {
          d.deprecated_at = nextTimestamp();
          d.updated_at = nextTimestamp();
        }
      }
      return { rows: [] };
    }
    if (s.includes('UPDATE config_key_definitions SET')) {
      const [
        id, displayName, description, helpUrl, category, sortOrder, tags,
        valueType, schema, enumValues, defaultValue, allowedScopes,
        isSystem, isHidden, isSecret, isReadonly, precedence, requiresRestart, replacedBy,
      ] = params as any[];
      const row = this.state.keyDefs.find((d) => d.id === id);
      if (!row) return { rows: [] };
      row.display_name = displayName;
      row.description = description;
      row.help_url = helpUrl;
      row.category = category;
      row.sort_order = sortOrder;
      row.tags = JSON.parse(tags);
      row.value_type = valueType;
      row.schema = schema ? JSON.parse(schema) : null;
      row.enum_values = enumValues ? JSON.parse(enumValues) : null;
      row.default_value = JSON.parse(defaultValue);
      row.allowed_scopes = allowedScopes;
      row.is_system = isSystem;
      row.is_hidden = isHidden;
      row.is_secret = isSecret;
      row.is_readonly = isReadonly;
      row.precedence = precedence;
      row.requires_restart = requiresRestart;
      row.replaced_by = replacedBy;
      row.deprecated_at = null;
      row.updated_at = nextTimestamp();
      return { rows: [row] };
    }

    // ── config_values ─────────────────────────────────────────────────────
    if (s.includes('FROM config_values') && s.includes('definition_id = ANY($1::uuid[])')) {
      const definitionIds = params[0] as string[];
      const wantsPlatform = s.includes("scope_type = 'platform'");
      const pairs: [string, string][] = [];
      for (let i = 1; i < params.length; i += 2) {
        pairs.push([params[i] as string, params[i + 1] as string]);
      }
      const rows = this.state.values.filter(
        (v) =>
          definitionIds.includes(v.definition_id) &&
          ((v.scope_type === 'platform' && wantsPlatform) ||
            pairs.some(([st, sid]) => v.scope_type === st && v.scope_id === sid)),
      );
      return { rows };
    }
    if (s.startsWith('SELECT') && s.includes('FROM config_values') && s.includes('WHERE definition_id = $1') && !s.includes('ANY(')) {
      const rows = this.state.values.filter((v) => v.definition_id === params[0]);
      return { rows };
    }
    if (s.includes('INSERT INTO config_values')) {
      const [definitionId, scopeType, scopeId, valueJson, isLocked, lockReason, setByUserId] = params as any[];
      let row = this.state.values.find(
        (v) =>
          v.definition_id === definitionId &&
          v.scope_type === scopeType &&
          (scopeType === 'platform' ? true : v.scope_id === scopeId),
      );
      const parsedValue = JSON.parse(valueJson);
      if (!row) {
        row = {
          id: nextId('val'),
          definition_id: definitionId,
          scope_type: scopeType,
          scope_id: scopeType === 'platform' ? null : scopeId,
          value: parsedValue,
          is_locked: isLocked,
          lock_reason: lockReason,
          set_by_user_id: setByUserId,
          created_at: nextTimestamp(),
          updated_at: nextTimestamp(),
        };
        this.state.values.push(row);
      } else {
        row.value = parsedValue;
        row.is_locked = isLocked;
        row.lock_reason = lockReason;
        row.set_by_user_id = setByUserId;
        row.updated_at = nextTimestamp();
      }
      return { rows: [row] };
    }
    if (s.includes('DELETE FROM config_values')) {
      if (s.includes("scope_type = 'platform'")) {
        const [definitionId] = params as [string];
        this.state.values = this.state.values.filter((v) => !(v.definition_id === definitionId && v.scope_type === 'platform'));
      } else {
        const [definitionId, scopeType, scopeId] = params as [string, string, string];
        this.state.values = this.state.values.filter(
          (v) => !(v.definition_id === definitionId && v.scope_type === scopeType && v.scope_id === scopeId),
        );
      }
      return { rows: [] };
    }

    throw new Error(`FakeDb: unrecognised query: ${s}`);
  };

  /** Usable directly as a `pg.Pool` (structurally: `.query()` + `.connect()`). */
  get pool(): any {
    const self = this;
    return {
      query: this.query,
      connect: async () => ({
        query: self.query,
        release: () => undefined,
      }),
    };
  }
}
