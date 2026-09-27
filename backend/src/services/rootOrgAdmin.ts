import { db as defaultDb } from '../config/database'
import type { Knex } from 'knex'
import { assignOrgAdminRebac } from '../utils/permit/resource-instances'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'
import { isEmployeeConsoleEnabled } from '../utils/employeeFlag'
import { EMPLOYEE_USER_ROLE } from './employeeRole'

/**
 * Grants the ReBAC `org-admin` role on the ROOT organization to every platform
 * administrator.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * `permit/schema.ts` declares `org-admin` as derived parent→child over
 * `Organization.relations.parent`, which is what lets platform staff administer
 * every tenant without a per-tenant assignment. Wiring the hierarchy at
 * provisioning time (organizationProvisioning's `permit_org_parent` step) gives
 * the derivation its edges — but a derivation still needs a ROOT GRANT to
 * derive FROM. `assignOrgAdminRebac()` had zero callers, so nobody ever held
 * `org-admin` on the root org and the whole mechanism resolved to nothing.
 *
 * WHO COUNTS AS AN ADMINISTRATOR
 * ------------------------------
 * Users whose `roles` array contains `admin`, EXCLUDING the `platform-registrar`
 * service principal. The registrar is created by migration 014 with
 * roles ['admin','user'] and no `password_hash` — it is a token-only identity
 * for Module-Federation app registration that can never complete an interactive
 * login. Granting it tree-wide administrative authority would hand every holder
 * of a sealed registration token the ability to administer every tenant, which
 * is a privilege escalation, not a convenience.
 *
 * FF-EPIC-17-S8 — behind the `fuzefront.identity.employee-console` flag
 * (default OFF), users whose `roles` array contains the new EXPLICIT
 * `employee` marker (`services/employeeRole.ts`) are ALSO recognized as
 * administrators, additive to the legacy implicit `admin` trigger above
 * (which stays active unconditionally, flag or no flag — this never
 * de-provisions an existing admin). See `services/employeeRole.ts` for why
 * the explicit marker exists (disambiguating platform staff from a customer
 * org's own `admin` role, which share the same word today).
 *
 * Idempotent: Permit treats a repeat assignment as a benign conflict, and the
 * helper already swallows those. Safe to run on every boot.
 */

const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Named human root administrators, from `PLATFORM_ROOT_ADMIN_EMAILS`
 * (comma-separated, set via Helm `rootAdmins.emails`).
 *
 * WHY THIS EXISTS
 * ---------------
 * Migrations seed the root org owned by `platform-registrar`, a token-only
 * principal no human can log in as, and nothing in the product ever puts
 * `admin` into a real user's `roles`. A production deployment therefore had no
 * human who could administer the root org. Listing an email here promotes that
 * account once it exists: `admin` in `users.roles` (→ root `org-admin` via
 * ensureRootOrgAdmins), an active `owner` membership on the root org, and — if
 * the registrar still owns it — `organizations.owner_id`.
 *
 * TRUST ANCHOR — READ BEFORE ADDING AN EMAIL
 * ------------------------------------------
 * Promotion keys on the email of an existing `users` row. Self-signup does not
 * verify email today (the enrollment email-verify stage is unbound and the OIDC
 * mapping hard-codes `email_verified: true`), so an email is only safe to list
 * if its Authentik account is PRE-CREATED by a checked-in blueprint — as
 * `authentik/blueprints/groups-fuzeinfra-admins.yaml` does for the owner. A
 * pre-created username cannot be enrolled by anyone else, so the `users` row
 * for that email can only come from that account's own login. Listing an email
 * without that blueprint lets whoever registers it first become root.
 */
export function parseRootAdminEmails(
  raw: string | undefined = process.env.PLATFORM_ROOT_ADMIN_EMAILS
): string[] {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.includes('@'))
    ),
  ]
}

function rolesOf(user: { roles: unknown }): string[] {
  const r = typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles
  return Array.isArray(r) ? r : []
}

/**
 * Applies the DB side of the configured root administrators. Returns the ids of
 * the configured users that exist (whether or not anything changed). Users not
 * yet signed up are skipped; the next run picks them up.
 */
export async function promoteConfiguredRootAdmins(
  db: Knex,
  emails: string[] = parseRootAdminEmails()
): Promise<string[]> {
  if (emails.length === 0) return []
  const rootOrg = await db('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!rootOrg) return []

  const users = await db('users')
    .whereRaw('lower(email) = ANY(?)', [emails])
    .whereNot({ id: PLATFORM_REGISTRAR_ID })
  // Keep the configured order so "first listed" deterministically owns the org.
  users.sort(
    (a: any, b: any) =>
      emails.indexOf(String(a.email).toLowerCase()) -
      emails.indexOf(String(b.email).toLowerCase())
  )

  for (const user of users) {
    const roles = rolesOf(user)
    if (!roles.includes('admin')) {
      await db('users')
        .where({ id: user.id })
        .update({
          roles: JSON.stringify([...roles, 'admin']),
          updated_at: new Date(),
        })
      console.log('[rootOrgAdmin] promoted configured root admin %s', user.id)
    }

    // Migration 015 (security) backfills root memberships as `member`; a
    // configured root admin is an owner.
    await db.raw(
      `INSERT INTO organization_memberships
         (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
       VALUES (gen_random_uuid(), ?, ?, 'owner', 'active', NOW(), '{}'::jsonb, '{}'::jsonb)
       ON CONFLICT (user_id, organization_id)
       DO UPDATE SET role = 'owner', status = 'active'`,
      [user.id, ROOT_ORG_ID]
    )
  }

  if (users.length > 0) await adoptRootOrganizationOwner(db, users[0].id)
  return users.map((u: any) => u.id)
}

/**
 * Moves root-org ownership off `platform-registrar` (migration 015's
 * placeholder owner) to a real administrator. Never takes ownership away from a
 * human who already holds it.
 */
export async function adoptRootOrganizationOwner(
  db: Knex,
  userId: string
): Promise<boolean> {
  const updated = await db('organizations')
    .where({ id: ROOT_ORG_ID, owner_id: PLATFORM_REGISTRAR_ID })
    .update({ owner_id: userId, updated_at: new Date() })
  if (updated > 0) {
    console.log('[rootOrgAdmin] root organization ownership adopted by %s', userId)
  }
  return updated > 0
}

export interface RootOrgAdminDeps {
  db: Knex
  assignOrgAdmin: (userId: string, organizationId: string) => Promise<boolean>
  /** Defaults to the real `fuzefront.identity.employee-console` flag read.
   * Injectable so tests never need the flags package. */
  isEmployeeTriggerEnabled: () => Promise<boolean>
  /** Defaults to `PLATFORM_ROOT_ADMIN_EMAILS`. */
  rootAdminEmails: string[]
}

function getDeps(overrides?: Partial<RootOrgAdminDeps>): RootOrgAdminDeps {
  return {
    db: overrides?.db ?? defaultDb,
    assignOrgAdmin: overrides?.assignOrgAdmin ?? assignOrgAdminRebac,
    isEmployeeTriggerEnabled:
      overrides?.isEmployeeTriggerEnabled ??
      (() => isEmployeeConsoleEnabled()),
    rootAdminEmails: overrides?.rootAdminEmails ?? parseRootAdminEmails(),
  }
}

/**
 * Returns the ids of the users granted root `org-admin` (already-granted users
 * are included — the operation is idempotent, not a diff).
 */
export async function ensureRootOrgAdmins(
  overrides?: Partial<RootOrgAdminDeps>
): Promise<string[]> {
  const { db, assignOrgAdmin, isEmployeeTriggerEnabled, rootAdminEmails } =
    getDeps(overrides)

  // No root org yet (fresh install before any user exists) — nothing to grant
  // on. Self-heals on a later boot once migration 015 / ensureRootPortal seeds it.
  const rootOrg = await db('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!rootOrg) return []

  // Configured human root admins gain `admin` first, so the query below grants
  // them `org-admin` in the same pass.
  await promoteConfiguredRootAdmins(db, rootAdminEmails)

  // FF-EPIC-17-S8: flag OFF (default) keeps today's implicit-`admin`-only
  // trigger byte-identical. Flag ON additionally recognizes the explicit
  // `employee` marker — see the module doc above.
  const employeeTriggerEnabled = await isEmployeeTriggerEnabled()

  const admins = await db('users')
    .where((builder: Knex.QueryBuilder) => {
      builder.whereRaw(`roles::text LIKE ?`, ['%admin%'])
      if (employeeTriggerEnabled) {
        builder.orWhereRaw(`roles::text LIKE ?`, [`%${EMPLOYEE_USER_ROLE}%`])
      }
    })
    .whereNot({ id: PLATFORM_REGISTRAR_ID })

  const granted: string[] = []
  for (const admin of admins) {
    // One failure must not stop the rest: a single Permit hiccup should not
    // leave the other administrators ungranted until the next restart.
    try {
      const ok = await assignOrgAdmin(admin.id, ROOT_ORG_ID)
      if (ok) granted.push(admin.id)
    } catch (error) {
      // Constant format string + arguments: interpolating the id into the
      // format string itself lets a value containing format specifiers forge
      // the log line (Semgrep unsafe-formatstring).
      console.error(
        '[rootOrgAdmin] failed to grant org-admin to %s: %s',
        admin.id,
        error
      )
    }
  }

  return granted
}

/**
 * Promotes + grants ONLY the configured root administrators. Cheap enough to
 * run on an interval, so a configured admin's first login takes effect without
 * a backend restart (ensureRootOrgAdmins itself runs once, at boot).
 */
export async function ensureConfiguredRootAdmins(
  overrides?: Partial<RootOrgAdminDeps>
): Promise<string[]> {
  const { db, assignOrgAdmin, rootAdminEmails } = getDeps(overrides)
  const ids = await promoteConfiguredRootAdmins(db, rootAdminEmails)
  const granted: string[] = []
  for (const id of ids) {
    try {
      if (await assignOrgAdmin(id, ROOT_ORG_ID)) granted.push(id)
    } catch (error) {
      console.error('[rootOrgAdmin] failed to grant org-admin to %s: %s', id, error)
    }
  }
  return granted
}
