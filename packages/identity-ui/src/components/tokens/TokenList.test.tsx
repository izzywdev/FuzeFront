import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TokenList } from './TokenList'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { ApiTokenSummary } from '../../types'

const base: ApiTokenSummary = {
  id: 't1',
  name: 'CI deploy',
  owner_type: 'user',
  owner_id: 'u1',
  token_prefix: 'abcdef',
  scopes: ['App:read', 'App:install'],
  expires_at: null,
  last_used_at: null,
}

function renderList(tokens: ApiTokenSummary[], onRevoke = vi.fn().mockResolvedValue(undefined)) {
  render(
    <IdentityI18nProvider>
      <TokenList tokens={tokens} onRevoke={onRevoke} />
    </IdentityI18nProvider>
  )
  return { onRevoke }
}

describe('TokenList', () => {
  it('renders the empty state when there are no tokens', () => {
    renderList([])
    expect(screen.getByText('No tokens yet')).toBeInTheDocument()
  })

  it('renders token rows with name and human scope labels', () => {
    renderList([base])
    expect(screen.getByText('CI deploy')).toBeInTheDocument()
    expect(screen.getByText('Read apps')).toBeInTheDocument()
    expect(screen.getByText('Install apps')).toBeInTheDocument()
  })

  it('marks tokens expiring soon with a warning indicator', () => {
    const soon = { ...base, id: 't2', expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }
    renderList([soon])
    expect(screen.getByText(/expires soon/i)).toBeInTheDocument()
  })

  it('opens the revoke dialog and confirms revocation', async () => {
    const { onRevoke } = renderList([base])
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    // confirm dialog appears
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const confirm = screen.getAllByRole('button', { name: /revoke/i }).pop()!
    fireEvent.click(confirm)
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith('t1'))
  })
})
