import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { withSharedLists } from '../../test/sharedListsWrapper'
import { COMMON_ID } from '../../test/sharedListsFixtures'
import { ForkRequiredBanner } from './ForkRequiredBanner'

const FORK_URL = `/v1/selection-lists/${COMMON_ID}/fork`

function setup(
  props: Partial<React.ComponentProps<typeof ForkRequiredBanner>> = {},
  flag = true
) {
  const Wrapper = withSharedLists(flag)
  const onFork = vi.fn()
  const onBack = vi.fn()
  const utils = render(
    <Wrapper>
      <ForkRequiredBanner
        sourceListId={COMMON_ID}
        forkUrl={FORK_URL}
        listName="Priority"
        organizationName="Globex Freight"
        onFork={onFork}
        onBack={onBack}
        {...props}
      />
    </Wrapper>
  )
  return { ...utils, onFork, onBack }
}

describe('ForkRequiredBanner (frame 04)', () => {
  it('is an alert that says the list is common, names the org, and nothing was saved', () => {
    setup()
    const banner = screen.getByRole('alert')
    expect(banner).toHaveAttribute('data-error', 'CONFLICT')
    expect(banner).toHaveAttribute('data-reason', 'fork_required')
    expect(banner).toHaveTextContent(/not saved — this is a common list/i)
    expect(banner).toHaveTextContent('“Priority” is shared by every organization')
    expect(banner).toHaveTextContent('Globex Freight’s own version')
    expect(banner).toHaveTextContent('Nothing has been saved.')
  })

  it('"Fork to edit…" forks the list the SERVICE named, and exposes the relative fork_url', async () => {
    const { onFork } = setup()
    const cta = screen.getByRole('button', { name: 'Fork to edit…' })
    expect(cta).toHaveAttribute('data-action', 'fork-to-edit')
    expect(cta).toHaveAttribute('data-fork-url', FORK_URL)
    await userEvent.click(cta)
    expect(onFork).toHaveBeenCalledTimes(1)
    expect(onFork).toHaveBeenCalledWith(COMMON_ID)
  })

  it('omits data-fork-url when there is none (an absolute URL never reaches this component)', () => {
    setup({ forkUrl: undefined })
    expect(screen.getByRole('button', { name: 'Fork to edit…' })).not.toHaveAttribute(
      'data-fork-url'
    )
  })

  it('"Back to the list" renders only when a handler is given', async () => {
    const { onBack, unmount } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    unmount()
    setup({ onBack: undefined })
    expect(screen.queryByRole('button', { name: 'Back to the list' })).toBeNull()
  })

  it('renders generic wording without a list name or organization', () => {
    const Wrapper = withSharedLists(true)
    render(
      <Wrapper>
        <ForkRequiredBanner sourceListId={COMMON_ID} onFork={() => undefined} />
      </Wrapper>
    )
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('This list is shared by every organization')
    expect(banner).toHaveTextContent('your organization own version')
  })

  it('takes the organization name from the provider when not passed', () => {
    const Wrapper = withSharedLists(true)
    render(
      <Wrapper>
        <ForkRequiredBanner sourceListId={COMMON_ID} onFork={() => undefined} />
      </Wrapper>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('flag OFF: renders nothing, even when a stray reason arrives', () => {
    setup({}, false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('[data-action="fork-to-edit"]')).toBeNull()
  })

  it('has a touch-target-tall Fork button (frame 12: >= 44 px)', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Fork to edit…' })).toHaveStyle({
      minBlockSize: 'var(--touch-target)',
    })
  })
})
