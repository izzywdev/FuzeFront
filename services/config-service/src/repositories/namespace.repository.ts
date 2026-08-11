import { Pool } from 'pg';
import { fromUuid, mintId, toUuid } from '@izzywdev/fuzefront-identity';
import { Namespace, NamespaceCreateInput, NamespaceEntityId } from '../types';

interface NamespaceRow {
  id: string;
  namespace: string;
  display_name: string;
  description: string | null;
  owner_app_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(r: NamespaceRow): Namespace {
  return {
    id: fromUuid('namespace', r.id),
    namespace: r.namespace,
    displayName: r.display_name,
    description: r.description,
    ownerAppId: r.owner_app_id,
    createdAt: r.created_at.toISOString(),
  };
}

export interface NamespaceRepository {
  findByName(namespace: string): Promise<Namespace | null>;
  findById(id: NamespaceEntityId): Promise<Namespace | null>;
  /**
   * Idempotent on `namespace` (openapi.yaml `createNamespace`): registering an
   * existing namespace updates its presentation metadata rather than failing.
   */
  upsert(input: NamespaceCreateInput): Promise<{ namespace: Namespace; created: boolean }>;
}

export class PgNamespaceRepository implements NamespaceRepository {
  constructor(private readonly pool: Pool) {}

  async findByName(namespace: string): Promise<Namespace | null> {
    const res = await this.pool.query<NamespaceRow>(
      `SELECT id, namespace, display_name, description, owner_app_id, created_at, updated_at
         FROM config_namespaces
        WHERE namespace = $1`,
      [namespace],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async findById(id: NamespaceEntityId): Promise<Namespace | null> {
    const res = await this.pool.query<NamespaceRow>(
      `SELECT id, namespace, display_name, description, owner_app_id, created_at, updated_at
         FROM config_namespaces
        WHERE id = $1`,
      [toUuid(id)],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async upsert(input: NamespaceCreateInput): Promise<{ namespace: Namespace; created: boolean }> {
    // Minted up front, even on the update path: a fresh id is simply discarded
    // by ON CONFLICT DO UPDATE (which never touches `id`), and this keeps
    // exactly one code path — no separate "insert" vs "update" branch to
    // accidentally re-mint or skip minting on.
    const id = toUuid(mintId('namespace'));
    const res = await this.pool.query<NamespaceRow & { inserted: boolean }>(
      `INSERT INTO config_namespaces (id, namespace, display_name, description, owner_app_id)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (namespace) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                owner_app_id = EXCLUDED.owner_app_id,
                updated_at = now()
       RETURNING id, namespace, display_name, description, owner_app_id, created_at, updated_at,
                 (xmax = 0) AS inserted`,
      [id, input.namespace, input.displayName, input.description ?? null, input.ownerAppId ?? null],
    );
    const row = res.rows[0];
    return { namespace: mapRow(row), created: row.inserted };
  }
}
