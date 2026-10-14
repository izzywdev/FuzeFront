export type DeclaredInstallMode = 'self' | 'everyone' | 'both'

/** Resolve the mode offered for an organization without changing personal installs. */
export function resolveOrganizationInstallMode({
  organizationInstallMode,
  installMode,
  orgLevelOnly,
}: {
  organizationInstallMode?: DeclaredInstallMode
  installMode?: DeclaredInstallMode
  orgLevelOnly?: boolean
}): DeclaredInstallMode {
  if (organizationInstallMode) return organizationInstallMode
  if (orgLevelOnly) return 'everyone'
  return installMode ?? 'both'
}
