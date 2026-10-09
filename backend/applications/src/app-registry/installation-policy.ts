export type DeclaredInstallMode = 'self' | 'everyone' | 'both'

/** Resolve organization policy while preserving manifests authored before this field existed. */
export function resolveOrganizationInstallMode(manifest: {
  organizationInstallMode?: DeclaredInstallMode
  installMode?: DeclaredInstallMode
  orgLevelOnly?: boolean
}): DeclaredInstallMode {
  if (manifest.organizationInstallMode) return manifest.organizationInstallMode
  if (manifest.orgLevelOnly || manifest.installMode === 'everyone')
    return 'everyone'
  return manifest.installMode ?? 'both'
}

export function organizationInstallModeAllows(
  declared: DeclaredInstallMode,
  requested: Exclude<DeclaredInstallMode, 'both'>
): boolean {
  return declared === 'both' || declared === requested
}
