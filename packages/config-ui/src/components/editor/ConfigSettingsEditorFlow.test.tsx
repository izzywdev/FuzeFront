import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigApiError } from '@fuzefront/config-client'
import type { EffectiveConfigEntry, KeyDefinition, Scope } from '@fuzefront/config-client'
import { ConfigI18nProvider } from '../../i18n/ConfigI18nProvider'
import { ConfigSettingsEditorFlow, type ConfigSettingsEditorFlowProps } from './ConfigSettingsEditorFlow'

const platform: Scope = { scopeType: 'platform' }
const portal: Scope = { scopeType: 'portal', scopeId: 'portal_1' }
const org: Scope = { scopeType: 'org', scopeId: 'org_1' }

const chain = [
  { scope: platform, name: 'FuzeFront' },
  { scope: portal, name: 'Acme Portal' },
  { scope: org, name: 'Acme Corp' },
]

function def(overrides: Partial<KeyDefinition> = {}): KeyDefinition {
  return {
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
    requiresRestart: false,
    category: 'Delivery',
    ...overrides,
  }
}

const setEntry: EffectiveConfigEntry = {
  key: 'notifications.digest.frequency',
  value: 'daily',
  source: org,
  locked: false,
  editable: true,
  definition: def(),
}

const inheritedEntry: EffectiveConfigEntry = {
  key: 'notifications.digest.enabled',
  value: true,
  source: portal,
  locked: false,
  editable: true,
  definition: def({
    id: 'ckd_2',
    key: 'notifications.digest.enabled',
    displayName: 'Batch notifications',
    valueType: 'boolean',
    enumValues: undefined,
    defaultValue: true,
  }),
}

const secretEntry: EffectiveConfigEntry = {
  key: 'notifications.provider.apiKey',
  value: null,
  isSet: true,
  source: org,
  locked: false,
  editable: true,
  definition: def({
    id: 'ckd_3',
    key: 'notifications.provider.apiKey',
    displayName: 'Provider API key',
    valueType: 'secret',
    enumValues: undefined,
    isSecret: true,
    category: 'Credentials',
  }),
}

function baseProps(overrides: Partial<ConfigSettingsEditorFlowProps> = {}): ConfigSettingsEditorFlowProps {
  return {
    chain,
    activeScope: org,
    namespace: 'notifications',
    version: 'v-1',
    entries: [setEntry, inheritedEntry, secretEntry],
    nameOf: (scope: Scope) => chain.find(s => s.scope.scopeType === scope.scopeType)?.name ?? scope.scopeId ?? '?',
    parentValueOf: () => ({ scope: portal, value: 'weekly' }),
    onSubmit: vi.fn().mockResolvedValue({ namespace: 'notifications', scope: org, version: 'v-2', applied: [] }),
    onReRead: vi.fn(),
    onSecretWrite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderFlow(props: Partial<ConfigSettingsEditorFlowProps> = {}) {
  const merged = baseProps(props)
  render(
    <ConfigI18nProvider>
      <ConfigSettingsEditorFlow {...merged} />
    </ConfigI18nProvider>
  )
  return merged
}

describe('<ConfigSettingsEditorFlow>', () => {
  it('renders every entry passed with no client-side filtering — the component has no isHidden predicate at all', () => {
    renderFlow()
    expect(screen.getByText('Digest frequency')).toBeInTheDocument()
    expect(screen.getByText('Batch notifications')).toBeInTheDocument()
    expect(screen.getByText('Provider API key')).toBeInTheDocument()
  })

  it('an empty entries array is a legitimate 200 (empty-namespace), never an error banner', () => {
    renderFlow({ entries: [] })
    expect(screen.getByText(/no settings in this namespace/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('entries === null (loading) renders a skeleton, not empty/error', () => {
    const { container } = render(
      <ConfigI18nProvider>
        <ConfigSettingsEditorFlow {...baseProps({ entries: null, loading: true })} />
      </ConfigI18nProvider>
    )
    expect(container.querySelector('[data-loading][aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText(/no settings in this namespace/i)).not.toBeInTheDocument()
  })

  it('a load error renders a retry action and no editable form', () => {
    renderFlow({ entries: null, error: 'boom' })
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('forbidden renders in place with no partial data', () => {
    renderFlow({ forbidden: true, entries: null })
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument()
  })

  it('Reset > Unset stages a change that saves as {op:"unset"} only', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue({ namespace: 'notifications', scope: org, version: 'v-2', applied: [] })
    renderFlow({ onSubmit })

    await user.click(screen.getByRole('button', { name: /reset/i }))
    await user.click(screen.getByRole('menuitem', { name: /unset/i }))
    await user.click(screen.getByText(/save 1 change/i))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const call = onSubmit.mock.calls[0][0]
    expect(call.operations).toEqual([{ key: 'notifications.digest.frequency', op: 'unset' }])
    expect(call.expectedVersion).toBe('v-1')
  })

  it('Reset > Pin stages a {op:"set", value: parent value} change — never the same op as unset', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue({ namespace: 'notifications', scope: org, version: 'v-2', applied: [] })
    renderFlow({ onSubmit })

    await user.click(screen.getByRole('button', { name: /reset/i }))
    await user.click(screen.getByRole('menuitem', { name: /pin/i }))
    await user.click(screen.getByText(/save 1 change/i))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const ops = onSubmit.mock.calls[0][0].operations
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({ key: 'notifications.digest.frequency', op: 'set', value: 'weekly' }) // the PARENT's value, from parentValueOf — never a guess
  })

  it('offers Unset only (never a guessed pin value) when the host has not supplied parentValueOf', () => {
    renderFlow({ parentValueOf: undefined })
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^unset$/i })).toBeInTheDocument()
    expect(screen.queryByText(/pin the parent/i)).not.toBeInTheDocument()
  })

  it('VERSION_CONFLICT re-reads and renders per-key resolution — never a silent automatic retry', async () => {
    const user = userEvent.setup()
    const conflictError = new ConfigApiError(409, 'VERSION_CONFLICT', 'stale', { code: 'VERSION_CONFLICT', message: 'stale', currentVersion: 'v-5' })
    const onSubmit = vi.fn().mockRejectedValue(conflictError)
    const onReRead = vi.fn().mockResolvedValue({
      version: 'v-5',
      entries: [{ ...setEntry, value: 'weekly', source: portal }, inheritedEntry, secretEntry],
    })
    renderFlow({ onSubmit, onReRead })

    await user.click(screen.getByRole('button', { name: /reset/i }))
    await user.click(screen.getByRole('menuitem', { name: /pin/i }))
    await user.click(screen.getByText(/save 1 change/i))

    expect(await screen.findByText(/settings changed while you were editing/i)).toBeInTheDocument()
    expect(onReRead).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1) // no automatic re-submit
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
  })

  it('a VALIDATION_ERROR failure keeps the pending change staged — nothing is silently discarded', async () => {
    const user = userEvent.setup()
    const validationError = new ConfigApiError(422, 'VALIDATION_ERROR', 'invalid', {
      code: 'VALIDATION_ERROR',
      message: 'invalid',
      details: [{ key: 'notifications.digest.frequency', message: 'not allowed' }],
    })
    const onSubmit = vi.fn().mockRejectedValue(validationError)
    renderFlow({ onSubmit })

    await user.click(screen.getByRole('button', { name: /reset/i }))
    await user.click(screen.getByRole('menuitem', { name: /pin/i }))
    await user.click(screen.getByText(/save 1 change/i))

    expect(await screen.findByText(/not allowed/i)).toBeInTheDocument()
    // The dirty count is still 1 — the staged change was not dropped by the failed save.
    expect(screen.getByText(/save 1 change/i)).toBeInTheDocument()
  })

  it('secret Replace calls onSecretWrite directly and is NOT part of the bulk save batch', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onSecretWrite = vi.fn().mockResolvedValue(undefined)
    renderFlow({ onSubmit, onSecretWrite })

    const secretRow = screen.getByText('Provider API key').closest('[data-entry]') as HTMLElement
    await user.click(within(secretRow).getByRole('button', { name: /replace/i }))
    await user.type(within(secretRow).getByPlaceholderText(/paste the new value/i), 'sk_new')
    await user.click(within(secretRow).getByRole('button', { name: /save/i }))

    expect(onSecretWrite).toHaveBeenCalledWith('notifications.provider.apiKey', 'set', 'sk_new')
    expect(onSubmit).not.toHaveBeenCalled()
    // No dirty count bumped by the secret write.
    expect(screen.queryByText(/save 1 change/i)).not.toBeInTheDocument()
  })
})
