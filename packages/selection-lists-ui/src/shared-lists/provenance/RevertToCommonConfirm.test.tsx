import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RevertToCommonConfirm, type RevertToCommonConfirmProps } from './RevertToCommonConfirm'

const base: RevertToCommonConfirmProps = {
  confirmCase: 'revert',
  listKey: 'priority',
  listName: 'Priority',
  commonListName: 'Priority',
  busy: false,
  presentation: 'inline',
  onCancel: () => {},
  onConfirm: () => {},
}

const show = (over: Partial<RevertToCommonConfirmProps> = {}) => {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  const view = render(
    <RevertToCommonConfirm {...base} onCancel={onCancel} onConfirm={onConfirm} {...over} />
  )
  return { onCancel, onConfirm, ...view }
}

afterEach(() => {
  document.body.style.overflow = ''
})

describe('RevertToCommonConfirm - copy follows the provenance read (frame 07)', () => {
  it('source active: the revert promise, three consequences', () => {
    show({ organizationName: 'Acme Logistics' })
    const dialog = screen.getByRole('alertdialog', {
      name: 'Revert Acme Logistics to the common Priority list?',
    })
    expect(dialog).toHaveAttribute('data-confirm', 'revert-to-common')
    expect(dialog).toHaveTextContent(/archived, not deleted/)
    expect(dialog).toHaveTextContent('Forms go back to the common list.')
    expect(dialog).toHaveTextContent('not applied to the common list')
    expect(screen.getByRole('button', { name: 'Archive and revert' })).toHaveAttribute(
      'data-action',
      'confirm-revert'
    )
    expect(dialog).toHaveAccessibleDescription(/Forms go back to the common list/)
  })

  it('without an organization name the title is still a full sentence', () => {
    show()
    expect(screen.getByRole('alertdialog', { name: 'Revert this fork to the common Priority list?' })).toBeInTheDocument()
  })

  it('falls back to the fork name when the common list was not read', () => {
    show({ commonListName: null, listName: 'Prioridad' })
    expect(screen.getByRole('alertdialog', { name: /common Prioridad list/ })).toBeInTheDocument()
  })

  it('source archived: states outright there is no common list; never says revert', () => {
    show({ confirmCase: 'source-archived', organizationName: 'Acme Logistics' })
    const dialog = screen.getByRole('alertdialog', { name: "Archive Acme Logistics's Priority list?" })
    expect(dialog).toHaveAttribute('data-confirm', 'archive-fork-no-common')
    expect(dialog).toHaveAttribute('data-case', 'revert-unavailable')
    expect(dialog).toHaveAttribute('data-source-state', 'archived')
    expect(dialog.querySelector('[data-consequence="no-effective-list"]')).toHaveTextContent(
      /There is no common list to go back to\. Every form that uses priority in Acme Logistics will show “List unavailable”/
    )
    expect(dialog).not.toHaveTextContent(/revert/i)
    expect(screen.getByRole('button', { name: 'Archive anyway' })).toHaveAttribute('data-action', 'confirm-archive-fork')
    expect(screen.getByRole('button', { name: 'Keep using this list' })).toBeInTheDocument()
  })

  it('source archived without an organization name', () => {
    show({ confirmCase: 'source-archived' })
    expect(screen.getByRole('alertdialog', { name: 'Archive your Priority list?' })).toBeInTheDocument()
    expect(document.querySelector('[data-consequence]')).toHaveTextContent(/Every form that uses priority will show/)
  })

  it('source gone: CONDITIONAL consequence, never claims every form becomes unavailable', () => {
    show({ confirmCase: 'source-gone', commonListName: null })
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('data-confirm', 'archive-fork-source-unknown')
    expect(dialog).toHaveAttribute('data-source-state', 'gone')
    expect(dialog.querySelector('[data-consequence="conditional-no-effective-list"]')).toHaveTextContent(
      /If no active common Priority list is available to your organization/
    )
    expect(dialog.querySelector('[data-consequence="no-effective-list"]')).toBeNull()
    expect(dialog).not.toHaveTextContent(/revert/i)
  })
})

describe('RevertToCommonConfirm - behaviour', () => {
  it('the safe action holds initial focus; Escape cancels while idle', async () => {
    const { onCancel } = show()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()
    expect(cancel).toHaveAttribute('data-initial-focus', 'true')
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('confirm and cancel buttons call their handlers', async () => {
    const { onCancel, onConfirm } = show()
    await userEvent.click(screen.getByRole('button', { name: 'Archive and revert' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('in flight: both buttons are natively disabled, Escape does nothing, the dialog is busy', async () => {
    const { onCancel } = show({ busy: true })
    expect(screen.getByRole('button', { name: 'Archive and revert' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('other keys do not cancel', () => {
    const { onCancel } = show()
    fireEvent.keyDown(document, { key: 'a' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('inline presentation is not modal and renders in place', () => {
    const { container } = show()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('data-presentation', 'inline')
    expect(dialog).not.toHaveAttribute('aria-modal')
    expect(container).toContainElement(dialog)
    expect(document.body.style.overflow).toBe('')
  })

  it('returns focus to the control that opened it', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = show()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})

describe('RevertToCommonConfirm - bottom sheet (frame 13)', () => {
  const sheet = (over: Partial<RevertToCommonConfirmProps> = {}) =>
    show({ presentation: 'bottom-sheet', ...over })

  it('is a modal alertdialog in a portal; actions stacked, destructive last, touch-sized', () => {
    const { container } = sheet()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('data-presentation', 'bottom-sheet')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(container).not.toContainElement(dialog)
    expect(document.body).toContainElement(dialog)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Cancel', 'Archive and revert'])
    buttons.forEach(b => expect(b).toHaveStyle({ minBlockSize: 'var(--touch-target)' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores page scroll on close', () => {
    const { unmount } = sheet()
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('the scrim cancels only while idle; the sheet itself does not', async () => {
    const { onCancel, rerender } = sheet()
    await userEvent.click(screen.getByRole('alertdialog'))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-scrim]') as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<RevertToCommonConfirm {...base} presentation="bottom-sheet" busy onCancel={onCancel} onConfirm={() => {}} />)
    fireEvent.click(document.querySelector('[data-scrim]') as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('a downward swipe on the grab handle cancels only while idle', () => {
    const { onCancel, rerender } = sheet()
    const grab = document.querySelector('[data-grab]') as HTMLElement
    fireEvent.touchStart(grab, { touches: [{ clientY: 100 }] })
    fireEvent.touchEnd(grab, { changedTouches: [{ clientY: 130 }] })
    expect(onCancel).not.toHaveBeenCalled() // too short
    fireEvent.touchStart(grab, { touches: [{ clientY: 100 }] })
    fireEvent.touchEnd(grab, { changedTouches: [{ clientY: 200 }] })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.touchEnd(grab, { changedTouches: [{ clientY: 300 }] }) // no start
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<RevertToCommonConfirm {...base} presentation="bottom-sheet" busy onCancel={onCancel} onConfirm={() => {}} />)
    const busyGrab = document.querySelector('[data-grab]') as HTMLElement
    fireEvent.touchStart(busyGrab, { touches: [{ clientY: 100 }] })
    fireEvent.touchEnd(busyGrab, { changedTouches: [{ clientY: 300 }] })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('a swipe with no touch point is ignored', () => {
    const { onCancel } = sheet()
    const grab = document.querySelector('[data-grab]') as HTMLElement
    fireEvent.touchStart(grab, { touches: [] })
    fireEvent.touchEnd(grab, { changedTouches: [] })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Tab cycles inside the sheet', async () => {
    sheet()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Archive and revert' })
    expect(cancel).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(confirm).toHaveFocus()
    await userEvent.tab()
    expect(cancel).toHaveFocus()
    await userEvent.tab()
    expect(confirm).toHaveFocus()
  })

  it('Tab with nothing focusable (busy) stays put', () => {
    sheet({ busy: true })
    const dialog = screen.getByRole('alertdialog')
    const notPrevented = fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(notPrevented).toBe(false)
  })

  it('other keys pass through the trap', () => {
    sheet()
    expect(fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'a' })).toBe(true)
  })
})
