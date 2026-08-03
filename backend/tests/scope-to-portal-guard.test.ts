import fs from 'fs'
import path from 'path'

/**
 * FF-EPIC-11-S2 — static guard against the leak risk this whole feature exists
 * to close: a NEW raw `db('users')` read in a route file that never routes
 * through the central `scopeToPortal` helper (utils/scopeToPortal.ts).
 *
 * This is deliberately a coarse, repo-scoped static check (grep, not an AST
 * analysis) — see utils/scopeToPortal.ts's module doc, which is the canonical
 * "grep before you add a raw users read" instruction this test enforces.
 *
 * ALLOWLIST — call sites that read `users` but are NOT a listing/search/
 * profile-of-ANOTHER-user path, so scoping does not apply to them:
 *   - middleware/auth.ts, middleware/machine-auth.ts: resolve the CALLER's own
 *     row from a verified token/credential (never another user's).
 *   - routes/auth.ts: login/signup/OIDC — a caller resolving their OWN
 *     identity by the credential they just presented, not a directory read.
 *   - services/*.ts: internal provisioning/administrative machinery (e.g.
 *     rootOrgAdmin granting Permit roles, organizationProvisioning resolving
 *     an owner) — not an HTTP listing/search/profile response.
 *   - repositories/portalRepository.ts: root-portal bootstrap self-heal.
 *
 * Any OTHER file under src/routes that calls `db('users')` MUST also import
 * `scopeToPortal` or `applyPortalScope` from `../utils/scopeToPortal` — this
 * test fails loudly (naming the offending file) if that invariant is broken.
 */

const SRC_ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes')

const ALLOWLIST = new Set<string>([
  'auth.ts', // self-lookup by verified credential/token, not a directory read
])

function readRouteFiles(): string[] {
  return fs
    .readdirSync(SRC_ROUTES_DIR)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
}

describe('scope-to-portal leak guard (FF-EPIC-11-S2)', () => {
  it('every routes/*.ts file that reads db(\'users\') also imports the central scopeToPortal helper', () => {
    const offenders: string[] = []

    for (const file of readRouteFiles()) {
      if (ALLOWLIST.has(file)) continue

      const contents = fs.readFileSync(path.join(SRC_ROUTES_DIR, file), 'utf8')
      const readsUsersTable = /db\(\s*['"`]users['"`]\s*\)/.test(contents)
      const readsUsersJoin = /\.join\(\s*['"`]users(?:\s+as\s+\w+)?['"`]/i.test(contents)

      if (!readsUsersTable && !readsUsersJoin) continue

      const importsHelper = /from ['"](\.\.\/)?utils\/scopeToPortal['"]/.test(contents)
      if (!importsHelper) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })

  it('routes/users.ts (list/search/profile) imports scopeToPortal', () => {
    const contents = fs.readFileSync(path.join(SRC_ROUTES_DIR, 'users.ts'), 'utf8')
    expect(contents).toMatch(/from ['"]\.\.\/utils\/scopeToPortal['"]/)
    expect(contents).toMatch(/resolvePortalScopeDecision/)
    expect(contents).toMatch(/applyPortalScope/)
  })

  it('routes/organizations.ts (membership listing) imports scopeToPortal', () => {
    const contents = fs.readFileSync(path.join(SRC_ROUTES_DIR, 'organizations.ts'), 'utf8')
    expect(contents).toMatch(/from ['"]\.\.\/utils\/scopeToPortal['"]/)
  })
})
