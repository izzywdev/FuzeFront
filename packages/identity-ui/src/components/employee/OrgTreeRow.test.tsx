import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrgTreeRow } from './OrgTreeRow'

function renderRow(org: Parameters<typeof OrgTreeRow>[0]['org'], onSelect = vi.fn()) {
  return render(
    <table>
      <tbody>
        <OrgTreeRow org={org} onSelect={onSelect} />
      </tbody>
    </table>
  )
}

describe('OrgTreeRow', () => {
  it('renders the root row with the root access label and data-org', () => {
    renderRow({ id: 'root-id', name: 'FuzeFront', kind: 'root', memberCount: 2481 })
    const row = document.querySelector('[data-org="root-id"]')
    expect(row).toBeInTheDocument()
    expect(screen.getByText('FuzeFront')).toBeInTheDocument()
    expect(screen.getByText(/org-admin · root/i)).toBeInTheDocument()
    expect(screen.getByText('2481')).toBeInTheDocument()
  })

  it('renders a sub-org row with the nested arrow prefix and generic derived label', () => {
    renderRow({ id: 'org_nw_sales', name: 'Sales', kind: 'sub-org' })
    expect(screen.getByText('↳ Sales')).toBeInTheDocument()
    expect(screen.getByText(/derived from root/i)).toBeInTheDocument()
  })

  it('renders an unknown member count as a dash, never fabricated', () => {
    renderRow({ id: 'org_acme', name: 'Acme Co', kind: 'org' })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('calls onSelect with the org id when clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderRow({ id: 'org_acme', name: 'Acme Co', kind: 'org' }, onSelect)
    await user.click(screen.getByRole('button', { name: /acme co/i }))
    expect(onSelect).toHaveBeenCalledWith('org_acme')
  })
})
