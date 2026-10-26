import {
  enforceOrgInstallMode,
  deriveGovernanceFromManifest,
  governanceColumns,
  APP_GOVERNANCE,
} from '../src/app-registry/app-governance'

describe('enforceOrgInstallMode — org-level-only rule', () => {
  it('forces an organization-scoped app to everyone by default', () => {
    expect(enforceOrgInstallMode('organization', undefined)).toBe('everyone')
    expect(enforceOrgInstallMode('organization', 'both')).toBe('everyone')
    expect(enforceOrgInstallMode('organization', null)).toBe('everyone')
  })

  it('lets an org app explicitly opt into per-member installs', () => {
    expect(enforceOrgInstallMode('organization', 'self')).toBe('self')
    expect(enforceOrgInstallMode('organization', 'everyone')).toBe('everyone')
  })

  it('leaves personal/both apps at their declared or default mode', () => {
    expect(enforceOrgInstallMode('both', undefined)).toBe('both')
    expect(enforceOrgInstallMode('personal', undefined)).toBe('both')
    expect(enforceOrgInstallMode('both', 'self')).toBe('self')
  })
})

describe('deriveGovernanceFromManifest', () => {
  it('maps organization visibility to org-only + everyone', () => {
    const g = deriveGovernanceFromManifest({ visibility: 'organization' })
    expect(g.scopeLevel).toBe('organization')
    expect(g.orgInstallMode).toBe('everyone')
    expect(g.personalRemovable).toBe(true) // defaults otherwise
    expect(g.systemApp).toBe(false)
  })

  it('maps a public app to both/both', () => {
    const g = deriveGovernanceFromManifest({ visibility: 'public' })
    expect(g.scopeLevel).toBe('both')
    expect(g.orgInstallMode).toBe('both')
  })

  it('honors an explicit orgLevelOnly manifest flag', () => {
    const g = deriveGovernanceFromManifest({
      scopeLevel: 'both',
      orgLevelOnly: true,
    })
    expect(g.orgInstallMode).toBe('everyone')
  })
})

describe('APP_GOVERNANCE seed matrix', () => {
  it('marks FuzeAgent a core personal default that cannot be removed', () => {
    const a = APP_GOVERNANCE.fuzeagent
    expect(a.scopeLevel).toBe('both')
    expect(a.defaultInstallPersonal).toBe(true)
    expect(a.personalRemovable).toBe(false)
    expect(a.systemApp).toBe(true)
  })

  it('makes the org-only products everyone-install', () => {
    for (const slug of ['contact', 'sales', 'service']) {
      expect(APP_GOVERNANCE[slug].scopeLevel).toBe('organization')
      expect(APP_GOVERNANCE[slug].orgInstallMode).toBe('everyone')
    }
  })

  it('default-installs fuzedeploy and fuzequality on personal', () => {
    expect(APP_GOVERNANCE.deploy.defaultInstallPersonal).toBe(true)
    expect(APP_GOVERNANCE.fuzequality.defaultInstallPersonal).toBe(true)
  })

  it('serializes to snake_case DB columns', () => {
    const cols = governanceColumns(APP_GOVERNANCE.fuzeagent)
    expect(cols.scope_level).toBe('both')
    expect(cols.personal_removable).toBe(false)
    expect(cols.default_install_personal).toBe(true)
    expect(cols.system_app).toBe(true)
  })
})
