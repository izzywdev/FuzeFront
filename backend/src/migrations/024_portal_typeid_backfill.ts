import { Knex } from 'knex'

/**
 * FFRNT-185 step 5 — portal storage-form backfill.
 *
 * WHEN TO RUN: after the `fuzefront.identity.prefixed-ids` release flag has
 * been flipped ON for 100 % of the fleet and all clients are receiving and
 * forwarding the TypeID wire form (`prt_01h…`). Running this migration while
 * the flag is still OFF turns every existing portal id from the legacy hex form
 * (`prt_3b1c…`) into a bare UUID on the wire — a breaking change clients do
 * not expect. Once the flag is ON and clients are on TypeID, the switch to bare
 * UUID storage is invisible because the serializer always re-emits TypeID.
 *
 * WHAT IT DOES: converts the legacy portal id storage format to a bare UUID so
 * the `portals` table aligns with every other entity type:
 *
 *   storage before: `prt_3b1c2a7f5e9d4b0a8c6f1e3d2a7b5c9e`  (32 hex chars)
 *   storage after:  `3b1c2a7f-5e9d-4b0a-8c6f-1e3d2a7b5c9e`  (bare UUID)
 *   wire (flag ON): `prt_01h455vb4pex5vsknk084sn02q`          (TypeID base32)
 *
 * The legacy format was produced by `generatePortalId()` in
 * `backend/src/repositories/portalRepository.ts`:
 *   `prt_${uuidv4().replace(/-/g, '')}` — UUID v4, dashes stripped.
 * Converting back to a bare UUID is therefore lossless: re-insert the dashes.
 *
 * SPECIAL IDs (`prt_fuzefront`, `prt_bootstrap`) do NOT match the 32-hex-char
 * pattern and are left unchanged.
 *
 * TABLES UPDATED (all in the same `fuzefront_platform` database):
 *   portals.id                               (PK — the primary conversion)
 *   portal_domains.portal_id                 FK → portals.id, ON DELETE CASCADE
 *   portal_provisioning.portal_id            FK → portals.id, ON DELETE CASCADE
 *   portal_apps.portal_id                    FK → portals.id, ON DELETE CASCADE
 *   users.home_portal_id                     FK → portals.id, ON DELETE SET NULL
 *   organization_invitations.portal_id       FK → portals.id, ON DELETE SET NULL
 *
 * FK HANDLING: PostgreSQL FK constraints are `NOT DEFERRABLE` by default, so
 * updating the PK in `portals` while children still hold the old value would
 * violate the FK at statement boundary. We temporarily disable FK-check
 * triggers on all affected tables for the duration of the update block (inside
 * a single transaction so the disable/enable pair is atomic with the data
 * change). `DISABLE TRIGGER ALL` requires table ownership or superuser; the
 * migrations run as the DB owner, so this is safe.
 *
 * IDEMPOTENT: a second run of `up()` finds zero rows matching
 * `^prt_[0-9a-f]{32}$` and exits early.
 */

/** Matches the legacy generatePortalId() output: `prt_` + exactly 32 lowercase hex chars. */
const LEGACY_HEX_RE = /^prt_([0-9a-f]{32})$/

/** Converts 32 bare hex chars back to a dashed UUID string. */
function hexToUuid(hex: string): string {
  return (
    `${hex.slice(0, 8)}-` +
    `${hex.slice(8, 12)}-` +
    `${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-` +
    `${hex.slice(20)}`
  )
}

// child tables that hold a FK → portals.id (all in the same DB)
const FK_TABLES: Array<{ table: string; col: string }> = [
  { table: 'portal_domains', col: 'portal_id' },
  { table: 'portal_provisioning', col: 'portal_id' },
  { table: 'portal_apps', col: 'portal_id' },
  { table: 'users', col: 'home_portal_id' },
  { table: 'organization_invitations', col: 'portal_id' },
]

export async function up(knex: Knex): Promise<void> {
  // Collect legacy-format portal ids
  const rows: Array<{ id: string }> = await knex('portals')
    .select('id')
    .where(knex.raw("id ~ '^prt_[0-9a-f]{32}$'"))

  if (rows.length === 0) {
    console.log('[024] No legacy portal IDs found — nothing to migrate.')
    return
  }

  const idMap: Array<{ oldId: string; newId: string }> = rows.map(({ id }) => {
    const m = LEGACY_HEX_RE.exec(id)!
    return { oldId: id, newId: hexToUuid(m[1]) }
  })

  console.log(
    `[024] Converting ${idMap.length} portal IDs from legacy prt_<hex32> → bare UUID...`
  )

  // Determine which FK child tables actually exist (guard against partial installs
  // or a very early schema state where some tables haven't been created yet).
  const activeFkTables = await Promise.all(
    FK_TABLES.map(async ({ table, col }) => ({
      table,
      col,
      exists: (await knex.schema.hasTable(table)) && (await knex.schema.hasColumn(table, col)),
    }))
  ).then(results => results.filter(r => r.exists))

  const allTables = ['portals', ...activeFkTables.map(r => r.table)]

  await knex.transaction(async trx => {
    // Disable FK-check triggers on every affected table.
    for (const table of allTables) {
      await trx.raw('ALTER TABLE ?? DISABLE TRIGGER ALL', [table])
    }

    for (const { oldId, newId } of idMap) {
      // 1. Rename the PK row itself.
      await trx('portals').where('id', oldId).update({ id: newId })

      // 2. Repoint all FK child columns.
      for (const { table, col } of activeFkTables) {
        await trx(table).where(col, oldId).update({ [col]: newId })
      }
    }

    // Re-enable FK-check triggers. The data is now consistent so the check
    // passes immediately when the transaction commits.
    for (const table of allTables) {
      await trx.raw('ALTER TABLE ?? ENABLE TRIGGER ALL', [table])
    }
  })

  console.log(`[024] Done. Converted ${idMap.length} portal IDs.`)
}

export async function down(knex: Knex): Promise<void> {
  // Intentionally not reversible: this migration converts legacy prt_<hex32>
  // to bare UUIDs. The reverse would require knowing WHICH bare UUIDs were
  // originally prt_<hex32> vs. minted as bare UUIDs by post-migration code
  // (generatePortalId() is updated alongside this migration to emit bare UUIDs
  // directly). Attempting a down migration on a live system would be unsafe.
  //
  // To roll back in an emergency: restore from a pre-migration DB snapshot.
  console.warn(
    '[024] down() is a no-op — portal TypeID backfill is not reversible via migration.'
  )
}
