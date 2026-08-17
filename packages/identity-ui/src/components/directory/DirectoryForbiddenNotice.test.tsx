import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DirectoryForbiddenNotice } from './DirectoryForbiddenNotice'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

describe('DirectoryForbiddenNotice', () => {
  it('carries the frozen 403/FORBIDDEN hooks (02-states.html b6) — rendered in place, zero data', () => {
    render(
      <IdentityI18nProvider>
        <DirectoryForbiddenNotice />
      </IdentityI18nProvider>
    )
    const panel = document.querySelector('[data-state="forbidden"]')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-http', '403')
    expect(panel).toHaveAttribute('data-error-code', 'FORBIDDEN')
  })

  it("never renders a sign-in prompt — only 401 re-authenticates", () => {
    render(
      <IdentityI18nProvider>
        <DirectoryForbiddenNotice />
      </IdentityI18nProvider>
    )
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
  })
})
