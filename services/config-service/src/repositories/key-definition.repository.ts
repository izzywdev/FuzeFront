import { Pool } from 'pg';
import { fromUuid, mintId, toUuid } from '@izzywdev/fuzefront-identity';
import {
  KeyDefinition,
  KeyDefinitionInput,
  NamespaceEntityId,
  Precedence,
  ScopeType,
  ValueType,
} from '../types';
import { validateDefaultValue } from '../validation/schema';

/** S2 AC4: a key definition whose default fails its own schema must never enter the catalog. */
export class UnsatisfiableDefaultValueError extends Error {
  constructor(
    public readonly key: string,
    public readonly errors: string[],
  ) {
    super(`key '${key}': defaultValue does not satisfy its own schema: ${errors.join('; ')}`);
    this.name = 'UnsatisfiableDefaultValueError';
  }
}

interface KeyDefinitionRow {
  id: string;
  namespace_id: string;
  key: string;
  display_name: string;
  description: string | null;
  help_url: string | null;
  category: string | null;
  sort_order: number;
  tags: unknown;
  value_type: ValueType;
  schema: Record<string, unknown> | null;
  enum_values: unknown[] | null;
  default_value: unknown;
  allowed_scopes: ScopeType[];
  is_system: boolean;
  is_hidden: boolean;
  is_secret: boolean;
  is_readonly: boolean;
  precedence: Precedence;
  requires_restart: boolean;
  deprecated_at: Date | null;
  replaced_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(r: KeyDefinitionRow): KeyDefinition {
  return {
    id: fromUuid('keyDefinition', r.id),
    namespaceId: fromUuid('namespace', r.namespace_id),
    key: r.key,
    displayName: r.display_name,
    description: r.description,
    helpUrl: r.help_url,
    category: r.category,
    sortOrder: r.sort_order,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    valueType: r.value_type,
    schema: r.schema,
    enumValues: r.enum_values,
    defaultValue: r.default_value,
    allowedScopes: r.allowed_scopes,
    isSystem: r.is_system,
    isHidden: r.is_hidden,
    isSecret: r.is_secret,
    isReadonly: r.is_readonly,
    precedence: r.precedence,
    requiresRestart: r.requires_restart,
    deprecatedAt: r.deprecated_at ? r.deprecated_at.toISOString() : null,
    replacedBy: r.replaced_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface KeyDefinitionRepository {
  listByNamespace(namespaceId: NamespaceEntityId): Promise<KeyDefinition[]>;
  findByKey(namespaceId: NamespaceEntityId, key: string): Promise<KeyDefinition | null>;
  /** Validates `defaultValue` against the key's own schema before writing (S2 AC4). */
  create(namespaceId: NamespaceEntityId, input: KeyDefinitionInput): Promise<KeyDefinition>;
}

const SELECT_COLUMNS = `
  id, namespace_id, key, display_name, description, help_url, category, sort_order, tags,
  value_type, schema, enum_values, default_value, allowed_scopes,
  is_system, is_hidden, is_secret, is_readonly, precedence, requires_restart,
  deprecated_at, replaced_by, created_at, updated_at
`;

export class PgKeyDefinitionRepository implements KeyDefinitionRepository {
  constructor(private readonly pool: Pool) {}

  async listByNamespace(namespaceId: NamespaceEntityId): Promise<KeyDefinition[]> {
    const res = await this.pool.query<KeyDefinitionRow>(
      `SELECT ${SELECT_COLUMNS} FROM config_key_definitions
        WHERE namespace_id = $1
        ORDER BY category NULLS FIRST, sort_order, key`,
      [toUuid(namespaceId)],
    );
    return res.rows.map(mapRow);
  }

  async findByKey(namespaceId: NamespaceEntityId, key: string): Promise<KeyDefinition | null> {
    const res = await this.pool.query<KeyDefinitionRow>(
      `SELECT ${SELECT_COLUMNS} FROM config_key_definitions
        WHERE namespace_id = $1 AND key = $2`,
      [toUuid(namespaceId), key],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async create(namespaceId: NamespaceEntityId, input: KeyDefinitionInput): Promise<KeyDefinition> {
    const check = validateDefaultValue({
      valueType: input.valueType,
      defaultValue: input.defaultValue,
      schema: input.schema,
      enumValues: input.enumValues,
    });
    if (!check.valid) {
      throw new UnsatisfiableDefaultValueError(input.key, check.errors);
    }

    const id = toUuid(mintId('keyDefinition'));
    const res = await this.pool.query<KeyDefinitionRow>(
      `INSERT INTO config_key_definitions (
         id, namespace_id, key, display_name, description, help_url, category, sort_order, tags,
         value_type, schema, enum_values, default_value, allowed_scopes,
         is_system, is_hidden, is_secret, is_readonly, precedence, requires_restart, replaced_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
         $10, $11::jsonb, $12::jsonb, $13::jsonb, $14,
         $15, $16, $17, $18, $19, $20, $21
       )
       RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        toUuid(namespaceId),
        input.key,
        input.displayName,
        input.description ?? null,
        input.helpUrl ?? null,
        input.category ?? null,
        input.sortOrder ?? 0,
        JSON.stringify(input.tags ?? []),
        input.valueType,
        input.schema ? JSON.stringify(input.schema) : null,
        input.enumValues ? JSON.stringify(input.enumValues) : null,
        JSON.stringify(input.defaultValue ?? null),
        input.allowedScopes,
        input.isSystem ?? false,
        input.isHidden ?? false,
        input.isSecret ?? false,
        input.isReadonly ?? false,
        input.precedence ?? 'most-specific-wins',
        input.requiresRestart ?? false,
        input.replacedBy ?? null,
      ],
    );
    return mapRow(res.rows[0]);
  }
}
