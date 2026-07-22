import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusCallout } from '@fuzefront/design-system'

/**
 * Unit coverage for the DS StatusCallout primitive (owned by design-system/,
 * exercised here via the source alias). Verifies tone→role a11y mapping and
 * that title/body/actions render.
 */
describe('StatusCallout (design-system primitive)', () => {
  it('uses role=alert for the error tone', () => {
    render(
      <StatusCallout tone="error" title="Boom">
        Something failed
      </StatusCallout>
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    expect(screen.getByText('Something failed')).toBeInTheDocument()
  })

  it('uses role=status for non-error tones and renders actions', () => {
    render(
      <StatusCallout tone="warning" title="Heads up" actions={<button>Do it</button>}>
        A warning
      </StatusCallout>
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument()
  })

  it('passes through data-* attributes for test hooks', () => {
    render(<StatusCallout tone="warning" data-guard="set-password-first" title="x" />)
    expect(document.querySelector('[data-guard="set-password-first"]')).not.toBeNull()
  })
})
