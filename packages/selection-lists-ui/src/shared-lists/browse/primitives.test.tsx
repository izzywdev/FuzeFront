import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  makeCommonList,
  makeForkList,
  makeSharedList,
} from '../../test/sharedListsFixtures'
import { groupBySource, type ForkCtaState } from '../core'
import { EditableHint } from './EditableHint'
import { ForkBadge } from './ForkBadge'
import { ListSourceGroups, ShadowNotes } from './ListSourceGroups'
import { ReadOnlyListNotice, readOnlyNoticeKind } from './ReadOnlyListNotice'
import { SharedListsToggle } from './SharedListsToggle'
import { VisibilityBadge } from './VisibilityBadge'
import { VisibilityFilter } from './VisibilityFilter'

const hrefFor = (l: { id: string }) => `/settings/selection-lists/${l.id}`

describe('VisibilityBadge', () => {
  it.each([
    ['private', 'Private', 'Private'],
    ['org', 'Organization', 'Organization'],
    ['platform', 'Common', 'Common list'],
  ] as const)('%s renders its row and detail labels', (visibility, row, detail) => {
    const { container, rerender } = render(
      <VisibilityBadge list={{ visibility }} />
    )
    const badge = container.querySelector(`[data-visibility="${visibility}"]`)
    expect(badge).toHaveTextContent(row)
    rerender(<VisibilityBadge list={{ visibility }} variant="detail" />)
    expect(container.querySelector(`[data-visibility="${visibility}"]`)).toHaveTextContent(detail)
  })

  it('only a platform list carries data-badge="common"', () => {
    const { container, rerender } = render(<VisibilityBadge list={{ visibility: 'platform' }} />)
    expect(container.querySelector('[data-badge="common"]')).not.toBeNull()
    rerender(<VisibilityBadge list={{ visibility: 'org' }} />)
    expect(container.querySelector('[data-badge]')).toBeNull()
  })

  it('an absent visibility is private (4.0.0 service)', () => {
    const { container } = render(<VisibilityBadge list={{}} />)
    expect(container.querySelector('[data-visibility="private"]')).not.toBeNull()
  })
})

describe('ForkBadge', () => {
  it('renders for a fork, with the fork key in its title', () => {
    const { container } = render(<ForkBadge list={makeForkList()} />)
    const badge = container.querySelector('[data-badge="fork"]')
    expect(badge).toHaveTextContent('Fork')
    expect(badge).toHaveAttribute('title', 'forked_from: common list priority')
  })

  it.each([[null], [undefined]])('renders nothing when forked_from is %s', forked_from => {
    const { container } = render(<ForkBadge list={makeSharedList({ forked_from })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('EditableHint', () => {
  it('true → "You can edit"', () => {
    const { container } = render(<EditableHint list={{ editable: true }} />)
    expect(container.querySelector('[data-editable="true"]')).toHaveTextContent('You can edit')
  })

  it('false → "Read-only" in a row and "Read-only for you" in a detail', () => {
    const { container, rerender } = render(<EditableHint list={{ editable: false }} />)
    expect(container.querySelector('[data-editable="false"]')).toHaveTextContent(/^🔒 Read-only$/)
    rerender(<EditableHint list={{ editable: false }} variant="detail" />)
    expect(container.querySelector('[data-editable="false"]')).toHaveTextContent('Read-only for you')
  })

  it('absent renders NOTHING — unknown is never read as read-only', () => {
    const { container } = render(<EditableHint list={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SharedListsToggle', () => {
  it('is a switch reflecting its state and flipping it on click and keyboard', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<SharedListsToggle checked onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Include common lists' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toHaveAttribute('data-control', 'include-shared')
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith(false)
    rerender(<SharedListsToggle checked={false} onChange={onChange} />)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(true)
  })
})

describe('VisibilityFilter', () => {
  it('shows exactly one pressed option and reports a choice', async () => {
    const onChange = vi.fn()
    const { container } = render(<VisibilityFilter value="any" onChange={onChange} />)
    expect(container.querySelector('[data-filter="visibility"]')).not.toBeNull()
    expect(container.querySelector('[data-visibility-filter="any"]')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(container.querySelector('[data-visibility-filter="platform"]') as Element)
    expect(onChange).toHaveBeenCalledWith('platform')
  })
})

describe('ListSourceGroups', () => {
  const rows = [
    makeForkList({ id: 'a', key: 'priority', name: 'Priority' }),
    makeSharedList({ id: 'b', key: 'zones', name: 'Zones', visibility: 'private', editable: true, status: 'archived', is_machine: true }),
    makeCommonList({ id: 'c', key: 'yes-no', name: 'Yes / No' }),
  ]

  it('groups rows under headers that precede them, with their markers', () => {
    const { container } = render(
      <ListSourceGroups rows={rows} groups={groupBySource(rows)} hrefFor={hrefFor} onOpen={vi.fn()} />
    )
    const order = Array.from(container.querySelectorAll('[data-group], [data-list]')).map(n =>
      n.hasAttribute('data-group') ? `group:${n.getAttribute('data-group')}` : `${n.getAttribute('data-list')}:${n.getAttribute('data-source')}`
    )
    expect(order).toEqual(['group:own', 'priority:own', 'zones:own', 'group:common', 'yes-no:platform'])
    expect(container.querySelector('[data-group="own"]')).toHaveTextContent('Your organization · 2 loaded')
    expect(container.querySelector('[data-group="common"]')).toHaveTextContent(
      'Common lists · provided by FuzeFront to every organization · 1 loaded'
    )
    expect(container.querySelector('[data-list="priority"] [data-badge="fork"]')).not.toBeNull()
    expect(container.querySelector('[data-list="yes-no"] [data-badge="common"]')).not.toBeNull()
    expect(container.querySelector('[data-list="zones"] [data-status="archived"]')).toHaveTextContent('Archived')
    expect(container.querySelector('[data-list="zones"] [data-machine="true"]')).not.toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Visibility' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Your access' })).toBeInTheDocument()
  })

  it('never renders a header for an empty group', () => {
    const only = [rows[2]]
    const { container } = render(
      <ListSourceGroups rows={only} groups={groupBySource(only)} hrefFor={hrefFor} onOpen={vi.fn()} />
    )
    expect(container.querySelector('[data-group="own"]')).toBeNull()
    expect(container.querySelector('[data-group="common"]')).not.toBeNull()
  })

  it('renders flat (no group rows) when groups is null', () => {
    const { container } = render(
      <ListSourceGroups rows={rows} groups={null} hrefFor={hrefFor} onOpen={vi.fn()} />
    )
    expect(container.querySelector('[data-group]')).toBeNull()
    expect(container.querySelectorAll('[data-list]')).toHaveLength(3)
  })

  it('opens a row on a plain click but leaves modified clicks to the browser', () => {
    const onOpen = vi.fn()
    render(<ListSourceGroups rows={[rows[0]]} groups={null} hrefFor={hrefFor} onOpen={onOpen} />)
    const link = screen.getByRole('link', { name: 'Priority' })
    expect(link).toHaveAttribute('href', '/settings/selection-lists/a')
    // jsdom cannot navigate: swallow the browser default the modified clicks keep.
    const swallow = (event: Event) => event.preventDefault()
    document.addEventListener('click', swallow)
    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { metaKey: true })
    fireEvent.click(link, { shiftKey: true })
    fireEvent.click(link, { altKey: true })
    fireEvent.click(link, { button: 1 })
    expect(onOpen).not.toHaveBeenCalled()
    document.removeEventListener('click', swallow)
    fireEvent.click(link)
    expect(onOpen).toHaveBeenCalledWith(rows[0])
  })

  it('shows an absent editable as no access marker, and tolerates a malformed date', () => {
    const odd = makeSharedList({ id: 'x', key: 'odd', name: 'Odd', editable: undefined, updated_at: 'not-a-date' })
    const { container } = render(
      <ListSourceGroups rows={[odd]} groups={null} hrefFor={hrefFor} onOpen={vi.fn()} />
    )
    expect(container.querySelector('[data-list="odd"] [data-editable]')).toBeNull()
  })
})

describe('ShadowNotes', () => {
  it('names the fork key source-neutrally — never "hidden" or "replaced"', () => {
    const onShowCommon = vi.fn()
    const { container } = render(
      <ShadowNotes rows={[makeForkList(), makeForkList({ id: 'dup' })]} onShowCommon={onShowCommon} />
    )
    const notes = container.querySelectorAll('[data-shadow-note]')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toHaveTextContent(
      "priority is your organization's fork; a common list with the same key is not listed here."
    )
    expect(notes[0].textContent).not.toMatch(/hidden|replaced/i)
    fireEvent.click(screen.getByRole('button', { name: 'Show common lists only' }))
    expect(onShowCommon).toHaveBeenCalled()
  })

  it('renders nothing without a loaded fork row', () => {
    const { container } = render(<ShadowNotes rows={[makeCommonList()]} onShowCommon={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ReadOnlyListNotice', () => {
  const offer: ForkCtaState = { kind: 'offer' }
  const open = vi.fn()
  const retry = vi.fn()
  const mount = (list: ReturnType<typeof makeCommonList>, cta: ForkCtaState) =>
    render(
      <ReadOnlyListNotice list={list} cta={cta} hrefFor={hrefFor} onOpenOwnVersion={open} onRetryLookup={retry} />
    )

  it('platform: a note explaining why and what forking does', () => {
    const { container } = mount(makeCommonList(), offer)
    const notice = container.querySelector('[data-readonly-notice="platform"]')
    expect(notice).toHaveAttribute('role', 'note')
    expect(notice).toHaveTextContent(/fork/i)
    expect(container.querySelector('[data-action="retry"]')).toBeNull()
  })

  it('platform with a failed lookup: plain notice, no CTA, a quiet Retry', async () => {
    const { container } = mount(makeCommonList(), { kind: 'lookup-failed' })
    expect(container.querySelector('[data-readonly-notice="platform"]')).not.toBeNull()
    await userEvent.click(container.querySelector('[data-action="retry"]') as Element)
    expect(retry).toHaveBeenCalled()
  })

  it('shadowed: "Open your version" links to the own list; nothing about forking', async () => {
    const own = makeForkList({ id: 'own-1' })
    const { container } = mount(makeCommonList({ name: 'Priority' }), { kind: 'shadowed', ownVersion: own })
    const notice = container.querySelector('[data-readonly-notice="shadowed"]')
    expect(notice).toHaveTextContent(/uses its own version of this list/i)
    const link = container.querySelector('[data-action="open-own-version"]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/settings/selection-lists/own-1')
    await userEvent.click(link)
    expect(open).toHaveBeenCalledWith(own)
  })

  it.each([
    ['usr_01h455vb4pex5vsknk084sn0aa', 'user', /created by a user, not set up automatically/i],
    ['system:selection-list-service', 'system', /set up automatically for your organization/i],
    ['[deleted-user]', 'deleted-user', /creator.s account has been deleted/i],
  ])('org: owner hint for %s is decided from its form and never shows the raw id', (created_by, kind, text) => {
    const { container } = mount(
      makeSharedList({ visibility: 'org', editable: false, created_by }),
      { kind: 'hidden', reason: 'not-common' }
    )
    const hint = container.querySelector(`[data-owner-hint][data-created-by-kind="${kind}"]`)
    expect(hint).toHaveTextContent(text)
    expect(container.textContent).not.toContain(created_by)
    expect(container.querySelector('[data-action]')).toBeNull()
  })

  it('org: an unrecognisable created_by yields no hint at all', () => {
    const { container } = mount(
      makeSharedList({ visibility: 'org', editable: false, created_by: 'who-knows' }),
      { kind: 'hidden', reason: 'not-common' }
    )
    expect(container.querySelector('[data-readonly-notice="org"]')).not.toBeNull()
    expect(container.querySelector('[data-owner-hint]')).toBeNull()
  })

  it('private: a plain read-only explanation', () => {
    const { container } = mount(
      makeSharedList({ visibility: 'private', editable: false }),
      { kind: 'hidden', reason: 'not-common' }
    )
    expect(container.querySelector('[data-readonly-notice="private"]')).not.toBeNull()
  })

  it('renders nothing while the effective-list answer is pending, or when editable is not false', () => {
    expect(mount(makeCommonList(), { kind: 'pending' }).container).toBeEmptyDOMElement()
    expect(mount(makeCommonList({ editable: true }), offer).container).toBeEmptyDOMElement()
    expect(mount(makeCommonList({ editable: undefined }), offer).container).toBeEmptyDOMElement()
  })

  it('readOnlyNoticeKind: the pure decision', () => {
    expect(readOnlyNoticeKind(makeCommonList(), offer)).toBe('platform')
    expect(readOnlyNoticeKind(makeCommonList(), { kind: 'shadowed', ownVersion: makeForkList() })).toBe('shadowed')
    expect(readOnlyNoticeKind(makeCommonList(), { kind: 'pending' })).toBeNull()
    expect(readOnlyNoticeKind(makeSharedList({ visibility: 'org', editable: false }), offer)).toBe('org')
  })
})
