import type { Knex } from 'knex'
import type { RefIndexStore, RefRecord, EntityType } from '@izzywdev/fuzefront-identity'

/**
 * Knex-backed implementation of the L1 existence projection (FFRNT P2).
 *
 * Uses the `sec_ref_index` and `sec_ref_index_state` tables (public schema).
 * Security-service references portal IDs and org IDs from host backend — those
 * entities are owned by the monolith. The projection allows assertRefExists to
 * answer without an RPC to the monolith.
 *
 * governance/identifier-standard.md §5, L1 layer.
 */
export class KnexRefIndexRepository implements RefIndexStore {
  constructor(private readonly db: Knex) {}

  private readonly table = 'sec_ref_index'
  private readonly stateTable = 'sec_ref_index_state'

  async has(
    entityType: EntityType,
    entityId: string,
    tenantId?: string | null,
  ): Promise<boolean> {
    const res = await this.db.raw<{ rows: unknown[] }>(
      `SELECT 1
         FROM ${this.table}
        WHERE entity_type = ?
          AND entity_id = ?
          AND status = 'active'
          AND (?::text IS NULL OR tenant_id IS NULL OR tenant_id = ?)
        LIMIT 1`,
      [entityType, entityId, tenantId ?? null, tenantId ?? null],
    )
    return (res.rows?.length ?? 0) > 0
  }

  async upsert(record: RefRecord): Promise<void> {
    await this.db.raw(
      `INSERT INTO ${this.table} (entity_type, entity_id, tenant_id, status)
            VALUES (?, ?, ?, ?)
       ON CONFLICT (entity_type, entity_id, COALESCE(tenant_id, ''))
       DO UPDATE SET status = EXCLUDED.status, updated_at = now()
             WHERE ${this.table}.status <> 'deleted'`,
      [record.entityType, record.entityId, record.tenantId ?? null, record.status],
    )
    await this.touch()
  }

  async markDeleted(
    entityType: EntityType,
    entityId: string,
    tenantId?: string | null,
  ): Promise<void> {
    await this.db.raw(
      `INSERT INTO ${this.table} (entity_type, entity_id, tenant_id, status)
            VALUES (?, ?, ?, 'deleted')
       ON CONFLICT (entity_type, entity_id, COALESCE(tenant_id, ''))
       DO UPDATE SET status = 'deleted', updated_at = now()`,
      [entityType, entityId, tenantId ?? null],
    )
    await this.touch()
  }

  async lastAppliedAt(): Promise<Date | null> {
    const res = await this.db.raw<{ rows: Array<{ last_applied_at: Date | null }> }>(
      `SELECT last_applied_at FROM ${this.stateTable} WHERE id = TRUE`,
    )
    return res.rows[0]?.last_applied_at ?? null
  }

  async isEmpty(): Promise<boolean> {
    const res = await this.db.raw<{ rows: unknown[] }>(
      `SELECT 1 FROM ${this.table} LIMIT 1`,
    )
    return (res.rows?.length ?? 0) === 0
  }

  private async touch(): Promise<void> {
    await this.db.raw(
      `INSERT INTO ${this.stateTable} (id, last_applied_at)
            VALUES (TRUE, now())
       ON CONFLICT (id) DO UPDATE SET last_applied_at = now()`,
    )
  }
}
