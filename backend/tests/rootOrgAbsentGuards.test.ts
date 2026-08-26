/**
 * Regression for #750 — the root org is a hard-coded CONSTANT, not a lookup,
 * and migration 015 has paths that legitimately leave the row absent. Anything
 * that then INSERTs a reference to it raises 23503, aborts the migration chain
 * and crash-loops the service on boot. That is what happened in prod on
 * 2026-08-20.
 *
 * The pre-existing migration tests (`rootMembershipBackfillMigration.test.ts`,
 * `backend/security/tests/migrations.rootMembershipBackfill.test.ts`) all run
 * against a database where 015 had already SUCCEEDED, so the absent-root path
 * had no coverage at all. These tests exercise it directly with a stub knex —
 * no database, because the point is the control flow, not the SQL.
 */
import * as migration015 from '../src/migrations/015_seed_root_platform_organization'
import * as migration022 from '../src/migrations/022_root_membership_backfill_and_personal_org_reclassify'

const { ROOT_ORG_ID } = migration015
const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'
const ROOT_ORG_SLUG = 'fuzefront'

type Raw = { sql: string; bindings: unknown[] }

/**
 * Minimal knex stand-in supporting exactly the surface these migrations use:
 * `knex(table).where(obj).orderBy(...).first()` and `knex.raw(sql, bindings)`.
 * `rows` is static — a test models "the INSERT was a no-op" simply by not
 * putting the row there, which is precisely the production state.
 */
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
  describe('migration 015 (seed root platform organization)', () => {
    it('does not insert the owner membership when the org INSERT was swallowed by a slug conflict', async () => {
      // A DIFFERENT organization holds slug 'fuzefront'. It is not
      // type='platform', so the adopt branch does not fire; the untargeted
      // ON CONFLICT DO NOTHING then silently swallows the slug collision and
      // no row with ROOT_ORG_ID is created.
      const { knex, raws } = makeKnex({
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: 'some-other-id', slug: ROOT_ORG_SLUG, type: 'organization' }],
      })

      await migration015.up(knex)

      expect(membershipInserts(raws)).toHaveLength(0)
    })

    it('inserts the owner membership once the row is verified present', async () => {
      const { knex, raws } = makeKnex(
        {
          users: [{ id: PLATFORM_REGISTRAR_ID }],
          organizations: [{ id: ROOT_ORG_ID, slug: ROOT_ORG_SLUG, type: 'platform' }],
        },
        1
      )

      await migration015.up(knex)

      const inserts = membershipInserts(raws)
      expect(inserts).toHaveLength(1)
      expect(inserts[0].bindings).toContain(ROOT_ORG_ID)
    })

    it('inserts nothing at all when it adopts a platform org under a different id', async () => {
      const { knex, raws } = makeKnex({
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: 'legacy-platform-id', slug: 'legacy', type: 'platform' }],
      })

      await migration015.up(knex)

      expect(raws).toHaveLength(0)
    })
  })

  describe('migration 022 (root-membership backfill + personal-org reclassify)', () => {
    it('2026-08-26 AMENDMENT (#680): ADOPTS a platform org under a different id and backfills against ITS id', async () => {
      // This assertion was inverted until #680 (73c30aae): it required a SKIP
      // for this fixture. That was the contract which crashlooped
      // fuzefront-backend and fuzefront-security on 2026-08-16 — migration
      // 015's "adopt a pre-existing platform org rather than creating a
      // second one" branch can leave a prod DB whose real platform-root org
      // has an id other than ROOT_ORG_ID and NO ROOT_ORG_ID row at all (the
      // 2026-07-29 rebuild: 92f2020b-…, slug `fuzefront`). Hardcoding
      // ROOT_ORG_ID then made every INSERT violate
      // organization_memberships_organization_id_foreign on every boot.
      //
      // 022 now resolves the root org exactly as ensureRootPortal() does —
      // prefer ROOT_ORG_ID, else the oldest type='platform' row — so a
      // divergent platform org IS the root org, and the backfill must run
      // against ITS id. #680 changed the migration and left this guard
      // asserting the old behaviour, which is why Backend Tests went red at
      // 05:15Z on 2026-08-26.
      const { knex, raws } = makeKnex({
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: 'legacy-platform-id', slug: 'legacy', type: 'platform' }],
      })

      await migration022.up(knex)

      const inserts = membershipInserts(raws)
      expect(inserts).toHaveLength(1)
      // The crux: bound to the ADOPTED org, never to the hardcoded constant.
      // This is the exact regression #680 fixed.
      expect(inserts[0].bindings).toContain('legacy-platform-id')
      expect(inserts[0].bindings).not.toContain(ROOT_ORG_ID)
    })

    it('skips the backfill when NO platform org exists at all, even with users present', async () => {
      // The genuine "root organization does not exist" case post-#680, and the
      // coverage the inverted assertion above was standing in for. Users are
      // present deliberately: the empty-fixture test below has none, so it
      // cannot distinguish "skipped the backfill" from "had nobody to backfill".
      const { knex, raws } = makeKnex({
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: 'some-org', slug: 'some-org', type: 'organization' }],
      })

      await migration022.up(knex)

      expect(membershipInserts(raws)).toHaveLength(0)
    })

    it('2026-08-23 AMENDMENT: also SKIPS the personal-org reclassify when the backfill is skipped', async () => {
      // Pre-2026-08-23 this ran the UPDATE anyway ("(b) does not reference
      // the root org, so a missing root org must not disable it too") — that
      // was the #750/#751 prod incident: reclassifying every type='personal'
      // org away while the root org (and therefore the fallback root
      // membership) doesn't exist strands every affected user with neither.
      // (b) is now gated on the SAME precondition as (a).
      const { knex, raws } = makeKnex({ users: [], organizations: [] })

      await migration022.up(knex)

      expect(raws.filter(r => /UPDATE organizations/i.test(r.sql))).toHaveLength(0)
    })

    it('backfills AND reclassifies when the root organization is present', async () => {
      const { knex, raws } = makeKnex({
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: ROOT_ORG_ID, slug: ROOT_ORG_SLUG, type: 'platform' }],
      })

      await migration022.up(knex)

      expect(membershipInserts(raws)).toHaveLength(1)
      expect(raws.filter(r => /UPDATE organizations/i.test(r.sql))).toHaveLength(1)
    })
  })
})
