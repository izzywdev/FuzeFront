import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  EffectivePickerState,
  type EffectivePickerStateProps,
} from './EffectivePickerState'

const persisted = <div data-persisted="front_sli_stored" />

function mount(over: Partial<EffectivePickerStateProps> = {}) {
  const onRetry = vi.fn()
  const utils = render(
    <EffectivePickerState
      state="loading"
      listKey="priority"
      onRetry={onRetry}
      persisted={persisted}
      rootProps={{
        'data-frame': '12-picker-single',
        'data-panel': 'picker',
        'data-picker': 'priority',
      }}
      {...over}
    />
  )
  const root = utils.container.firstElementChild as HTMLElement
  return { ...utils, root, onRetry }
}

describe('EffectivePickerState (frames 09, 10, 15 states)', () => {
  it.each(['loading', 'resolving'] as const)(
    '%s: one busy skeleton, the host value kept, no editable control',
    state => {
      const { root } = mount({ state })
      expect(root).toHaveAttribute('data-state', state)
      expect(root).toHaveAttribute('data-panel', 'picker')
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
      expect(root.querySelector('[data-combo-control]')).toBeNull()
      expect(root.querySelector('[data-persisted]')).toHaveAttribute(
        'data-persisted',
        'front_sli_stored'
      )
      // the stored id is never shown as a label placeholder
      expect(root).not.toHaveTextContent('front_sli_stored')
    }
  )

  it('names what is loading for assistive tech', () => {
    mount({ state: 'loading' })
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading options')
    mount({ state: 'resolving' })
    expect(
      screen.getAllByRole('status').map(n => n.getAttribute('aria-label'))
    ).toContain('Loading the saved value')
  })

  it('error: in-place Retry, load-failed message, selection kept', () => {
    const { root, onRetry } = mount({ state: 'error' })
    expect(root).toHaveAttribute('data-state', 'error')
    expect(root).toHaveTextContent("Couldn't load options")
    expect(root.querySelector("[data-error='load-failed']")).toHaveAttribute(
      'role',
      'alert'
    )
    expect(root.querySelector('[data-persisted]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(root.querySelector('[data-action="retry"]')).not.toBeNull()
  })

  it('an incomplete lookup is "couldn\'t confirm" — never "List unavailable"', () => {
    const { root } = mount({ state: 'error', incomplete: true })
    expect(root).toHaveTextContent("Couldn't confirm the options")
    expect(root).not.toHaveTextContent(/list unavailable/i)
  })

  it('not-found: "List unavailable", the control natively disabled, key bidi-isolated', () => {
    const { root } = mount({ state: 'not-found' })
    expect(root).toHaveAttribute('data-state', 'not-found')
    const control = root.querySelector('[data-combo-control]')!
    expect(control).toBeDisabled()
    expect(control).toHaveTextContent('List unavailable')
    expect(root.querySelector("[data-error='NOT_FOUND']")).toHaveTextContent(
      /List unavailable/
    )
    expect(root.querySelector('bdi')).toHaveTextContent('priority')
    expect(root.querySelector('[data-persisted]')).not.toBeNull()
  })

  it('resolve-error: its own message, Retry, the stored id untouched', () => {
    const { root, onRetry } = mount({ state: 'resolve-error' })
    expect(root).toHaveAttribute('data-state', 'resolve-error')
    expect(root).toHaveTextContent("Couldn't load the saved value")
    expect(root.querySelector("[data-error='resolve-failed']")).not.toBeNull()
    expect(root.querySelector("[data-error='load-failed']")).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('Retry is at least one touch target tall (token, not a px literal)', () => {
    mount({ state: 'error' })
    expect(screen.getByRole('button', { name: 'Retry' }).style.minBlockSize).toBe(
      'var(--touch-target)'
    )
  })
})
