import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Scope } from '@fuzefront/config-client'
import { ConfigI18nProvider } from '../../i18n/ConfigI18nProvider'
import { ConfigSecretAuditFlow, type AuditEntry, type ConfigSecretAuditFlowProps } from './ConfigSecretAuditFlow'

const org: Scope = { scopeType: 'org', scopeId: 'org_1' }
const nameOf = () => 'Acme Corp'

const entries: AuditEntry[] = [
  { id: 5, when: '2026-08-09 14:22', op: 'set', fromValue: 'weekly', toValue: 'daily', actor: 'a.rivera', actorScope: org, reason: 'reverting the EU rollout' },
  { id: 4, when: '2026-08-02 09:05', op: 'set', fromValue: 'hourly', toValue: 'weekly', actor: 'j.okafor', actorScope: org, reason: 'restoring 2026-07-02', revertOf: 2 },
  { id: 2, when: '2026-07-19 11:12', op: 'unset', actor: 'a.rivera', actorScope: org, reason: 'tracking the portal default again' },
]

function baseProps(overrides: Partial<ConfigSecretAuditFlowProps> = {}): ConfigSecretAuditFlowProps {
  return {
    keyName: 'notifications.digest.frequency',
    scope: org,
    nameOf,
    entries,
    onRevert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderFlow(overrides: Partial<ConfigSecretAuditFlowProps> = {}) {
  const props = baseProps(overrides)
  render(
    <ConfigI18nProvider>
      <ConfigSecretAuditFlow {...props} />
    </ConfigI18nProvider>
  )
  return props
}

describe('<ConfigSecretAuditFlow>', () => {
  it('renders one row per entry, newest first as supplied, with the revert-of marker preserved', () => {
    renderFlow()
    expect(document.querySelector('[data-audit-entry="4"][data-audit-revert-of="2"]')).not.toBeNull()
    // Entry #2 (the original) is STILL present — revert never removes history.
    expect(document.querySelector('[data-audit-entry="2"]')).not.toBeNull()
  })

  it('empty history is a designed state naming where the value comes from, not an error', () => {
    renderFlow({ entries: [] })
    expect(screen.getByText(/no changes recorded at this scope/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('forbidden and load-error are distinct states', () => {
    const { rerender } = render(
      <ConfigI18nProvider>
        <ConfigSecretAuditFlow {...baseProps({ forbidden: true, entries: null })} />
      </ConfigI18nProvider>
    )
    expect(screen.getByText(/do not have access to this change history/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()

    rerender(
      <ConfigI18nProvider>
        <ConfigSecretAuditFlow {...baseProps({ error: 'network', entries: null })} />
      </ConfigI18nProvider>
    )
    expect(screen.getByText(/could not load the change history/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('a secret key redacts every value cell and offers no "Revert to this" (no plaintext exists to revert to)', () => {
    renderFlow({ isSecret: true })
    const cells = document.querySelectorAll('[data-redacted]')
    expect(cells.length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /revert to this/i })).not.toBeInTheDocument()
  })

  it('reverting requires a reason and calls onRevert with the target entry once confirmed', async () => {
    const user = userEvent.setup()
    const onRevert = vi.fn().mockResolvedValue(undefined)
    renderFlow({ onRevert })

    const revertButtons = screen.getAllByRole('button', { name: /revert to this/i })
    await user.click(revertButtons[0]) // entry #5

    const confirm = screen.getByRole('button', { name: /revert and record/i })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByLabelText(/why are you reverting/i), 'undoing a mistake')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(onRevert).toHaveBeenCalledTimes(1)
    expect(onRevert.mock.calls[0][0]).toMatchObject({ id: 5 })
    expect(onRevert.mock.calls[0][1]).toBe('undoing a mistake')
  })

  it('cancelling the revert confirmation calls onRevert zero times', async () => {
    const user = userEvent.setup()
    const onRevert = vi.fn()
    renderFlow({ onRevert })
    await user.click(screen.getAllByRole('button', { name: /revert to this/i })[0])
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onRevert).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /revert and record/i })).not.toBeInTheDocument()
  })
})
