import { Pool } from 'pg';
import type { RefIndexStore, RefRecord } from '@izzywdev/fuzefront-identity';
import type { EntityType } from '@izzywdev/fuzefront-identity';

/**
 * Postgres implementation of the L1 existence projection (FFRNT-184).
 *
 * The interface lives in @izzywdev/fuzefront-identity and is deliberately
 * storage-agnostic — that package must not take a `pg` dependency, since the
 * Python services and any non-Postgres service consume the same standard.
 */
export class PgRefIndexRepository implements RefIndexStore {
  constructor(private readonly pool: Pool) {}

  async has(
    entityType: EntityType,
    entityId: string,
    tenantId?: string | null,
  ): Promise<boolean> {
    // A NULL tenant on the ROW means "unscoped", and an unscoped row answers
    // for any caller. A caller that passes no tenant matches either. Requiring
    // an exact tenant match both ways would make every reference to an
    // unscoped entity (a platform user, say) look absent.
    const res = await this.pool.query(
      `SELECT 1
         FROM billing.ref_index
        WHERE entity_type = $1
          AND entity_id = $2
          AND status = 'active'
          AND ($3::text IS NULL OR tenant_id IS NULL OR tenant_id = $3)
        LIMIT 1`,
      [entityType, entityId, tenantId ?? null],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async upsert(record: RefRecord): Promise<void> {
    // Idempotent by construction: consumers redeliver, so this runs more than
    // once per event and must converge rather than duplicate.
    //
    // The WHERE clause is the tombstone guard. Kafka gives no ordering across
    // partitions, so a redelivered `*.created` can arrive AFTER the `*.deleted`
    // that supersedes it; without this, that redelivery silently resurrects a
    // deleted entity and the projection starts vouching for something gone.
    await this.pool.query(
      `INSERT INTO billing.ref_index (entity_type, entity_id, tenant_id, status)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (entity_type, entity_id, COALESCE(tenant_id, ''))
       DO UPDATE SET status = EXCLUDED.status, updated_at = now()
             WHERE billing.ref_index.status <> 'deleted'`,
      [record.entityType, record.entityId, record.tenantId ?? null, record.status],
    );
    await this.touch();
  }

  async markDeleted(
    entityType: EntityType,
    entityId: string,
    tenantId?: string | null,
  ): Promise<void> {
    // Insert-or-tombstone: the delete can legitimately arrive before we ever
    // saw the create (a compacted topic, a consumer that started late), and a
    // bare UPDATE would silently do nothing and leave the entity unknown-but-
    // not-tombstoned — so the later create would then mark it active.
    await this.pool.query(
      `INSERT INTO billing.ref_index (entity_type, entity_id, tenant_id, status)
            VALUES ($1, $2, $3, 'deleted')
       ON CONFLICT (entity_type, entity_id, COALESCE(tenant_id, ''))
       DO UPDATE SET status = 'deleted', updated_at = now()`,
      [entityType, entityId, tenantId ?? null],
    );
    await this.touch();
  }

  async lastAppliedAt(): Promise<Date | null> {
    const res = await this.pool.query<{ last_applied_at: Date | null }>(
      `SELECT last_applied_at FROM billing.ref_index_state WHERE id = TRUE`,
    );
    return res.rows[0]?.last_applied_at ?? null;
  }

  async isEmpty(): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM billing.ref_index LIMIT 1`);
    return (res.rowCount ?? 0) === 0;
  }

  /** Stamps liveness so the read path can tell "absent" from "not caught up". */
  private async touch(): Promise<void> {
    await this.pool.query(
      `INSERT INTO billing.ref_index_state (id, last_applied_at)
            VALUES (TRUE, now())
       ON CONFLICT (id) DO UPDATE SET last_applied_at = now()`,
    );
  }
}
