import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigI18nProvider } from '../../i18n/ConfigI18nProvider'
import { ResetValueMenu } from './ResetValueMenu'

function renderMenu(props: Partial<ComponentProps<typeof ResetValueMenu>> = {}) {
  const onUnset = vi.fn()
  const onPin = vi.fn()
  render(
    <ConfigI18nProvider>
      <ResetValueMenu
        keyName="notifications.digest.frequency"
        parentScopeLabel="portal Acme Portal"
        parentValue="daily"
        onUnset={onUnset}
        onPin={onPin}
        {...props}
      />
    </ConfigI18nProvider>
  )
  return { onUnset, onPin }
}

describe('<ResetValueMenu>', () => {
  it('starts collapsed behind a single "Reset…" trigger', () => {
    renderMenu()
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens to reveal exactly two distinct options — unset and pin — never one combined "reset" control', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: /reset/i }))
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(menu.querySelector('[data-op="unset"]')).toBeInTheDocument()
    expect(menu.querySelector('[data-op="pin-parent"]')).toBeInTheDocument()
  })

  it('calls onUnset — and NOT onPin — when the unset option is chosen', async () => {
    const user = userEvent.setup()
    const { onUnset, onPin } = renderMenu()
    await user.click(screen.getByRole('button', { name: /reset/i }))
    await user.click(screen.getByRole('menuitem', { name: /unset/i }))
    expect(onUnset).toHaveBeenCalledTimes(1)
    expect(onPin).not.toHaveBeenCalled()
  })

  it('calls onPin — and NOT onUnset — when the pin option is chosen', async () => {
    const user = userEvent.setup()
    const { onUnset, onPin } = renderMenu()
    await user.click(screen.getByRole('button', { name: /reset/i }))
    await user.click(screen.getByRole('menuitem', { name: /pin/i }))
    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('closes the menu after a choice is made', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: /reset/i }))
    await user.click(screen.getByRole('menuitem', { name: /pin/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
