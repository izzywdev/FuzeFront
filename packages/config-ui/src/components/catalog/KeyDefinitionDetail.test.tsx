import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { KeyDefinition, Scope } from '@fuzefront/config-client'
import { ConfigI18nProvider } from '../../i18n/ConfigI18nProvider'
import { KeyDefinitionDetail } from './KeyDefinitionDetail'

const platform: Scope = { scopeType: 'platform' }
const portal: Scope = { scopeType: 'portal', scopeId: 'portal_1' }
const org: Scope = { scopeType: 'org', scopeId: 'org_1' }
const user: Scope = { scopeType: 'user', scopeId: 'user_1' }
const nameOf = (s: Scope) => (s.scopeType === 'platform' ? 'FuzeFront' : s.scopeType === 'portal' ? 'Acme Portal' : s.scopeType === 'org' ? 'Acme Corp' : 'You')

const def: KeyDefinition = {
  id: 'ckd_1',
  key: 'notifications.digest.frequency',
  displayName: 'Digest frequency',
  valueType: 'enum',
  enumValues: ['hourly', 'daily', 'weekly'],
  defaultValue: 'daily',
  allowedScopes: ['platform', 'portal', 'org', 'user'],
  isSystem: false,
  isHidden: false,
  isSecret: false,
  isReadonly: false,
  precedence: 'most-specific-wins',
  requiresRestart: true,
}

function renderDetail(chain: Parameters<typeof KeyDefinitionDetail>[0]['chain']) {
  render(
    <ConfigI18nProvider>
      <KeyDefinitionDetail definition={def} chain={chain} nameOf={nameOf} />
    </ConfigI18nProvider>
  )
}

describe('<KeyDefinitionDetail>', () => {
  it('marks exactly the effective step, and shows the diverging override', () => {
    renderDetail([
      { scope: platform, value: 'daily' },
      { scope: portal, value: 'weekly' },
      { scope: org, value: 'daily', effective: true },
      { scope: user },
    ])
    const orgStep = document.querySelector('[data-chain-step="org"]')
    expect(orgStep?.getAttribute('data-chain-effective')).toBe('true')
    const portalStep = document.querySelector('[data-chain-step="portal"]')
    expect(portalStep?.getAttribute('data-chain-effective')).toBeNull()
  })

  it('renders a designed no-divergence answer, not an empty table, when nothing overrides the default', () => {
    renderDetail([
      { scope: platform, effective: true },
      { scope: portal },
      { scope: org },
      { scope: user },
    ])
    expect(screen.getByText(/no overrides anywhere/i)).toBeInTheDocument()
    expect(document.querySelector('[data-resolution-chain]')).toBeNull()
  })

  it('marks scopes beneath a lock as blocked/unreachable, not merely "no override"', () => {
    renderDetail([
      { scope: platform, value: 'daily' },
      { scope: portal, value: 'false', effective: true, locked: true, lockReason: 'incident window' },
      { scope: org, blocked: true },
      { scope: user, blocked: true },
    ])
    const org2 = document.querySelector('[data-chain-step="org"]')
    expect(org2?.getAttribute('data-chain-blocked')).toBe('true')
    expect(screen.getByText(/incident window/)).toBeInTheDocument()
  })
})
