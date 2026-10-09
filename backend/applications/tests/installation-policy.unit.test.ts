import {
  organizationInstallModeAllows,
  resolveOrganizationInstallMode,
} from '../src/app-registry/installation-policy'

describe('organization installation policy', () => {
  it('locks only organization installs without removing personal eligibility', () => {
    const declared = resolveOrganizationInstallMode({
      installMode: 'both',
      organizationInstallMode: 'everyone',
    })

    expect(declared).toBe('everyone')
    expect(organizationInstallModeAllows(declared, 'everyone')).toBe(true)
    expect(organizationInstallModeAllows(declared, 'self')).toBe(false)
  })

  it('keeps legacy organization-only manifests compatible', () => {
    expect(resolveOrganizationInstallMode({ orgLevelOnly: true })).toBe(
      'everyone'
    )
    expect(resolveOrganizationInstallMode({ installMode: 'everyone' })).toBe(
      'everyone'
    )
  })

  it('leaves ordinary manifests open to either organization mode', () => {
    const declared = resolveOrganizationInstallMode({})
    expect(organizationInstallModeAllows(declared, 'self')).toBe(true)
    expect(organizationInstallModeAllows(declared, 'everyone')).toBe(true)
  })
})
