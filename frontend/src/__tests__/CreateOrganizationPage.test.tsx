import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CreateOrganizationPage from '../pages/CreateOrganizationPage'
import { AppProvider } from '../lib/shared'
import { LanguageProvider } from '../contexts/LanguageContext'
import * as api from '../services/api'

// Mock react-router-dom navigate (useNavigate)
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AppProvider>
          <CreateOrganizationPage />
        </AppProvider>
      </LanguageProvider>
    </MemoryRouter>
  )
}

describe('CreateOrganizationPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the organization name input', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /create organization/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument()
  })

  it('auto-derives slug from name', async () => {
    renderPage()
    const nameInput = screen.getByLabelText(/organization name/i)
    fireEvent.change(nameInput, { target: { value: 'My Cool Org' } })
    await waitFor(() => {
      const slugInput = screen.getByLabelText(/slug/i)
      expect((slugInput as HTMLInputElement).value).toBe('my-cool-org')
    })
  })

  it('strips non-alphanumeric characters from slug', async () => {
    renderPage()
    const nameInput = screen.getByLabelText(/organization name/i)
    fireEvent.change(nameInput, { target: { value: 'Hello & World!' } })
    await waitFor(() => {
      const slugInput = screen.getByLabelText(/slug/i)
      expect((slugInput as HTMLInputElement).value).toBe('hello-world')
    })
  })

  it('allows manual slug override', async () => {
    renderPage()
    const nameInput = screen.getByLabelText(/organization name/i)
    fireEvent.change(nameInput, { target: { value: 'Test Org' } })

    const slugInput = screen.getByLabelText(/slug/i)
    fireEvent.change(slugInput, { target: { value: 'custom-slug' } })

    // Change name again — slug should stay as manually entered
    fireEvent.change(nameInput, { target: { value: 'Test Org Updated' } })

    await waitFor(() => {
      expect((slugInput as HTMLInputElement).value).toBe('custom-slug')
    })
  })

  it('shows success state after org is created', async () => {
    vi.spyOn(api, 'createOrganization').mockResolvedValue({
      id: 'org-1',
      name: 'Test Org',
      slug: 'test-org',
      type: 'organization',
    })

    renderPage()
    const nameInput = screen.getByLabelText(/organization name/i)
    fireEvent.change(nameInput, { target: { value: 'Test Org' } })

    const submitBtn = screen.getByRole('button', { name: /create organization/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/success/i)).toBeInTheDocument()
    })
  })

  it('shows error when API call fails', async () => {
    vi.spyOn(api, 'createOrganization').mockRejectedValue({
      response: { data: { error: 'Slug already exists' } },
    })

    renderPage()
    const nameInput = screen.getByLabelText(/organization name/i)
    fireEvent.change(nameInput, { target: { value: 'Test Org' } })

    const submitBtn = screen.getByRole('button', { name: /create organization/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/slug already exists/i)).toBeInTheDocument()
    })
  })

  it('disables submit button when name is empty', () => {
    renderPage()
    const submitBtn = screen.getByRole('button', { name: /create organization/i })
    expect(submitBtn).toBeDisabled()
  })
})

