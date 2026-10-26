import React, { createRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RadioCardGroup } from './RadioCardGroup.jsx'

const OPTIONS = [
  { value: 'private', label: 'Only people with a role', description: 'Everyone else keeps the common list.' },
  { value: 'org', label: 'Everyone in Acme', description: 'Every member can read it.', 'data-visibility-option': 'org' },
  { value: 'platform', label: 'Every organization', description: 'Publishes it as a common list.' },
]

function Controlled({ options = OPTIONS, initial = 'org', onChange, ...rest }) {
  const [v, setV] = useState(initial)
  return (
    <RadioCardGroup
      ariaLabel="Who can see this list"
      options={options}
      value={v}
      onChange={(next) => {
        setV(next)
        if (onChange) onChange(next)
      }}
      {...rest}
    />
  )
}

describe('RadioCardGroup', () => {
  it('renders a labelled radiogroup of radios with aria-checked and description wiring', () => {
    render(<Controlled />)
    const group = screen.getByRole('radiogroup', { name: 'Who can see this list' })
    expect(group).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Everyone in Acme' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Every organization' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Everyone in Acme' })).toHaveAccessibleDescription('Every member can read it.')
  })

  it('supports ariaLabelledBy', () => {
    render(
      <>
        <span id="lbl">Visibility</span>
        <RadioCardGroup ariaLabelledBy="lbl" options={OPTIONS} defaultValue="org" />
      </>,
    )
    expect(screen.getByRole('radiogroup', { name: 'Visibility' })).toBeInTheDocument()
  })

  it('uses a roving tab stop: only the checked card is tabbable', () => {
    render(<Controlled />)
    const [priv, org, plat] = screen.getAllByRole('radio')
    expect(org).toHaveAttribute('tabindex', '0')
    expect(priv).toHaveAttribute('tabindex', '-1')
    expect(plat).toHaveAttribute('tabindex', '-1')
  })

  it('falls back to the first enabled card as the tab stop when nothing is checked', () => {
    render(
      <RadioCardGroup
        ariaLabel="g"
        options={[{ value: 'a', label: 'A', disabled: true }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]}
      />,
    )
    const [a, b, c] = screen.getAllByRole('radio')
    expect(a).toHaveAttribute('tabindex', '-1')
    expect(b).toHaveAttribute('tabindex', '0')
    expect(c).toHaveAttribute('tabindex', '-1')
  })

  it('selects on click and reports the value once', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: 'Only people with a role' }))
    expect(onChange).toHaveBeenCalledWith('private')
    expect(screen.getByRole('radio', { name: 'Only people with a role' })).toHaveAttribute('aria-checked', 'true')
    // re-selecting the current value is not a change
    await user.click(screen.getByRole('radio', { name: 'Only people with a role' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('selects the focused card with Space', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    screen.getByRole('radio', { name: 'Everyone in Acme' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith('platform')
    screen.getByRole('radio', { name: 'Only people with a role' }).focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith('private')
  })

  it('moves focus AND selection with the arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const [priv, org, plat] = screen.getAllByRole('radio')
    org.focus()
    await user.keyboard('{ArrowDown}')
    expect(plat).toHaveFocus()
    expect(plat).toHaveAttribute('aria-checked', 'true')
    expect(plat).toHaveAttribute('tabindex', '0')
    await user.keyboard('{ArrowDown}')
    expect(priv).toHaveFocus() // wrapped
    await user.keyboard('{ArrowUp}')
    expect(plat).toHaveFocus() // wrapped back
    await user.keyboard('{ArrowRight}')
    expect(priv).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(plat).toHaveFocus()
  })

  it('flips Left/Right under dir="rtl" but not Up/Down', async () => {
    const user = userEvent.setup()
    render(
      <div dir="rtl">
        <Controlled />
      </div>,
    )
    const [priv, org, plat] = screen.getAllByRole('radio')
    org.focus()
    await user.keyboard('{ArrowLeft}') // next in RTL
    expect(plat).toHaveFocus()
    await user.keyboard('{ArrowRight}') // previous in RTL
    expect(org).toHaveFocus()
    await user.keyboard('{ArrowDown}') // vertical stack: still next
    expect(plat).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(org).toHaveFocus()
    expect(priv).toHaveAttribute('aria-checked', 'false')
  })

  it('skips disabled cards in arrow navigation and never selects them', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const options = [
      { value: 'private', label: 'Private' },
      { value: 'org', label: 'Org', disabled: true },
      { value: 'platform', label: 'Platform' },
    ]
    render(<Controlled options={options} initial="private" onChange={onChange} />)
    const [priv, org, plat] = screen.getAllByRole('radio')
    expect(org).toHaveAttribute('aria-disabled', 'true')
    expect(org).toHaveAttribute('tabindex', '-1')
    priv.focus()
    await user.keyboard('{ArrowDown}')
    expect(plat).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith('platform')
    await user.click(org)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(org).toHaveAttribute('aria-checked', 'false')
  })

  it('disables the whole group: nothing selectable or tabbable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled disabled onChange={onChange} />)
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true')
    for (const r of screen.getAllByRole('radio')) {
      expect(r).toHaveAttribute('aria-disabled', 'true')
      expect(r).toHaveAttribute('tabindex', '-1')
    }
    await user.click(screen.getByRole('radio', { name: 'Every organization' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('works uncontrolled via defaultValue', async () => {
    const user = userEvent.setup()
    render(<RadioCardGroup ariaLabel="g" options={OPTIONS} defaultValue="private" />)
    expect(screen.getByRole('radio', { name: 'Only people with a role' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'Every organization' }))
    expect(screen.getByRole('radio', { name: 'Every organization' })).toHaveAttribute('aria-checked', 'true')
  })

  it('marks a pending card without checking it, and merges aria-describedby', () => {
    render(
      <>
        <p id="confirm">Confirm below to publish.</p>
        <RadioCardGroup
          ariaLabel="g"
          defaultValue="org"
          options={[
            { value: 'org', label: 'Org' },
            { value: 'platform', label: 'Common', description: 'This cannot be undone.', pending: true, 'aria-describedby': 'confirm' },
          ]}
        />
      </>,
    )
    const pending = screen.getByRole('radio', { name: 'Common' })
    expect(pending).toHaveAttribute('data-pending', 'true')
    expect(pending).toHaveAttribute('aria-checked', 'false')
    expect(pending).toHaveAccessibleDescription('This cannot be undone. Confirm below to publish.')
  })

  it('forwards option data-* hooks, the group ref and a hidden form value', () => {
    const ref = createRef()
    const { container } = render(<RadioCardGroup ref={ref} ariaLabel="g" name="visibility" options={OPTIONS} defaultValue="org" />)
    expect(ref.current).toBe(screen.getByRole('radiogroup'))
    expect(screen.getByRole('radio', { name: 'Everyone in Acme' })).toHaveAttribute('data-visibility-option', 'org')
    expect(container.querySelector('input[type="hidden"][name="visibility"]')).toHaveValue('org')
  })

  it('declares a 44px minimum card height and logical-property layout (touch targets, RTL-safe)', () => {
    const { container } = render(<RadioCardGroup ariaLabel="g" options={OPTIONS} defaultValue="org" />)
    const css = container.querySelector('style').textContent
    expect(css).toMatch(/\.ds-rcg__opt\s*{[^}]*min-block-size:\s*var\(--touch-target\)/)
    expect(css).toMatch(/margin-block-start/)
    expect(css).toMatch(/text-align:\s*start/)
    // no physical-direction properties, no raw colours
    expect(css).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
})
