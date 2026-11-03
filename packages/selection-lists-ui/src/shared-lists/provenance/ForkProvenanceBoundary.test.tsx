import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForkProvenanceBoundary } from './ForkProvenanceBoundary'
import { CopiedFromLabel } from './CopiedFromLabel'
import { useForkProvenanceContext } from './ProvenanceContext'
import {
  API,
  COMMON_ITEM,
  FORK_ID,
  FORK_ITEM,
  commonItems,
  error,
  forkItems,
  forkPath,
  jsonResponse,
  page,
  priorityCommon,
  priorityFork,
  renderProvenance,
  routeFetch,
  sourceItemsPath,
  sourcePath,
} from '../../test/provenanceFixtures'
import { callsOf, makeSharedList } from '../../test/sharedListsFixtures'
import { render } from '@testing-library/react'

afterEach(() => vi.unstubAllGlobals())

/** A stand-in value editor: one row per item, asking the boundary for its provenance. */
function Rows() {
  const prov = useForkProvenanceContext()
  return (
    <ul data-testid="rows">
      {forkItems().map(item => (
        <li key={item.id} data-item={item.id} {...prov?.originAttributes(item)}>
          {item.label}
          {prov?.copiedFrom(item)}
        </li>
      ))}
    </ul>
  )
}

const mockApi = (fork = priorityFork(), extra: Parameters<typeof routeFetch>[0] = {}) =>
  routeFetch({
    [forkPath]: () => jsonResponse(fork),
    [sourcePath]: () => jsonResponse(priorityCommon()),
    [sourceItemsPath]: () => jsonResponse(page(commonItems())),
    ...extra,
  })

const mount = (opts = {}) =>
  renderProvenance(
    <ForkProvenanceBoundary listId={FORK_ID}>
      <Rows />
    </ForkProvenanceBoundary>,
    opts
  )

describe('ForkProvenanceBoundary', () => {
  it('a fork: the panel above the children, and every row asks the boundary for its provenance', async () => {
    mockApi()
    mount()
    await waitFor(() =>
      expect(document.querySelector('[data-panel="fork-provenance"]')).toHaveAttribute('data-behind-state', 'unknown')
    )
    const row = (id: string) => document.querySelector(`[data-item="${id}"]`) as HTMLElement
    // "Copied from" maps origin_item_id to the loaded source items; null = added in the fork.
    await waitFor(() => expect(row(FORK_ITEM.low)).toHaveTextContent('common “Low”'))
    expect(row(FORK_ITEM.low)).toHaveAttribute('data-origin-item', COMMON_ITEM.low)
    // Acme relabelled NORMAL "Medium": the provenance names the COMMON label.
    expect(row(FORK_ITEM.medium)).toHaveTextContent(/Medium.*common “Normal”/)
    expect(row(FORK_ITEM.medium)).toHaveAttribute('data-origin-item', COMMON_ITEM.normal)
    expect(row(FORK_ITEM.blocker)).toHaveAttribute('data-origin-item', 'none')
    expect(row(FORK_ITEM.blocker)).toHaveTextContent('added in this fork')
    // Panel precedes the rows.
    const panel = document.querySelector('[data-panel="fork-provenance"]') as HTMLElement
    expect(panel.compareDocumentPosition(screen.getByTestId('rows')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the rows never wait for the fork or the comparison: they render at once and stay', async () => {
    mockApi(priorityFork(), { [sourcePath]: () => new Promise(() => {}) })
    mount()
    expect(screen.getByTestId('rows')).toBeInTheDocument()
    await waitFor(() =>
      expect(document.querySelector('[data-panel="fork-provenance"]')).toHaveAttribute('data-behind-state', 'checking')
    )
    expect(screen.getByTestId('rows')).toBeInTheDocument()
  })

  it('source gone: rows say "copied" with no label', async () => {
    mockApi(priorityFork(), { [sourcePath]: () => error(404, 'NOT_FOUND') })
    mount()
    await waitFor(() =>
      expect(document.querySelector('[data-behind-state="source-gone"]')).not.toBeNull()
    )
    const low = document.querySelector(`[data-item="${FORK_ITEM.low}"]`) as HTMLElement
    expect(low).toHaveTextContent('copied')
    expect(low).not.toHaveTextContent('common')
  })

  it('shares ONE source read between the card and the rows', async () => {
    const fetchMock = mockApi()
    mount()
    await waitFor(() => expect(document.querySelector(`[data-item="${FORK_ITEM.low}"]`)).toHaveTextContent('common'))
    const urls = callsOf(fetchMock).map(c => c[0].split('?')[0])
    expect(urls.filter(u => u === `${API}/${FORK_ID}`)).toHaveLength(1)
    expect(urls.filter(u => u.endsWith('front_sl_01jf8k2m3n4p5q6r7s8t9v0w1x'))).toHaveLength(1)
  })

  it('flag OFF: exactly the children, no reads, rows carry nothing extra', () => {
    const fetchMock = mockApi()
    mount({ flag: false })
    expect(screen.getByTestId('rows')).toBeInTheDocument()
    expect(document.querySelector('[data-panel]')).toBeNull()
    expect(document.querySelector('[data-origin-item]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a list that is not a fork: exactly the children and no source read', async () => {
    const fetchMock = mockApi(makeSharedList({ id: FORK_ID }))
    mount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 20))
    expect(document.querySelector('[data-panel]')).toBeNull()
    expect(document.querySelector('[data-origin-item]')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('the fork itself failing to load leaves the children alone', async () => {
    const fetchMock = mockApi(priorityFork(), { [forkPath]: () => error(500, 'UNAVAILABLE') })
    mount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 20))
    expect(screen.getByTestId('rows')).toBeInTheDocument()
    expect(document.querySelector('[data-panel]')).toBeNull()
  })

  it('passes the panel props through (organization name in the confirm)', async () => {
    mockApi()
    renderProvenance(
      <ForkProvenanceBoundary listId={FORK_ID} organizationName="Acme Logistics" onChangeVisibility={() => {}}>
        <Rows />
      </ForkProvenanceBoundary>
    )
    expect(await screen.findByRole('button', { name: 'Change who can see it' })).toBeInTheDocument()
  })
})

describe('useForkProvenanceContext', () => {
  it('is null outside a boundary', () => {
    function Probe() {
      return <span data-testid="p">{String(useForkProvenanceContext())}</span>
    }
    render(<Probe />)
    expect(screen.getByTestId('p')).toHaveTextContent('null')
  })
})

describe('CopiedFromLabel', () => {
  it.each([
    [{ kind: 'added' }, 'added in this fork'],
    [{ kind: 'common', label: 'Low' }, 'common “Low”'],
    [{ kind: 'copied' }, 'copied'],
  ] as const)('%j says %s', (origin, text) => {
    render(<CopiedFromLabel origin={origin} />)
    expect(screen.getByText(text)).toHaveAttribute('data-copied-from', origin.kind)
  })
})
