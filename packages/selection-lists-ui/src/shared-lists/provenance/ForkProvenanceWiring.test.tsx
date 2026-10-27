/**
 * The boundary mounted in the real list detail (SelectionListManagementFlow):
 * flag ON + a fork -> provenance card, "Copied from" on the rows, the archive
 * flow; flag OFF or a plain list -> the approved 4.0.0 detail, untouched.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionListManagementFlow } from '../../SelectionListManagementFlow'
import { LocationProbe, renderFlow } from '../../test/helpers'
import { withSharedLists } from '../../test/sharedListsWrapper'
import {
  API,
  COMMON_ITEM,
  FORK_ID,
  FORK_ITEM,
  archivePath,
  commonItems,
  forkItems,
  forkPath,
  jsonResponse,
  page,
  priorityCommon,
  priorityFork,
  routeFetch,
  sourceItemsPath,
  sourcePath,
} from '../../test/provenanceFixtures'
import { callsOf, makeForkList, makeSharedList } from '../../test/sharedListsFixtures'

afterEach(() => vi.unstubAllGlobals())

const INDEX = '/settings/selection-lists'
const DETAIL = `${INDEX}/:listId`

function renderDetail(flag: boolean) {
  const Wrapper = withSharedLists(flag)
  return renderFlow(
    <Wrapper>
      <SelectionListManagementFlow />
      <LocationProbe />
    </Wrapper>,
    `${INDEX}/${FORK_ID}`,
    [INDEX, DETAIL]
  )
}

function mockApi(fork = priorityFork(), extra: Parameters<typeof routeFetch>[0] = {}) {
  return routeFetch({
    [forkPath]: () => jsonResponse(fork),
    [`GET ${API}/${FORK_ID}/items`]: () => jsonResponse(page(forkItems().map((item, i) => ({
      ...item,
      list_id: FORK_ID,
      is_machine: false,
      status: 'active',
      sort_order: i,
      source_hash: 'h',
    })))),
    [`HEAD ${API}/${FORK_ID}/items/reorder`]: () => jsonResponse({}),
    [sourcePath]: () => jsonResponse(priorityCommon()),
    [sourceItemsPath]: () => jsonResponse(page(commonItems())),
    [archivePath]: () => jsonResponse(makeForkList({ status: 'archived' })),
    ...extra,
  })
}

const row = (id: string) => document.querySelector(`[data-item="${id}"]`) as HTMLElement

describe('list detail with the provenance boundary mounted', () => {
  it('flag ON, a fork: card, "Copied from" and data-origin-item on the 4.0.0 editor rows', async () => {
    mockApi()
    renderDetail(true)
    await waitFor(() => expect(document.querySelector('[data-panel="fork-provenance"]')).not.toBeNull())
    // The 4.0.0 editor is untouched.
    expect(document.querySelector('[data-panel="value-editor"]')).not.toBeNull()
    expect(document.querySelector('[data-action="add-value"]')).not.toBeNull()
    await waitFor(() => expect(row(FORK_ITEM.low)).toHaveTextContent('common “Low”'))
    expect(row(FORK_ITEM.low)).toHaveAttribute('data-origin-item', COMMON_ITEM.low)
    expect(row(FORK_ITEM.medium)).toHaveTextContent('common “Normal”')
    expect(row(FORK_ITEM.blocker)).toHaveAttribute('data-origin-item', 'none')
    expect(row(FORK_ITEM.blocker)).toHaveTextContent('added in this fork')
  })

  it('a fork\'s value editor is a table (frame 07): "Copied from" is a column, each value a row of cells', async () => {
    mockApi()
    renderDetail(true)
    const table = await screen.findByRole('table', { name: 'Values' })
    expect(within(table).getByRole('columnheader', { name: 'Value' })).toBeVisible()
    expect(within(table).getByRole('columnheader', { name: 'Copied from' })).toBeVisible()
    await waitFor(() => expect(row(FORK_ITEM.low)).toHaveTextContent('common “Low”'))
    const low = row(FORK_ITEM.low)
    expect(low).toHaveAttribute('role', 'row')
    const cell = low.querySelector('[data-copied-from]')!.closest('[role="cell"]') as HTMLElement
    expect(cell).not.toBeNull()
    expect(cell).toHaveTextContent('common “Low”')
    // the label is its own cell, not part of the clickable value (clicking it must not open the editor)
    expect(cell.closest('[role="button"]')).toBeNull()
    // a row's direct children are cells; drag-reorder and the value button are still there
    for (const child of Array.from(low.children)) expect(child).toHaveAttribute('role', 'cell')
    expect(low.querySelector('[data-drag-handle]')).not.toBeNull()
    expect(within(low).getAllByRole('button').length).toBeGreaterThanOrEqual(3)
    // editing a value still works from the row
    await userEvent.click(within(low).getAllByRole('button').find(b => /Low/.test(b.textContent ?? '') && !b.hasAttribute('data-drag-handle'))!)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('"Change who can see it" leads to the Access tab', async () => {
    mockApi()
    renderDetail(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Change who can see it' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`${INDEX}/${FORK_ID}/access`)
  })

  it('archiving the fork reloads the detail: archived badge, no further action', async () => {
    let archived = false
    mockApi(priorityFork(), {
      [forkPath]: () => jsonResponse(priorityFork(archived ? { status: 'archived' } : {})),
      [archivePath]: () => {
        archived = true
        return jsonResponse(makeForkList({ status: 'archived' }))
      },
    })
    renderDetail(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Revert to common list…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Archive and revert' }))
    await waitFor(() => expect(document.querySelector('[data-status="archived"]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-panel="fork-provenance"]')).not.toBeNull())
    expect(screen.queryByRole('button', { name: /revert|archive fork/i })).toBeNull()
  })

  it('flag OFF: the approved 4.0.0 detail - nothing added, the source is never read', async () => {
    const fetchMock = mockApi()
    renderDetail(false)
    await waitFor(() => expect(row(FORK_ITEM.low)).not.toBeNull())
    expect(document.querySelector('[data-panel="fork-provenance"]')).toBeNull()
    expect(document.querySelector('[data-origin-item]')).toBeNull()
    expect(document.querySelector('[data-copied-from]')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(callsOf(fetchMock).some(c => c[0].includes('front_sl_01jf8k2m3n4p5q6r7s8t9v0w1x'))).toBe(false)
  })

  it('flag ON, a plain list: no card and no extra attributes', async () => {
    const fetchMock = mockApi(makeSharedList({ id: FORK_ID }))
    renderDetail(true)
    await waitFor(() => expect(row(FORK_ITEM.low)).not.toBeNull())
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(3))
    expect(document.querySelector('[data-panel="fork-provenance"]')).toBeNull()
    expect(document.querySelector('[data-origin-item]')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(within(document.body).queryByRole('button', { name: /revert|archive fork/i })).toBeNull()
  })
})
