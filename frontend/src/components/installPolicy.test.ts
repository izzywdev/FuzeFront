import { describe, expect, it } from 'vitest'
import { resolveOrganizationInstallMode } from './installPolicy'

describe('resolveOrganizationInstallMode', () => {
  it('keeps a both-scope app personal while locking organization installs to everyone', () => {
    expect(
      resolveOrganizationInstallMode({
        installMode: 'both',
        organizationInstallMode: 'everyone',
      })
    ).toBe('everyone')
  })

  it('preserves legacy org-level-only manifests', () => {
    expect(resolveOrganizationInstallMode({ orgLevelOnly: true })).toBe(
      'everyone'
    )
  })

  it('defaults ordinary apps to both organization modes', () => {
    expect(resolveOrganizationInstallMode({})).toBe('both')
  })
})
