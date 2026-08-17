import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProvenanceBadge } from './ProvenanceBadge'

describe('<ProvenanceBadge>', () => {
  it.each(['set', 'inherited', 'locked', 'default', 'stale'] as const)(
    'renders the %s kind with a data-provenance hook and the given label',
    kind => {
      render(<ProvenanceBadge kind={kind} label="some label" />)
      expect(screen.getByText('some label').closest(`[data-provenance="${kind}"]`)).not.toBeNull()
    }
  )

  it('gives locked a visually distinct tone from set (never the same badge)', () => {
    const { container: lockedContainer } = render(<ProvenanceBadge kind="locked" label="Locked by portal" />)
    const { container: setContainer } = render(<ProvenanceBadge kind="set" label="Set here" />)
    const lockedEl = lockedContainer.querySelector('[data-provenance="locked"]') as HTMLElement
    const setEl = setContainer.querySelector('[data-provenance="set"]') as HTMLElement
    expect(lockedEl.style.color).not.toBe(setEl.style.color)
  })
})
