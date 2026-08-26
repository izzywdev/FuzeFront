import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateOrganizationDialog } from './CreateOrganizationDialog'

describe('CreateOrganizationDialog', () => {
  it('creates an org and calls onCreated + onClose', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ id: 'org_1', name: 'Northwind' })
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(
      <CreateOrganizationDialog open onClose={onClose} onCreate={onCreate} onCreated={onCreated} />
    )
    await user.type(screen.getByLabelText(/name/i), 'Northwind')
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'Northwind', slug: 'northwind' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'org_1', name: 'Northwind' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('renders NAME_TAKEN inline on the field, not a toast — the form is preserved', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue(new Error('NAME_TAKEN'))
    const onClose = vi.fn()
    render(<CreateOrganizationDialog open onClose={onClose} onCreate={onCreate} />)
    await user.type(screen.getByLabelText(/name/i), 'Northwind')
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument())
    // the dialog stays open with the typed value intact
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/name/i)).toHaveValue('Northwind')
  })

  it('requires a name before submitting', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<CreateOrganizationDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    expect(screen.getByText(/name is required/i)).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    render(<CreateOrganizationDialog open={false} onClose={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
