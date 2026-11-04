/**
 * Security-service mirror of `backend/tests/rootOrgAbsentGuards.test.ts` —
 * regression for #750. The root org is a hard-coded CONSTANT, not a lookup,
 * and migration 014 has paths that legitimately leave the row absent. Anything
 * that then INSERTs a reference to it raises 23503, aborts the migration chain
 * and crash-loops the service on boot.
 *
 * `migrations.rootMembershipBackfill.test.ts` only ever ran against a database
 * where 014 had already succeeded, so this path had no coverage. Stub knex —
 * no database, because the point is the control flow, not the SQL.
 */
import * as migration014 from '../src/migrations/014_seed_root_platform_organization'
import * as migration015 from '../src/migrations/015_root_membership_backfill_and_personal_org_reclassify'

const { ROOT_ORG_ID } = migration014
const ROOT_ORG_SLUG = 'fuzefront'

type Raw = { sql: string; bindings: unknown[] }

function makeKnex(rows: Record<string, Array<Record<string, unknown>>>, rawRowCount = 0) {
  const raws: Raw[] = []
  const knex: any = (table: string) => {
    const wheres: Array<Record<string, unknown>> = []
    const api: any = {
      where(cond: Record<string, unknown>) {
        wheres.push(cond)
        return api
      },
      orderBy() {
        return api
      },
      async first() {
        return (rows[table] ?? []).find(r =>
          wheres.every(w => Object.entries(w).every(([k, v]) => r[k] === v))
        )
      },
    }
    return api
  }
  knex.raw = async (sql: string, bindings: unknown[] = []) => {
    raws.push({ sql, bindings })
    return { rowCount: rawRowCount }
  }
  return { knex, raws }
}

const membershipInserts = (raws: Raw[]) =>
  raws.filter(r => /INSERT INTO organization_memberships/i.test(r.sql))

describe('#750 — nothing inserts a reference to an unverified root organization', () => {
  describe('migration 014 (seed root platform organization)', () => {
    it('does not insert the owner membership when the org INSERT was swallowed by a slug conflict', async () => {
      const { knex, raws } = makeKnex({
        users: [{ id: 'user-1' }],
        organizations: [{ id: 'some-other-id', slug: ROOT_ORG_SLUG, type: 'organization' }],
      })

      await migration014.up(knex)

      expect(membershipInserts(raws)).toHaveLength(0)
    })

    it('inserts nothing at all when it adopts a platform org under a different id', async () => {
      const { knex, raws } = makeKnex({
        users: [{ id: 'user-1' }],
        organizations: [{ id: 'legacy-platform-id', slug: 'legacy', type: 'platform' }],
      })

      await migration014.up(knex)

      expect(raws).toHaveLength(0)
    })

    it('is a clean no-op when the root org is already present', async () => {
      const { knex, raws } = makeKnex({
        users: [{ id: 'user-1' }],
        organizations: [{ id: ROOT_ORG_ID, slug: ROOT_ORG_SLUG, type: 'platform' }],
      })

      await migration014.up(knex)

      expect(raws).toHaveLength(0)
    })
  })

  describe('migration 015 (root-membership backfill + personal-org reclassify)', () => {
    it('skips the backfill when no platform root organization exists', async () => {
      // A non-platform org is not a root: nothing resolves, so nothing is
      // inserted (an unverified reference would be a 23503 crash-loop, #750).
      const { knex, raws } = makeKnex({
        users: [{ id: 'user-1' }],
        organizations: [{ id: 'some-customer-org', slug: 'acme', type: 'organization' }],
      })

      await migration015.up(knex)

      expect(membershipInserts(raws)).toHaveLength(0)
    })

    it('backfills against an ADOPTED platform org when ROOT_ORG_ID has no row (2026-08-16 P1 fix)', async () => {
      // 015 resolves the root org like ensureRootPortal(): ROOT_ORG_ID if
      // present, else the oldest type='platform' row. Migration 014 can adopt a
      // platform org under a different id, so the backfill must target THAT
      // id — hardcoding ROOT_ORG_ID is the 23503 crash-loop this guards.
      const { knex, raws } = makeKnex({
        users: [{ id: 'user-1' }],
        organizations: [{ id: 'legacy-platform-id', slug: 'legacy', type: 'platform' }],
      })

      await migration015.up(knex)

      const inserts = membershipInserts(raws)
      expect(inserts).toHaveLength(1)
      expect(inserts[0].bindings).toEqual(['legacy-platform-id', 'legacy-platform-id'])
    })

    it('2026-08-23 AMENDMENT: also SKIPS the personal-org reclassify when the backfill is skipped', async () => {
      // Pre-2026-08-23 this ran the UPDATE anyway — that was the #750/#751
      // prod incident: reclassifying every type='personal' org away while
      // the root org (and therefore the fallback root membership) doesn't
      // exist strands every affected user with neither. (b) is now gated on
      // the SAME precondition as (a).
      const { knex, raws } = makeKnex({ users: [], organizations: [] })

      await migration015.up(knex)

      expect(raws.filter(r => /UPDATE organizations/i.test(r.sql))).toHaveLength(0)
    })

    it('backfills AND reclassifies when the root organization is present', async () => {
      const { knex, raws } = makeKnex({
        users: [{ id: 'user-1' }],
        organizations: [{ id: ROOT_ORG_ID, slug: ROOT_ORG_SLUG, type: 'platform' }],
      })

      await migration015.up(knex)

      expect(membershipInserts(raws)).toHaveLength(1)
      expect(raws.filter(r => /UPDATE organizations/i.test(r.sql))).toHaveLength(1)
    })
  })
})
