import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DirectoryRow } from './DirectoryRow'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { DirectoryMember } from '../../api/directoryClient'

function renderRow(member: DirectoryMember) {
  return render(
    <IdentityI18nProvider>
      <table>
        <tbody>
          <DirectoryRow member={member} />
        </tbody>
      </table>
    </IdentityI18nProvider>
  )
}

describe('DirectoryRow', () => {
  it('carries the data-user hook keyed to the server-minted userId', () => {
    renderRow({ userId: 'usr_1001', displayName: 'Ada Rowe', email: 'ada@ex.com', role: 'owner' })
    expect(document.querySelector('[data-user="usr_1001"]')).toBeInTheDocument()
  })

  it('renders the role pill from the server role, never hard-coded', () => {
    renderRow({ userId: 'usr_1002', displayName: 'Jae Moon', role: 'admin' })
    expect(document.querySelector('[data-role="admin"]')).toBeInTheDocument()
  })

  it('tags the caller\'s own row with data-self "You"', () => {
    renderRow({ userId: 'usr_1001', displayName: 'Ada Rowe', role: 'owner', isSelf: true })
    expect(document.querySelector('[data-self]')).toHaveTextContent('You')
  })

  it('does not render the You badge for other members', () => {
    renderRow({ userId: 'usr_1003', displayName: 'Lena Cruz', role: 'member', isSelf: false })
    expect(document.querySelector('[data-self]')).not.toBeInTheDocument()
  })

  it('falls back to an em dash when email is absent', () => {
    renderRow({ userId: 'usr_1004', displayName: 'No Email', role: 'viewer' })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
