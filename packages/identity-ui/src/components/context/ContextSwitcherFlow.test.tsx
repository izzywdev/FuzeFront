import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextSwitcherFlow } from './ContextSwitcherFlow'
import type { OrgContextItem } from '../../types'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'
const organizations: OrgContextItem[] = [
  { id: ROOT_ID, name: 'FuzeFront', role: 'member', isRoot: true, parentId: null },
]

function baseProps(overrides: Partial<React.ComponentProps<typeof ContextSwitcherFlow>> = {}) {
  return {
    activeTarget: ROOT_ID,
    userName: 'Ada Rowe',
    organizations,
    rootOrgId: ROOT_ID,
    onSelect: vi.fn(),
    onCreateOrg: vi.fn().mockResolvedValue({ id: 'org_new', name: 'New Org' }),
    ...overrides,
  }
}

describe('ContextSwitcherFlow', () => {
  it('shows the pill closed by default and opens the menu on click', async () => {
    const user = userEvent.setup()
    render(<ContextSwitcherFlow {...baseProps()} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /fuzefront/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('calls onSelect and closes the menu when a row is picked', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<ContextSwitcherFlow {...props} />)
    await user.click(screen.getByRole('button', { name: /fuzefront/i }))
    await user.click(screen.getByRole('menuitemradio', { name: /ada rowe/i }))
    expect(props.onSelect).toHaveBeenCalledWith('personal')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders the provisioning state instead of the menu, and never flashes the switcher', async () => {
    const user = userEvent.setup()
    render(<ContextSwitcherFlow {...baseProps({ provisioning: true })} />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'provisioning')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders the error notice with retry when the org list failed to load', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ContextSwitcherFlow {...baseProps({ error: 'boom', onRetry })} />)
    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the fail-closed AccessLostNotice — never a sign-in redirect', async () => {
    const user = userEvent.setup()
    const onGoPersonal = vi.fn()
    render(<ContextSwitcherFlow {...baseProps({ accessLost: true, onGoPersonal })} />)
    await user.click(screen.getByRole('button'))
    const notice = screen.getByRole('alert')
    expect(notice).toHaveAttribute('data-error-code', 'ACCESS_LOST')
    await user.click(screen.getByRole('button', { name: /go to personal/i }))
    expect(onGoPersonal).toHaveBeenCalledTimes(1)
  })

  it('opens the create-organization dialog from the switcher footer', async () => {
    const user = userEvent.setup()
    render(<ContextSwitcherFlow {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: /fuzefront/i }))
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
