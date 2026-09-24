/**
 * Idempotent admin bootstrap for the security service.
 *
 * Run as a Helm post-install/post-upgrade hook Job (see
 * templates/security-seed-job.yaml). Unlike the dev knex seed
 * (001_initial_users.ts), this is NON-destructive — it inserts the admin user
 * ONLY if it doesn't already exist, so it's safe to run on every rollout.
 *
 * Credentials come from env (sourced from fuzefront-secrets / values), never
 * hard-coded:
 *   FUZEFRONT_ADMIN_EMAIL     (default <EMAIL>)
 *   FUZEFRONT_ADMIN_PASSWORD  (required; sealed in fuzefront-secrets)
 * DB connection uses the same DB_* env the service uses.
 *
 * WHY THIS FILE WRITES A LOCAL PASSWORD HASH (semgrep fuze-auth-local-password-store)
 * ----------------------------------------------------------------------------------
 * AuthN for the platform is Authentik OIDC and `authentikPassword.ts` is emphatic that
 * "Authentik is the sole identity store; no local bcrypt user is written" — for ordinary
 * users that is correct and this script is NOT an exception to it. This row is the
 * BREAK-GLASS administrator: the account whose entire purpose is to work when Authentik
 * or the OIDC path is unavailable, which is exactly why it cannot be provisioned through
 * Authentik. It is verified by the deliberately-retained local login in
 * `backend/security/src/routes/auth.ts` (already classified by-design in
 * `.github/workflows/codeql-triage.yml`: "Local-auth is intentional break-glass path"),
 * and `seeds/001_initial_users.ts` names this script as the sanctioned way to provision
 * it after local passwords were stripped out of that dev seed.
 *
 * So the finding is a true positive about the pattern and an accepted exception about
 * this call site — suppressed inline, at the site, rather than in a triage list nobody
 * reads. The constraints that keep it acceptable, and which must survive any edit:
 *   - no default password, ever (an unset FUZEFRONT_ADMIN_PASSWORD is a no-op, not a
 *     fallback literal — that is the backdoor 001_initial_users.ts was fixed to remove);
 *   - exactly ONE such account, inserted only when absent, never updated;
 *   - the secret is sealed into fuzefront-secrets, never in values or the repo.
 * If break-glass is ever moved behind Authentik, delete this script — do not relax the
 * rule to fit a second local-password user.
 */
import knexLib from 'knex'
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'

// OWASP Password Storage Cheat Sheet's current floor for bcrypt. Raised from 10: this
// hash protects the one credential that bypasses the IdP, so it gets the strongest cost
// the work factor allows. `bcrypt.compare` reads the cost from the stored hash, so
// existing rows keep verifying and nothing needs re-hashing.
const BCRYPT_COST = 12

async function main(): Promise<void> {
  const email = (process.env.FUZEFRONT_ADMIN_EMAIL || '<EMAIL>').toLowerCase()
  const password = process.env.FUZEFRONT_ADMIN_PASSWORD
  if (!password) {
    // Non-fatal: skip rather than fail the rollout hook. Seal FUZEFRONT_ADMIN_PASSWORD
    // into fuzefront-secrets to enable the admin bootstrap.
    console.warn('⚠️  FUZEFRONT_ADMIN_PASSWORD not set — skipping admin seed (no-op)')
    return
  }

  const db = knexLib({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'fuzefront_platform',
      user: process.env.DB_USER || 'fuzefront_user',
      password: process.env.DB_PASSWORD,
    },
  })

  try {
    const existing = await db('users').where({ email }).first()
    if (existing) {
      console.log(`✅ admin user ${email} already exists — nothing to do`)
      return
    }
    await db('users').insert({
      id: randomUUID(),
      email,
      // Break-glass admin only — see the file header for the full justification and the
      // constraints that bound it. The suppression must stay on the line directly above
      // the call; semgrep only honours it there or inline.
      // nosemgrep: fuze-auth-local-password-store
      password_hash: await bcrypt.hash(password, BCRYPT_COST),
      first_name: 'Admin',
      last_name: 'User',
      roles: JSON.stringify(['admin', 'user']),
      created_at: new Date(),
      updated_at: new Date(),
    })
    console.log(`✅ seeded admin user ${email}`)
  } finally {
    await db.destroy()
  }
}

main().catch(err => {
  console.error('❌ seed-admin failed:', err)
  process.exit(1)
})
