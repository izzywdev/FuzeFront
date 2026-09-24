import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MyOrganizationsFlow } from './MyOrganizationsFlow'
import type { OrgContextItem } from '../../types'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'
const organizations: OrgContextItem[] = [
  { id: ROOT_ID, name: 'FuzeFront', role: 'member', isRoot: true, parentId: null },
  { id: 'org_acme', name: 'Acme Co', role: 'viewer', parentId: null },
]

describe('MyOrganizationsFlow', () => {
  it('renders the page header and the org list', () => {
    render(
      <MyOrganizationsFlow
        organizations={organizations}
        rootOrgId={ROOT_ID}
        onOpenOrg={vi.fn()}
        onCreate={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: /your organizations/i })).toBeInTheDocument()
    expect(screen.getByText('Acme Co')).toBeInTheDocument()
  })

  it('opens the create-organization dialog from the header button', async () => {
    const user = userEvent.setup()
    render(
      <MyOrganizationsFlow
        organizations={organizations}
        rootOrgId={ROOT_ID}
        onOpenOrg={vi.fn()}
        onCreate={vi.fn().mockResolvedValue({ id: 'org_new', name: 'New Org' })}
      />
    )
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('hides the create-organization action when canCreate is false', () => {
    render(
      <MyOrganizationsFlow
        organizations={organizations}
        rootOrgId={ROOT_ID}
        onOpenOrg={vi.fn()}
        onCreate={vi.fn()}
        canCreate={false}
      />
    )
    expect(screen.queryByRole('button', { name: /create organization/i })).not.toBeInTheDocument()
  })

  it('forwards slugForName to the dialog so a non-Latin org name still yields a non-empty slug', async () => {
    // Regression: MyOrganizationsPage did not forward slugForName, so the
    // dialog's naive default slugged a Hebrew/Arabic/CJK name to '' and the
    // API rejected the create with 400 "Slug is required". The host now owns
    // the rule (org-<suffix> fallback) and it must reach the dialog.
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ id: 'org_new', name: 'ארגון' })
    render(
      <MyOrganizationsFlow
        organizations={organizations}
        rootOrgId={ROOT_ID}
        onOpenOrg={vi.fn()}
        onCreate={onCreate}
        slugForName={name => (/[a-z0-9]/i.test(name) ? name.toLowerCase() : 'org-zz99')}
      />
    )
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    await user.type(screen.getByLabelText(/name/i), 'ארגון')
    await user.click(screen.getByRole('button', { name: /^create organization$/i }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ name: 'ארגון', slug: 'org-zz99' })
    )
  })

  it('opens the newly created org after creation', async () => {
    const user = userEvent.setup()
    const onOpenOrg = vi.fn()
    const onCreate = vi.fn().mockResolvedValue({ id: 'org_new', name: 'New Org' })
    render(
      <MyOrganizationsFlow organizations={organizations} rootOrgId={ROOT_ID} onOpenOrg={onOpenOrg} onCreate={onCreate} />
    )
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    await user.type(screen.getByLabelText(/name/i), 'New Org')
    await user.click(screen.getByRole('button', { name: /^create organization$/i }))
    await waitFor(() => expect(onOpenOrg).toHaveBeenCalledWith('org_new'))
  })
})
