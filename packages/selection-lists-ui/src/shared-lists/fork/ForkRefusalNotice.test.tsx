import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { withSharedLists } from '../../test/sharedListsWrapper'
import {
  CommonAccessNotice,
  CommonNoCreateNotice,
  ForkForbiddenNotice,
  ListNotFoundNotice,
} from './ForkRefusalNotice'

function renderWith(ui: React.ReactElement, flag = true) {
  const Wrapper = withSharedLists(flag)
  return render(<Wrapper>{ui}</Wrapper>)
}

describe('refusal notices (frames 04, 06)', () => {
  it('CommonNoCreateNotice: a 403 on a common list — explanation, no Fork CTA', () => {
    renderWith(
      <CommonNoCreateNotice listName="Priority" organizationName="Globex Freight" />
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-error', 'FORBIDDEN')
    expect(alert).toHaveAttribute('data-case', 'common-no-create')
    expect(alert).toHaveTextContent(/can.t change this list/)
    expect(alert).toHaveTextContent('“Priority” is a common list')
    expect(alert).toHaveTextContent('can’t be forked by you either')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('CommonNoCreateNotice with no names uses generic wording', () => {
    renderWith(<CommonNoCreateNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent('This list is a common list')
    expect(screen.getByRole('alert')).toHaveTextContent('your organization')
  })

  it('CommonAccessNotice: access to common lists is managed by the platform', () => {
    renderWith(<CommonAccessNotice />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-case', 'common-access')
    expect(alert).toHaveTextContent(/managed by the platform/i)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('ListNotFoundNotice: "List not found", same words as a list that never existed', () => {
    renderWith(<ListNotFoundNotice />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-error', 'NOT_FOUND')
    expect(alert).toHaveTextContent('List not found')
  })

  it('ForkForbiddenNotice: "you can\'t fork lists in <org>"', () => {
    renderWith(
      <ForkForbiddenNotice listName="Priority" organizationName="Globex Freight" />
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-case', 'fork-no-create')
    expect(alert).toHaveTextContent(/can.t fork lists in Globex Freight/)
    expect(alert).toHaveTextContent('Ask an admin or editor to fork Priority')
  })

  it('ForkForbiddenNotice with no names uses generic wording', () => {
    renderWith(<ForkForbiddenNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent('to fork this list')
  })

  it('flag OFF: every notice renders nothing (the 4.0.0 message stays)', () => {
    renderWith(
      <>
        <CommonNoCreateNotice />
        <CommonAccessNotice />
        <ListNotFoundNotice />
        <ForkForbiddenNotice />
      </>,
      false
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
