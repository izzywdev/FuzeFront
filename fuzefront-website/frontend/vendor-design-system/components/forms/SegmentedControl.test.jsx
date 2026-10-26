import React, { createRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl.jsx'

const OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'private', label: 'Private' },
  { value: 'org', label: 'Organization' },
  { value: 'platform', label: 'Common', 'data-visibility-filter': 'platform' },
]

function Controlled({ onChange, initial = 'any', ...rest }) {
  const [v, setV] = useState(initial)
  return (
    <SegmentedControl
      ariaLabel="Visibility"
      options={OPTIONS}
      value={v}
      onChange={(next) => {
        setV(next)
        if (onChange) onChange(next)
      }}
      {...rest}
    />
  )
}

describe('SegmentedControl', () => {
  it('renders a labelled group of buttons with exactly one aria-pressed', () => {
    render(<Controlled />)
    expect(screen.getByRole('group', { name: 'Visibility' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'true')
    expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    for (const b of buttons) expect(b).toHaveAttribute('type', 'button')
  })

  it('supports ariaLabelledBy', () => {
    render(
      <>
        <span id="lbl">Filter</span>
        <SegmentedControl ariaLabelledBy="lbl" options={OPTIONS} defaultValue="any" />
      </>,
    )
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument()
  })

  it('moves the pressed state on click and reports the new value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Organization' }))
    expect(onChange).toHaveBeenCalledWith('org')
    expect(screen.getByRole('button', { name: 'Organization' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('does not clear or re-report when the pressed segment is pressed again', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Any' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('is keyboard operable: Tab through segments, Space and Enter activate', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Any' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Private' })).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith('private')
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('org')
  })

  it('skips disabled segments (native disabled) and a fully disabled control', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <SegmentedControl
        ariaLabel="v"
        defaultValue="any"
        onChange={onChange}
        options={[{ value: 'any', label: 'Any' }, { value: 'x', label: 'X', disabled: true }]}
      />,
    )
    const x = screen.getByRole('button', { name: 'X' })
    expect(x).toBeDisabled()
    await user.click(x)
    expect(onChange).not.toHaveBeenCalled()
    rerender(<SegmentedControl ariaLabel="v" disabled options={OPTIONS} defaultValue="any" onChange={onChange} />)
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })

  it('works uncontrolled via defaultValue', async () => {
    const user = userEvent.setup()
    render(<SegmentedControl ariaLabel="v" options={OPTIONS} defaultValue="private" />)
    expect(screen.getByRole('button', { name: 'Private' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Common' }))
    expect(screen.getByRole('button', { name: 'Common' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('forwards option data-* hooks and the group ref', () => {
    const ref = createRef()
    render(<SegmentedControl ref={ref} ariaLabel="v" options={OPTIONS} defaultValue="any" data-filter="visibility" />)
    expect(ref.current).toBe(screen.getByRole('group'))
    expect(ref.current).toHaveAttribute('data-filter', 'visibility')
    expect(screen.getByRole('button', { name: 'Common' })).toHaveAttribute('data-visibility-filter', 'platform')
  })

  it('is RTL-safe, token-only, 44px on touch and keeps the focus ring inside the clip', () => {
    const { container } = render(
      <div dir="rtl">
        <SegmentedControl ariaLabel="v" options={OPTIONS} defaultValue="any" />
      </div>,
    )
    const css = container.querySelector('style').textContent
    expect(css).toMatch(/border-inline-start/)
    expect(css).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    expect(css).toMatch(/min-block-size:\s*var\(--touch-target\)/)
    // ring is inset (negative offset) so overflow: hidden cannot clip it
    expect(css).toMatch(/outline-offset:\s*calc\(var\(--border-width-strong\)\s*\*\s*-1\)/)
  })
})
