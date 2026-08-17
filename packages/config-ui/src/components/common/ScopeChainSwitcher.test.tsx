import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Scope } from '@fuzefront/config-client'
import { ScopeChainSwitcher } from './ScopeChainSwitcher'

const platform: Scope = { scopeType: 'platform' }
const portal: Scope = { scopeType: 'portal', scopeId: 'portal_1' }
const org: Scope = { scopeType: 'org', scopeId: 'org_1' }
const user: Scope = { scopeType: 'user', scopeId: 'user_1' }

const chain = [
  { scope: platform, name: 'FuzeFront' },
  { scope: portal, name: 'Acme Portal' },
  { scope: org, name: 'Acme Corp' },
  { scope: user, name: 'You' },
]

describe('<ScopeChainSwitcher>', () => {
  it('renders all four tiers with the edited scope marked current', () => {
    render(<ScopeChainSwitcher chain={chain} activeScope={org} />)
    for (const step of chain) expect(screen.getByText(step.name)).toBeInTheDocument()
    expect(screen.getByText('Acme Corp').closest('[aria-current="true"]')).not.toBeNull()
    expect(screen.getByText('You').closest('[aria-current="true"]')).toBeNull()
  })

  it('calls onSelect with the picked scope', async () => {
    const userEv = userEvent.setup()
    const onSelect = vi.fn()
    render(<ScopeChainSwitcher chain={chain} activeScope={org} onSelect={onSelect} />)
    await userEv.click(screen.getByText('Acme Portal'))
    expect(onSelect).toHaveBeenCalledWith(portal)
  })

  it('renders the namespace and version badges when supplied', () => {
    render(<ScopeChainSwitcher chain={chain} activeScope={org} namespace="notifications" version="v-42" />)
    expect(screen.getByText(/notifications/)).toBeInTheDocument()
    expect(screen.getByText(/v-42/)).toBeInTheDocument()
  })
})
