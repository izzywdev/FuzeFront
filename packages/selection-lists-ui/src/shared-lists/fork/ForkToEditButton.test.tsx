import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { withSharedLists } from '../../test/sharedListsWrapper'
import { makeSharedList } from '../../test/sharedListsFixtures'
import type { ForkCtaState } from '../core'
import { ForkToEditButton } from './ForkToEditButton'

function setup(cta: ForkCtaState, flag = true) {
  const Wrapper = withSharedLists(flag)
  const onFork = vi.fn()
  const utils = render(
    <Wrapper>
      <ForkToEditButton
        cta={cta}
        onFork={onFork}
        organizationName="Globex Freight"
        listName="Priority"
      />
    </Wrapper>
  )
  return { ...utils, onFork }
}

describe('ForkToEditButton (frames 02, 03, 06)', () => {
  it('offer: the ONE action, keyboard reachable, opens the dialog', async () => {
    const { onFork } = setup({ kind: 'offer' })
    const button = screen.getByRole('button', { name: 'Fork to edit…' })
    expect(button).toHaveAttribute('data-action', 'fork-to-edit')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onFork).toHaveBeenCalledTimes(1)
  })

  it('forbidden: the explanation replaces the CTA', () => {
    setup({ kind: 'forbidden' })
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('[data-case="fork-no-create"]')).toHaveTextContent(
      /can.t fork lists in Globex Freight/
    )
  })

  it.each<ForkCtaState>([
    { kind: 'pending' },
    { kind: 'lookup-failed' },
    { kind: 'shadowed', ownVersion: makeSharedList() },
    { kind: 'hidden', reason: 'not-common' },
    { kind: 'hidden', reason: 'not-read-only' },
    { kind: 'hidden', reason: 'not-effective' },
    { kind: 'hidden', reason: 'flag-off' },
  ])('%j: never offers Fork on a guess', cta => {
    const { container } = setup(cta)
    expect(container).toBeEmptyDOMElement()
  })

  it('flag OFF: nothing, even for an offer', () => {
    const { container } = setup({ kind: 'offer' }, false)
    expect(container).toBeEmptyDOMElement()
  })
})
