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

export interface RootOrgAdminDeps {
  db: Knex
  assignOrgAdmin: (userId: string, organizationId: string) => Promise<boolean>
  /** Defaults to the real `fuzefront.identity.employee-console` flag read.
   * Injectable so tests never need the flags package. */
  isEmployeeTriggerEnabled: () => Promise<boolean>
}

function getDeps(overrides?: Partial<RootOrgAdminDeps>): RootOrgAdminDeps {
  return {
    db: overrides?.db ?? defaultDb,
    assignOrgAdmin: overrides?.assignOrgAdmin ?? assignOrgAdminRebac,
    isEmployeeTriggerEnabled:
      overrides?.isEmployeeTriggerEnabled ??
      (() => isEmployeeConsoleEnabled()),
  }
}

/**
 * Returns the ids of the users granted root `org-admin` (already-granted users
 * are included — the operation is idempotent, not a diff).
 */
export async function ensureRootOrgAdmins(
  overrides?: Partial<RootOrgAdminDeps>
): Promise<string[]> {
  const { db, assignOrgAdmin, isEmployeeTriggerEnabled } = getDeps(overrides)

  // No root org yet (fresh install before any user exists) — nothing to grant
  // on. Self-heals on a later boot once migration 015 / ensureRootPortal seeds it.
  const rootOrg = await db('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!rootOrg) return []

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
