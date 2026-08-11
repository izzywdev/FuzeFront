import { Pool } from 'pg';
import { fromUuid, mintId, toUuid } from '@izzywdev/fuzefront-identity';
import { Namespace, NamespaceCreateInput, NamespaceEntityId } from '../types';
import { decodeCursor, encodeCursor, PageInfo } from '../pagination';

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

export interface ListNamespacesArgs {
  limit: number;
  /** Opaque keyset cursor (previous page's nextCursor); undefined for page 1. */
  cursor?: string;
}

export interface ListNamespacesResult {
  items: Namespace[];
  pageInfo: PageInfo;
}

export interface NamespaceRepository {
  findByName(namespace: string): Promise<Namespace | null>;
  findById(id: NamespaceEntityId): Promise<Namespace | null>;
  /**
   * Idempotent on `namespace` (openapi.yaml `createNamespace`): registering an
   * existing namespace updates its presentation metadata rather than failing.
   */
  upsert(input: NamespaceCreateInput): Promise<{ namespace: Namespace; created: boolean }>;
  /**
   * Cursor page, newest first (openapi.yaml `listNamespaces`). Keyset on
   * (created_at, id) DESC — both are part of every row and `id` is unique, so
   * the pair is a stable total order even when multiple namespaces share a
   * `created_at` timestamp, which is what keeps the walk gap/dupe-free under
   * concurrent inserts.
   */
  listPage(args: ListNamespacesArgs): Promise<ListNamespacesResult>;
}

interface NamespaceCursor {
  createdAt: string;
  id: string;
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

  async listPage(args: ListNamespacesArgs): Promise<ListNamespacesResult> {
    const cursor = args.cursor ? decodeCursor<NamespaceCursor>(args.cursor) : null;
    const params: unknown[] = [];
    let where = '';
    if (cursor && cursor.createdAt && cursor.id) {
      params.push(cursor.createdAt, cursor.id);
      // Row-value comparison on the same (created_at, id) DESC order as
      // ORDER BY below, so the keyset predicate and the sort agree exactly.
      where = `WHERE (created_at, id) < ($1::timestamptz, $2::uuid)`;
    }
    // Fetch limit+1 to detect a further page without a second COUNT query.
    params.push(args.limit + 1);
    const limitParamIdx = params.length;

    const res = await this.pool.query<NamespaceRow>(
      `SELECT id, namespace, display_name, description, owner_app_id, created_at, updated_at
         FROM config_namespaces
         ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParamIdx}`,
      params,
    );

    const hasNextPage = res.rows.length > args.limit;
    const rows = hasNextPage ? res.rows.slice(0, args.limit) : res.rows;
    const items = rows.map(mapRow);
    const last = rows[rows.length - 1];
    const nextCursor =
      hasNextPage && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;

    return { items, pageInfo: { hasNextPage, nextCursor } };
  }
}
