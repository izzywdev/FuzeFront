import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { KeyDefinition, Paged } from '@fuzefront/config-client'
import { ConfigI18nProvider } from '../../i18n/ConfigI18nProvider'
import { ConfigKeyCatalogFlow, type ConfigKeyCatalogFlowProps } from './ConfigKeyCatalogFlow'

function def(overrides: Partial<KeyDefinition> = {}): KeyDefinition {
  return {
    id: 'ckd_1',
    key: 'notifications.digest.frequency',
    displayName: 'Digest frequency',
    valueType: 'enum',
    defaultValue: 'daily',
    allowedScopes: ['platform', 'portal', 'org', 'user'],
    isSystem: false,
    isHidden: false,
    isSecret: false,
    isReadonly: false,
    precedence: 'most-specific-wins',
    requiresRestart: false,
    ...overrides,
  }
}

const hiddenDef = def({
  id: 'ckd_hidden',
  key: 'notifications.internal.shardKey',
  displayName: 'Internal shard key',
  isSystem: true,
  isHidden: true,
})

function page(items: KeyDefinition[], hasNextPage = false): Paged<KeyDefinition> {
  return { items, pageInfo: { hasNextPage, nextCursor: hasNextPage ? 'cursor_2' : null } }
}

function baseProps(overrides: Partial<ConfigKeyCatalogFlowProps> = {}): ConfigKeyCatalogFlowProps {
  return {
    namespace: 'notifications',
    page: page([def(), hiddenDef]),
    search: '',
    filter: 'all',
    onSearchChange: vi.fn(),
    onFilterChange: vi.fn(),
    onOpenDefinition: vi.fn(),
    ...overrides,
  }
}

function renderFlow(overrides: Partial<ConfigKeyCatalogFlowProps> = {}) {
  const props = baseProps(overrides)
  render(
    <ConfigI18nProvider>
      <ConfigKeyCatalogFlow {...props} />
    </ConfigI18nProvider>
  )
  return props
}

describe('<ConfigKeyCatalogFlow>', () => {
  it('is the one surface that renders isHidden key definitions', () => {
    renderFlow()
    const row = document.querySelector('[data-catalog-row="notifications.internal.shardKey"]')
    expect(row).not.toBeNull()
    expect(row?.getAttribute('data-hidden-key')).toBe('true')
  })

  it('forbidden is fail-closed — no row data reaches the DOM at all', () => {
    renderFlow({ forbidden: true, page: null })
    expect(screen.getByText(/do not have access to the key catalog/i)).toBeInTheDocument()
    expect(document.querySelector('[data-catalog-row]')).toBeNull()
  })

  it('renders the no-namespaces first-run state distinctly', () => {
    render(
      <ConfigI18nProvider>
        <ConfigKeyCatalogFlow {...baseProps({ noNamespaces: true, page: null })} />
      </ConfigI18nProvider>
    )
    expect(screen.getByText(/no namespaces registered/i)).toBeInTheDocument()
  })

  it('empty-keys is distinct from no-results — an empty catalog with no search is never presented as "no matches"', () => {
    render(
      <ConfigI18nProvider>
        <ConfigKeyCatalogFlow {...baseProps({ page: page([]) })} />
      </ConfigI18nProvider>
    )
    expect(screen.getByText(/no keys declared/i)).toBeInTheDocument()
    expect(screen.queryByText(/no keys match/i)).not.toBeInTheDocument()
  })

  it('no-results is reachable only via an active search/filter, and offers to clear them', () => {
    render(
      <ConfigI18nProvider>
        <ConfigKeyCatalogFlow {...baseProps({ page: page([]), search: 'zzz' })} />
      </ConfigI18nProvider>
    )
    expect(screen.getByText(/no keys match/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()
  })

  it('calls onLoadMore with the page nextCursor, never re-fetching from scratch', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    renderFlow({ page: page([def()], true), onLoadMore })
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(onLoadMore).toHaveBeenCalledWith('cursor_2')
  })

  it('disables Next when hasNextPage is false', () => {
    renderFlow({ page: page([def()], false) })
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('opens a definition via onOpenDefinition, not a hardcoded navigation', async () => {
    const user = userEvent.setup()
    const onOpenDefinition = vi.fn()
    renderFlow({ onOpenDefinition })
    await user.click(screen.getByText('notifications.digest.frequency'))
    expect(onOpenDefinition).toHaveBeenCalledWith('notifications.digest.frequency')
  })
})
