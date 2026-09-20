/**
 * Migration 025a — additive root-org seed + visibility pin.
 *
 * Numbered 025a, not 028: knex runs migrations in lexical filename order and
 * 026_apps_organization_id_not_null REQUIRES the row this seed creates. At 028
 * the seed sorted after its own consumer and never ran — see the migration's
 * header for the measured crash-loop that caused.
 *
 * Stub knex, no database: the point is the control flow and the SQL shape, the
 * same approach as rootOrgAbsentGuards.test.ts (#750). The production state
 * this models is measured, not hypothesized — a `type='platform'` org under
 * `92f2020b-…` holding slug `fuzefront`, ROOT_ORG_ID absent, and 17 org-less
 * `apps` rows (applications-service 011's own crash message, 2026-09-14).
 *
 * Two properties matter more than the happy path:
 *
 *   1. `up()` NEVER throws. A throwing migration is never recorded by knex, so
 *      it re-throws on every boot — that is the crashloop this migration
 *      exists to end, and reintroducing it here would be the third time
 *      (#750 in 015, then again in 026).
 *   2. The visibility pin grants no access that does not already exist, and
 *      writes BOTH the `visibility` column (which `list()` filters on) and
 *      `manifest->>'visibility'` (which `canRead()` reads).
 */
import * as migrationSeed from '../src/migrations/025a_seed_root_platform_organization_additively'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'
const ADOPTED_PLATFORM_ORG = '92f2020b-2bdb-41f0-98ff-1ef759b41741'

type Raw = { sql: string; bindings: unknown[] }

/**
 * `rows` is static. "The INSERT was a no-op" is modelled by simply not putting
 * the row in `organizations` — which is precisely the production state #750
 * was about. `rawRows` lets a test drive the SELECT in Part B.
 */
function makeKnex(
  rows: Record<string, Array<Record<string, unknown>>>,
  rawRows: Array<Record<string, unknown>> = [],
  // When true, an `INSERT INTO organizations` materialises the row so the
  // migration's postcondition re-read finds it — i.e. the insert SUCCEEDED.
  // Left false, the row never appears, which models the #750 state where the
  // insert was silently swallowed. Both are real production shapes, so which
  // one a test picks is the whole point of that test.
  materializeOrgInsert = false,
  // Which optional `apps` columns this database has. Defaults to the SHARED
  // production shape; pass [] for the backend-only shape CI actually builds.
  columns: string[] = ['slug', 'manifest']
) {
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
  // `apps` is migrated by BOTH this tree and the applications-service's, and
  // they do not agree on its columns: `slug` and `manifest` exist only in the
  // shared production database, never in a CI database where only this tree
  // ran. The migration probes for them, so the stub has to answer.
  knex.schema = {
    async hasColumn(_table: string, column: string) {
      return columns.includes(column)
    },
  }
  knex.raw = async (sql: string, bindings: unknown[] = []) => {
    raws.push({ sql, bindings })
    if (materializeOrgInsert && /INSERT INTO organizations/i.test(sql)) {
      rows.organizations = rows.organizations ?? []
      rows.organizations.push({
        id: String(bindings[0]),
        slug: String(bindings[1]),
        type: 'platform',
      })
    }
    // Matches the SELECT whatever label column it chose — keying this to
    // `SELECT slug` is how the first version of these tests silently stopped
    // exercising the no-slug path at all.
    if (/^\s*SELECT\b/i.test(sql)) return { rows: rawRows }
    return { rowCount: 1 }
  }
  return { knex, raws }
}

const orgInserts = (raws: Raw[]) => raws.filter(r => /INSERT INTO organizations/i.test(r.sql))
const membershipInserts = (raws: Raw[]) =>
  raws.filter(r => /INSERT INTO organization_memberships/i.test(r.sql))
const appUpdates = (raws: Raw[]) => raws.filter(r => /^\s*UPDATE apps/i.test(r.sql))

/** The measured production fixture. */
const PROD = () => ({
  users: [{ id: PLATFORM_REGISTRAR_ID }],
  organizations: [{ id: ADOPTED_PLATFORM_ORG, slug: 'fuzefront', type: 'platform' }],
})

describe('025a — additive root-org seed', () => {
  it('seeds ROOT_ORG_ID under a NON-colliding slug when the adopted org holds `fuzefront`', async () => {
    const { knex, raws } = makeKnex(PROD(), [], true)

    await migrationSeed.up(knex)

    const inserts = orgInserts(raws)
    expect(inserts).toHaveLength(1)
    // Not `fuzefront` — that is held by the adopted org, and a collision there
    // is exactly the #750 silent-swallow.
    expect(inserts[0].bindings[0]).toBe(ROOT_ORG_ID)
    expect(inserts[0].bindings[1]).toBe('fuzefront-root')
    // Conflict target must be the primary key, never untargeted.
    expect(inserts[0].sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i)
    // The owner membership follows, because the row was verified present.
    expect(membershipInserts(raws)).toHaveLength(1)
    expect(membershipInserts(raws)[0].bindings).toContain(ROOT_ORG_ID)
    // And the adopted org is never touched.
    expect(raws.some(r => r.bindings.includes(ADOPTED_PLATFORM_ORG))).toBe(false)
  })

  it('does NOT insert the owner membership when the row is still absent after the INSERT', async () => {
    // The #750 failure verbatim: infer presence from a conflict and the
    // membership INSERT violates organization_memberships_organization_id_foreign.
    // Here the stub never makes the row appear, so the re-read still misses.
    const { knex, raws } = makeKnex(PROD())

    await migrationSeed.up(knex)

    expect(orgInserts(raws)).toHaveLength(1)
    expect(membershipInserts(raws)).toHaveLength(0)
  })

  it('does not re-seed when ROOT_ORG_ID already exists, but still runs the visibility pin', async () => {
    const { knex, raws } = makeKnex(
      {
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: ROOT_ORG_ID, slug: 'fuzefront-root', type: 'platform' }],
      },
      [{ slug: 'stranded-app', visibility: 'private' }]
    )

    await migrationSeed.up(knex)

    expect(orgInserts(raws)).toHaveLength(0)
    expect(membershipInserts(raws)).toHaveLength(0)
    // Part B is NOT conditional on having just created the org.
    expect(appUpdates(raws)).toHaveLength(1)
  })

  it('returns without throwing when there are no users yet', async () => {
    // A throw here is the crashloop. Never a throw.
    const { knex, raws } = makeKnex({ users: [], organizations: [] })

    await expect(migrationSeed.up(knex)).resolves.toBeUndefined()
    expect(orgInserts(raws)).toHaveLength(0)
  })

  it('returns without throwing when every candidate slug is taken', async () => {
    const { knex, raws } = makeKnex({
      users: [{ id: PLATFORM_REGISTRAR_ID }],
      organizations: [
        { id: 'a', slug: 'fuzefront', type: 'platform' },
        { id: 'b', slug: 'fuzefront-root', type: 'organization' },
        { id: 'c', slug: 'fuzefront-platform-root', type: 'organization' },
      ],
    })

    await expect(migrationSeed.up(knex)).resolves.toBeUndefined()
    expect(orgInserts(raws)).toHaveLength(0)
    expect(membershipInserts(raws)).toHaveLength(0)
  })
})

describe('025a — visibility pin', () => {
  it('writes BOTH the visibility column and manifest->>visibility', async () => {
    // list() filters on the COLUMN; canRead() reads the MANIFEST. Updating one
    // and not the other yields a row that lists but will not load, or loads but
    // is filtered out.
    const { knex, raws } = makeKnex(
      {
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: ROOT_ORG_ID, slug: 'fuzefront-root', type: 'platform' }],
      },
      [{ slug: 'a', visibility: 'private' }]
    )

    await migrationSeed.up(knex)

    const [update] = appUpdates(raws)
    expect(update).toBeDefined()
    expect(update.sql).toMatch(/SET visibility = 'public'/i)
    expect(update.sql).toMatch(/jsonb_set\(manifest, '\{visibility\}', '"public"'::jsonb, true\)/i)
  })

  it('targets ONLY org-less rows that are not already public/marketplace', async () => {
    // The scope is the whole safety argument: these rows are already visible to
    // every caller via the orWhereNull branch, so pinning them grants nothing
    // new. Widening past `organization_id IS NULL` WOULD grant new access.
    const { knex, raws } = makeKnex(
      {
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: ROOT_ORG_ID, slug: 'fuzefront-root', type: 'platform' }],
      },
      [{ slug: 'a', visibility: 'private' }]
    )

    await migrationSeed.up(knex)

    const [update] = appUpdates(raws)
    expect(update.sql).toMatch(/WHERE organization_id IS NULL/i)
    expect(update.sql).toMatch(/visibility NOT IN \('public', 'marketplace'\)/i)
  })

  it('ANTI-VACUITY: issues no UPDATE at all when nothing needs pinning', async () => {
    // If this ever fails, the migration is rewriting rows it should not touch —
    // and the "grants no new access" argument stops holding.
    const { knex, raws } = makeKnex(
      {
        users: [{ id: PLATFORM_REGISTRAR_ID }],
        organizations: [{ id: ROOT_ORG_ID, slug: 'fuzefront-root', type: 'platform' }],
      },
      []
    )

    await migrationSeed.up(knex)

    expect(appUpdates(raws)).toHaveLength(0)
  })
})

describe('025a — two trees, one `apps` table', () => {
  // The first version of this migration selected `slug` unconditionally and
  // wrote `manifest` unconditionally. Both columns are created by the
  // APPLICATIONS-SERVICE tree, not this one, so they exist in the shared
  // production database and NOT in the database every backend CI run builds.
  // The result was `column "slug" does not exist`, which aborts the
  // transaction and takes the whole migration chain down — the exact crashloop
  // shape this migration exists to end. These pin the guards.
  const ROOT_PRESENT = {
    users: [{ id: PLATFORM_REGISTRAR_ID }],
    organizations: [{ id: ROOT_ORG_ID, slug: 'fuzefront-root', type: 'platform' }],
  }

  it('does not reference `slug` when the column does not exist', async () => {
    const { knex, raws } = makeKnex(
      { ...ROOT_PRESENT },
      [{ label: 'some-uuid', visibility: 'private' }],
      false,
      [] // backend-only schema: no slug, no manifest
    )

    await migrationSeed.up(knex)

    const selects = raws.filter(r => /^\s*SELECT/i.test(r.sql))
    expect(selects).toHaveLength(1)
    expect(selects[0].sql).not.toMatch(/\bslug\b/)
    expect(selects[0].sql).toMatch(/\bid AS label\b/)
  })

  it('does not write `manifest` when the column does not exist', async () => {
    const { knex, raws } = makeKnex(
      { ...ROOT_PRESENT },
      [{ label: 'some-uuid', visibility: 'private' }],
      false,
      []
    )

    await migrationSeed.up(knex)

    const [update] = appUpdates(raws)
    expect(update).toBeDefined()
    // Still pins the column that DOES exist...
    expect(update.sql).toMatch(/SET visibility = 'public'/i)
    // ...and never names the one that does not.
    expect(update.sql).not.toMatch(/manifest/i)
  })

  it('uses `slug` and writes `manifest` when both exist (the shared prod shape)', async () => {
    const { knex, raws } = makeKnex(
      { ...ROOT_PRESENT },
      [{ label: 'fuzesocial', visibility: 'private' }],
      false,
      ['slug', 'manifest']
    )

    await migrationSeed.up(knex)

    const selects = raws.filter(r => /^\s*SELECT/i.test(r.sql))
    expect(selects[0].sql).toMatch(/\bslug AS label\b/)
    const [update] = appUpdates(raws)
    expect(update.sql).toMatch(/jsonb_set\(manifest/i)
  })
})

/**
 * ORDERING REGRESSION — the defect that made the first version of this
 * migration dead code.
 *
 * The migration body was correct and mutation-tested, and it still never ran
 * in production, because it shipped as `028_` while
 * `026_apps_organization_id_not_null` — which THROWS unless the row this seed
 * creates already exists — sorts first. knex runs migrations in lexical
 * filename order and does not record a migration that throws, so the chain
 * died at 026 on every boot and 028 was unreachable. Measured 2026-09-20:
 * fuzefront-backend at 694 restarts, the only Ready pod stuck on a pre-seed
 * image.
 *
 * No unit test of the migration's own logic could catch that — the bug was
 * entirely in the filename. Hence this test, which asserts the sequence
 * rather than the behaviour.
 */
describe('migration ordering — the seed must precede its consumers', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const dir = path.join(__dirname, '..', 'src', 'migrations')
  const seed = '025a_seed_root_platform_organization_additively.ts'

  it('the root-org seed file is present under the name the ordering depends on', () => {
    expect(fs.readdirSync(dir)).toContain(seed)
  })

  it('sorts BEFORE 026_apps_organization_id_not_null, which throws without the root org', () => {
    const consumer = '026_apps_organization_id_not_null.ts'
    expect(fs.readdirSync(dir)).toContain(consumer)
    // Lexical comparison is the real ordering knex applies.
    expect([seed, consumer].sort()).toEqual([seed, consumer])
    expect(seed < consumer).toBe(true)
  })

  it('still sorts AFTER 025, so it does not jump ahead of its own prerequisites', () => {
    const prior = '025_repair_personal_org_over_reclassification.ts'
    expect(fs.readdirSync(dir)).toContain(prior)
    expect(prior < seed).toBe(true)
  })

  it('no migration sorting before the seed throws on a missing root org', () => {
    const offenders = fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.ts') && f < seed)
      .filter(f => {
        const src = fs.readFileSync(path.join(dir, f), 'utf8')
        return src.includes('ROOT_ORG_ID') && /throw new Error\(/.test(src)
      })
      // 015 is the original seeder, not a consumer: it creates the row.
      .filter(f => !f.startsWith('015_seed_root_platform_organization'))
    expect(offenders).toEqual([])
  })
})
