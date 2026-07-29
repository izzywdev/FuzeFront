import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OrganizationSelector } from '../components/OrganizationSelector'
import {
  deriveSlug,
  organizationErrorMessage,
  slugForName,
} from '../utils/organization'

const apiMocks = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  createOrganization: vi.fn(),
}))

// Mock the whole api module: importing it for real fires an axios connectivity
// probe at module load that never settles under jsdom, which leaves the
// selector stuck on its loading skeleton.
vi.mock('../services/api', () => apiMocks)

/**
 * Regression cover for "create organization is not working in the UI".
 *
 * Every entry point posted `{ name, description, type: 'team' }` — no slug, and
 * a type outside `organization_type_enum` — so POST /api/organizations answered
 * 400 "Validation failed" on every attempt, and the UI swallowed it.
 */

// The returned object must be referentially STABLE: OrganizationSelector's load
// effect keys on [user, isAuthenticated], so a fresh literal per render would
// re-trigger the fetch forever and pin the component on its loading skeleton.
const currentUser = vi.hoisted(() => ({
  user: { id: 'u1', email: 'a@b.c' },
  isAuthenticated: true,
}))

vi.mock('../lib/shared', () => ({
  useCurrentUser: () => currentUser,
}))

vi.mock('../components/PermissionGate', () => ({
  usePermissions: () => ({ hasPermission: async () => true }),
  PermissionGate: ({ children }: any) => children,
}))

async function openCreateModal() {
  render(<OrganizationSelector />)
  // Wait for the initial org load to settle so the selector renders.
  const toggle = await screen.findByRole('button', {
    name: /select organization|acme/i,
  })
  fireEvent.click(toggle)
  fireEvent.click(await screen.findByRole('button', { name: /create organization/i }))
}

describe('organization slug helpers', () => {
  it('slugifies a display name', () => {
    expect(deriveSlug('My Cool Org')).toBe('my-cool-org')
    expect(deriveSlug('Hello & World!')).toBe('hello-world')
  })

  it('falls back to a generated slug when nothing is slug-able', () => {
    // A Hebrew name derives to '' — the backend rejects an empty slug.
    expect(deriveSlug('ארגון')).toBe('')
    expect(slugForName('ארגון', 'ab12cd')).toBe('org-ab12cd')
  })

  it('keeps the derived slug when one exists', () => {
    expect(slugForName('Acme Inc', 'ab12cd')).toBe('acme-inc')
  })

  it('includes the backend validation details in the message', () => {
    const msg = organizationErrorMessage(
      {
        response: {
          data: {
            error: 'Validation failed',
            details: ['Slug is required and must be a non-empty string'],
          },
        },
      },
      'fallback'
    )
    expect(msg).toBe(
      'Validation failed: Slug is required and must be a non-empty string'
    )
  })

  it('falls back when the error carries no payload', () => {
    expect(organizationErrorMessage({}, 'Failed to create organization')).toBe(
      'Failed to create organization'
    )
  })
})

describe('OrganizationSelector — create organization', () => {
  beforeEach(() => {
    apiMocks.getOrganizations.mockReset().mockResolvedValue([])
    apiMocks.createOrganization.mockReset()
  })

  it('posts a slug and a valid organization type', async () => {
    const createSpy = apiMocks.createOrganization.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Inc',
      slug: 'acme-inc',
    })

    await openCreateModal()

    fireEvent.change(screen.getByPlaceholderText(/enter organization name/i), {
      target: { value: 'Acme Inc' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    const payload = createSpy.mock.calls[0][0]
    expect(payload.name).toBe('Acme Inc')
    expect(payload.slug).toBe('acme-inc')
    // 'team' is not a member of organization_type_enum.
    expect(payload.type).toBe('organization')
  })

  it('sends the description under metadata (there is no description column)', async () => {
    const createSpy = apiMocks.createOrganization.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Inc',
      slug: 'acme-inc',
    })

    await openCreateModal()

    fireEvent.change(screen.getByPlaceholderText(/enter organization name/i), {
      target: { value: 'Acme Inc' },
    })
    fireEvent.change(screen.getByPlaceholderText(/optional description/i), {
      target: { value: 'The Acme company' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    const payload = createSpy.mock.calls[0][0]
    expect(payload.metadata).toEqual({ description: 'The Acme company' })
    expect(payload).not.toHaveProperty('description')
  })

  it('surfaces the API error instead of silently doing nothing', async () => {
    apiMocks.createOrganization.mockRejectedValue({
      response: {
        data: { error: 'An organization with this slug already exists' },
      },
    })

    await openCreateModal()

    fireEvent.change(screen.getByPlaceholderText(/enter organization name/i), {
      target: { value: 'Acme Inc' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    expect(
      await screen.findByText(/organization with this slug already exists/i)
    ).toBeInTheDocument()
  })
})
