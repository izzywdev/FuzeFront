/**
 * App-registry governance policy — the DB-authoritative, operator-managed
 * settings for an app, kept separate from the app-owned manifest a product
 * re-pushes on every self-registration.
 *
 * The map below is the INITIAL seed for the named products only: migration 020
 * applies it to rows that already exist, and `upsertBuiltin` applies it when a
 * built-in is first created. After that, these fields live in the database and
 * are changed via the API / admin UI — never re-clobbered by self-registration
 * (see service.updateManifest, which no longer writes governance columns).
 *
 * Scope matrix (owner-specified, 2026-10):
 *   fuzedeploy  personal+org, default-install to every new user
 *   fuzecontact org only, install for everyone
 *   fuzeagent   personal+org, default-install, CORE on personal (not removable)
 *   fuzequality personal+org, default-install on personal
 *   fuzesales   org only (everyone)
 *   fuzeservice org only (everyone)
 *   fuzex       personal+org
 */
export type ScopeLevel = 'personal' | 'organization' | 'both'
export type OrgInstallMode = 'self' | 'everyone' | 'both'

export interface AppGovernance {
  scopeLevel: ScopeLevel
  /** Org-context install mode. Enforced: an org-only app is 'everyone'. */
  orgInstallMode: OrgInstallMode
  /** false = cannot be uninstalled from a personal space (core/system). */
  personalRemovable: boolean
  /** false = cannot be uninstalled from an org by its admins. */
  orgRemovable: boolean
  /** platform-managed/core app (intent + display). */
  systemApp: boolean
  /** auto-installed for every user (personal/self). */
  defaultInstallPersonal: boolean
  /** auto-installed for every org (org/everyone). */
  defaultInstallOrg: boolean
}

export const GOVERNANCE_DEFAULTS: AppGovernance = {
  scopeLevel: 'both',
  orgInstallMode: 'both',
  personalRemovable: true,
  orgRemovable: true,
  systemApp: false,
  defaultInstallPersonal: false,
  defaultInstallOrg: false,
}

/** Per-slug initial governance. Absent slugs use GOVERNANCE_DEFAULTS. */
export const APP_GOVERNANCE: Record<string, AppGovernance> = {
  fuzedeploy: {
    scopeLevel: 'both',
    orgInstallMode: 'both',
    personalRemovable: true,
    orgRemovable: true,
    systemApp: false,
    defaultInstallPersonal: true,
    defaultInstallOrg: false,
  },
  fuzecontact: {
    scopeLevel: 'organization',
    orgInstallMode: 'everyone',
    personalRemovable: true,
    orgRemovable: true,
    systemApp: false,
    defaultInstallPersonal: false,
    defaultInstallOrg: false,
  },
  fuzeagent: {
    scopeLevel: 'both',
    orgInstallMode: 'both',
    personalRemovable: false, // core product — cannot be removed from personal
    orgRemovable: true,
    systemApp: true,
    defaultInstallPersonal: true,
    defaultInstallOrg: false,
  },
  fuzequality: {
    scopeLevel: 'both',
    orgInstallMode: 'both',
    personalRemovable: true,
    orgRemovable: true,
    systemApp: false,
    defaultInstallPersonal: true,
    defaultInstallOrg: false,
  },
  fuzesales: {
    scopeLevel: 'organization',
    orgInstallMode: 'everyone',
    personalRemovable: true,
    orgRemovable: true,
    systemApp: false,
    defaultInstallPersonal: false,
    defaultInstallOrg: false,
  },
  fuzeservice: {
    scopeLevel: 'organization',
    orgInstallMode: 'everyone',
    personalRemovable: true,
    orgRemovable: true,
    systemApp: false,
    defaultInstallPersonal: false,
    defaultInstallOrg: false,
  },
  fuzex: {
    scopeLevel: 'both',
    orgInstallMode: 'both',
    personalRemovable: true,
    orgRemovable: true,
    systemApp: false,
    defaultInstallPersonal: false,
    defaultInstallOrg: false,
  },
}

/**
 * The org-level-only enforcement, applied at create/seed time so the stored
 * value is already correct and the install path just reads the column:
 * an organization-scoped app is whole-org by definition → 'everyone', unless an
 * explicit non-default org mode was declared.
 */
export function enforceOrgInstallMode(
  scopeLevel: ScopeLevel,
  declared?: OrgInstallMode | null
): OrgInstallMode {
  if (declared === 'self' || declared === 'everyone') return declared
  if (scopeLevel === 'organization') return 'everyone'
  return declared ?? 'both'
}

/**
 * Governance for an app NOT in APP_GOVERNANCE — derived from its manifest's
 * intent (scope + org-install hints), with safe defaults for the rest. Used when
 * creating a built-in that has no explicit policy (e.g. clock, fuzesocial).
 */
export function deriveGovernanceFromManifest(manifest: {
  scopeLevel?: ScopeLevel
  requiresOrgContext?: boolean
  visibility?: string
  orgLevelOnly?: boolean
  installMode?: OrgInstallMode
  organizationInstallMode?: OrgInstallMode
}): AppGovernance {
  const scopeLevel: ScopeLevel =
    manifest.scopeLevel ??
    (manifest.requiresOrgContext || manifest.visibility === 'organization'
      ? 'organization'
      : 'both')
  const declared =
    manifest.organizationInstallMode ??
    (manifest.orgLevelOnly || manifest.installMode === 'everyone'
      ? 'everyone'
      : manifest.installMode)
  return {
    ...GOVERNANCE_DEFAULTS,
    scopeLevel,
    orgInstallMode: enforceOrgInstallMode(scopeLevel, declared),
  }
}

/** DB columns for a governance record (snake_case), for inserts/updates. */
export function governanceColumns(g: AppGovernance): Record<string, unknown> {
  return {
    scope_level: g.scopeLevel,
    org_install_mode: g.orgInstallMode,
    personal_removable: g.personalRemovable,
    org_removable: g.orgRemovable,
    system_app: g.systemApp,
    default_install_personal: g.defaultInstallPersonal,
    default_install_org: g.defaultInstallOrg,
  }
}
