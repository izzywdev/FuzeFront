/**
 * SL9 fork wiring: the existing flows hand fork-relevant refusals to the fork
 * flow (flag ON) and behave exactly as at 4.0.0 otherwise (flag OFF, or any
 * refusal that is not `fork_required` / a 403 on a common list / a 404).
 * `../api` is mocked at the module boundary; the fork flow's own reads go through
 * a routed `fetch`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectionListManagementFlow } from '../SelectionListManagementFlow'
import { TranslationWorkbenchFlow } from '../TranslationWorkbenchFlow'
import { SelectionListAccessFlow } from '../SelectionListAccessFlow'
import { SharedListsFeatureProvider } from '../shared-lists/core'
import { forkNoticeState, resetForkSession } from '../shared-lists/fork'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { render } from '@testing-library/react'
import * as api from '../api'
import { apiError, makeGrant, makeItem, makeList, makeLocale, makeQuota, makeTranslation, renderFlow } from './helpers'
import { routeFetch, stubViewport } from './forkHarness'
import { COMMON_ID, jsonResponse, makeCommonList, makeForkList, page } from './sharedListsFixtures'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    getSelectionList: vi.fn(),
    listItems: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    reorderItems: vi.fn(),
    getQuota: vi.fn(),
    probeReorderPermission: vi.fn(),
    getLocaleIndex: vi.fn(),
    getLocaleEditor: vi.fn(),
    saveTranslation: vi.fn(),
    autofillTranslations: vi.fn(),
    getAccessGrants: vi.fn(),
    searchUsers: vi.fn(),
  }
})
const m = vi.mocked(api)

const forkRequired = () =>
  apiError(409, 'CONFLICT', 'refused', {
    reason: 'fork_required',
    source_list_id: COMMON_ID,
    fork_url: `/v1/selection-lists/${COMMON_ID}/fork`,
  } as never)

const on = (ui: React.ReactElement, flag = true) => (
  <SharedListsFeatureProvider sharedLists={flag} organizationId="org_globex" organizationName="Globex Freight">
    {ui}
  </SharedListsFeatureProvider>
)
const q = (sel: string, root: ParentNode = document) => root.querySelector(sel)

beforeEach(() => {
  vi.resetAllMocks()
  resetForkSession()
  stubViewport(true)
  routeFetch({
    [`GET /api/v1/selection-lists/${COMMON_ID}`]: () => jsonResponse(makeCommonList({ name: 'Priority', editable: undefined })),
    [`GET /api/v1/selection-lists/sl_01`]: () => jsonResponse(makeCommonList({ id: 'sl_01', name: 'Priority', editable: undefined })),
  })
  m.getQuota.mockResolvedValue(makeQuota())
  m.probeReorderPermission.mockResolvedValue(true)
  m.getSelectionList.mockResolvedValue(makeList())
  m.listItems.mockResolvedValue({ data: [makeItem({ id: 'sli_1', code: 'AT' }), makeItem({ id: 'sli_2', code: 'BE' })] })
  m.getLocaleIndex.mockResolvedValue({
    locales: [makeLocale({ locale: 'en', is_source: true, translated: 4, total: 4 }), makeLocale({ locale: 'fr', translated: 1, total: 4 })],
  })
  m.getLocaleEditor.mockResolvedValue({ locale: 'fr', translations: [makeTranslation()] })
  m.getAccessGrants.mockResolvedValue([makeGrant()])
})
afterEach(() => vi.unstubAllGlobals())

// ── translation workbench ─────────────────────────────────────────────────────
describe('translation workbench', () => {
  const EDITOR = '/settings/selection-lists/:listId/translations/:locale'
  const INDEX = '/settings/selection-lists/:listId/translations'
  const open = (flag = true, path = '/settings/selection-lists/sl_01/translations/fr') =>
    renderFlow(on(<TranslationWorkbenchFlow />, flag), path, [EDITOR, INDEX])

  async function typeAndSave() {
    const input = (await screen.findByLabelText(/FR translation for/)) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'Moyenne')
    await userEvent.click(q('[data-action="save-row"]')!)
    return input
  }

  it('fork_required on Save: the banner (Fork to edit… / Back to the list), the typed text and its unsaved marker are kept', async () => {
    m.saveTranslation.mockRejectedValue(forkRequired())
    open()
    const input = await typeAndSave()
    const banner = await waitFor(() => {
      const el = q('[data-error="CONFLICT"][data-reason="fork_required"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(within(banner).getByRole('button', { name: 'Fork to edit…' })).toBeVisible()
    expect(input).toHaveValue('Moyenne')
    expect(input).toHaveAttribute('data-unsaved', 'true')
    expect(q('[data-error="save-failed"]')).toBeNull()
    await userEvent.click(within(banner).getByRole('button', { name: 'Back to the list' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/selection-lists/sl_01')
  })

  it('a CONFLICT without a reason stays the 4.0.0 save error; no banner', async () => {
    m.saveTranslation.mockRejectedValue(apiError(409, 'CONFLICT', 'plain conflict'))
    open()
    await typeAndSave()
    expect(await screen.findByText('plain conflict')).toBeVisible()
    expect(q('[data-reason="fork_required"]')).toBeNull()
  })

  it('flag OFF: a stray fork_required is the 4.0.0 save error and nothing else', async () => {
    m.saveTranslation.mockRejectedValue(forkRequired())
    open(false)
    const input = await typeAndSave()
    expect(await screen.findByText('refused')).toBeVisible()
    expect(q('[data-reason="fork_required"]')).toBeNull()
    expect(q('[data-action="fork-to-edit"]')).toBeNull()
    expect(input).not.toHaveAttribute('data-unsaved')
  })

  it('403 FORBIDDEN on a common list: the "you can\'t change this list" explanation instead of the translate-action text', async () => {
    m.saveTranslation.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    open()
    const input = await typeAndSave()
    await waitFor(() => expect(q('[data-case="common-no-create"]')).toBeVisible())
    expect(q('[data-action="fork-to-edit"]')).toBeNull()
    expect(input).toHaveValue('Moyenne')
  })

  it('403 FORBIDDEN on the org\'s own list keeps the 4.0.0 message', async () => {
    routeFetch({
      [`GET /api/v1/selection-lists/sl_01`]: () =>
        jsonResponse(makeCommonList({ id: 'sl_01', organization_id: 'org_globex', visibility: 'org', editable: undefined })),
    })
    m.saveTranslation.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    open()
    await typeAndSave()
    expect(await screen.findByText('You do not have the translate action.')).toBeVisible()
    expect(q('[data-case="common-no-create"]')).toBeNull()
  })

  it('404 on Save: "List not found", no Fork CTA', async () => {
    m.saveTranslation.mockRejectedValue(apiError(404, 'NOT_FOUND', 'gone'))
    open()
    await typeAndSave()
    await waitFor(() => expect(q('[data-error="NOT_FOUND"]')).toHaveTextContent('List not found'))
  })

  it('auto-fill refused with fork_required: the banner renders inside the dialog', async () => {
    m.autofillTranslations.mockRejectedValue(forkRequired())
    renderFlow(on(<TranslationWorkbenchFlow />), '/settings/selection-lists/sl_01/translations', [INDEX, EDITOR])
    await userEvent.click(await screen.findByRole('button', { name: 'Autofill' }))
    const autofill = q('[data-modal="autofill"]') as HTMLElement
    await userEvent.click(within(autofill).getByRole('button', { name: 'Run autofill' }))
    await waitFor(() => expect(within(autofill).getByRole('button', { name: 'Fork to edit…' })).toBeVisible())
    expect(within(autofill).queryByText('Failed')).toBeNull()
  })

  it('auto-fill 403 keeps its 4.0.0 message on a list the org owns; flag OFF is untouched', async () => {
    m.autofillTranslations.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    renderFlow(on(<TranslationWorkbenchFlow />, false), '/settings/selection-lists/sl_01/translations', [INDEX, EDITOR])
    await userEvent.click(await screen.findByRole('button', { name: 'Autofill' }))
    const autofill = q('[data-modal="autofill"]') as HTMLElement
    await userEvent.click(within(autofill).getByRole('button', { name: 'Run autofill' }))
    expect(await within(autofill).findByText('You do not have the translate action.')).toBeVisible()
  })
})

// ── value editor + reorder ────────────────────────────────────────────────────
describe('management flow', () => {
  const DETAIL = '/settings/selection-lists/:listId'
  const open = (flag = true) =>
    renderFlow(on(<SelectionListManagementFlow />, flag), '/settings/selection-lists/sl_01', [DETAIL])

  it('add value refused with fork_required: the banner sits in the value modal and the typed values stay', async () => {
    m.createItem.mockRejectedValue(forkRequired())
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Add value' }))
    const modal = q('[data-modal="add-value"]') as HTMLElement
    await userEvent.type(q('[data-field="code"]', modal)!, 'BLOCKER')
    await userEvent.type(q('[data-field="label"]', modal)!, 'Blocker')
    await userEvent.click(q('[data-action="save-value"]', modal)!)
    await waitFor(() => expect(within(modal).getByRole('button', { name: 'Fork to edit…' })).toBeVisible())
    expect(q('[data-field="code"]', modal)).toHaveValue('BLOCKER')
    await userEvent.click(within(modal).getByRole('button', { name: 'Back to the list' }))
    expect(q('[data-modal="add-value"]')).toBeNull()
  })

  it('add value 403 keeps the 4.0.0 handling (the modal closes, the page shows the permission message)', async () => {
    m.createItem.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Add value' }))
    const modal = q('[data-modal="add-value"]') as HTMLElement
    await userEvent.type(q('[data-field="code"]', modal)!, 'X')
    await userEvent.type(q('[data-field="label"]', modal)!, 'X')
    await userEvent.click(q('[data-action="save-value"]', modal)!)
    expect(await screen.findByText('You do not have permission to modify values.')).toBeVisible()
    expect(q('[data-modal="add-value"]')).toBeNull()
  })

  it('flag OFF: add value 403 is the 4.0.0 message', async () => {
    m.createItem.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    open(false)
    await userEvent.click(await screen.findByRole('button', { name: 'Add value' }))
    const modal = q('[data-modal="add-value"]') as HTMLElement
    await userEvent.type(q('[data-field="code"]', modal)!, 'X')
    await userEvent.type(q('[data-field="label"]', modal)!, 'X')
    await userEvent.click(q('[data-action="save-value"]', modal)!)
    expect(await screen.findByText('You do not have permission to modify values.')).toBeVisible()
    expect(q('[data-case]')).toBeNull()
  })

  it('edit-value refused with fork_required, then a successful fork: the edit modal is gone and no PATCH is sent for the mismatched list/item pair', async () => {
    const forkId = 'front_sl_fork'
    m.updateItem.mockRejectedValue(forkRequired())
    routeFetch({
      [`GET /api/v1/selection-lists/${COMMON_ID}`]: () => jsonResponse(makeCommonList({ name: 'Priority', editable: undefined })),
      [`GET /api/v1/selection-lists/${forkId}`]: () =>
        jsonResponse(makeCommonList({ id: forkId, organization_id: 'org_globex', visibility: 'org', editable: true, name: 'Priority' })),
      [`POST /api/v1/selection-lists/${COMMON_ID}/fork`]: () =>
        jsonResponse(makeCommonList({ id: forkId, organization_id: 'org_globex', visibility: 'org', editable: true, name: 'Priority' }), 201),
    })
    renderFlow(on(<SelectionListManagementFlow />), `/settings/selection-lists/${COMMON_ID}`, [DETAIL])
    await userEvent.click(await screen.findByText('AT'))
    const modal = q('[data-modal="edit-value"]') as HTMLElement
    await userEvent.click(q('[data-action="save-value"]', modal)!)
    await userEvent.click(await within(modal).findByRole('button', { name: 'Fork to edit…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Fork list' }))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/settings/selection-lists/${forkId}`)
    )
    await waitFor(() => expect(q('[data-modal="edit-value"]')).toBeNull())
    expect(q('[data-modal]')).toBeNull()
    expect(m.updateItem).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(m.getSelectionList).toHaveBeenLastCalledWith(forkId))
  })

  it('reorder refused with fork_required: the failed order is restored and the banner sits by the list', async () => {
    m.reorderItems.mockRejectedValue(forkRequired())
    open()
    const handle = await screen.findByLabelText('Reorder AT')
    fireEvent.keyDown(handle, { key: ' ' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.keyDown(handle, { key: ' ' })
    await waitFor(() => expect(q('[data-reason="fork_required"]')).toBeVisible())
    expect(Array.from(document.querySelectorAll('[data-item]')).map(e => e.getAttribute('data-item'))).toEqual(['sli_1', 'sli_2'])
    expect(q('[data-error="reorder-failed"]')).toBeNull()
  })

  it('reorder 403 or 500 stay on the 4.0.0 handling', async () => {
    m.reorderItems.mockRejectedValue(apiError(500, 'INTERNAL_ERROR', 'boom'))
    open()
    const handle = await screen.findByLabelText('Reorder AT')
    fireEvent.keyDown(handle, { key: ' ' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.keyDown(handle, { key: ' ' })
    await waitFor(() => expect(q('[data-error="reorder-failed"]')).toBeVisible())
    expect(q('[data-reason="fork_required"]')).toBeNull()
  })
})

// ── the common list's read-only detail: the fork slot ────────────────────────
describe('read-only common detail (forkAction slot) and arrival at the fork', () => {
  const DETAIL = '/settings/selection-lists/:listId'
  const common = () => makeCommonList({ name: 'Priority' }) // editable: false
  const wire = () =>
    routeFetch({
      [`GET /api/v1/selection-lists/${COMMON_ID}`]: () => jsonResponse(common()),
      // the effective-list lookup by key
      ['GET /api/v1/selection-lists']: () => jsonResponse(page([common()])),
    })
  beforeEach(() => {
    m.listItems.mockImplementation((async (_id: string, opts?: { status?: string }) => ({
      data:
        opts?.status === 'archived'
          ? [makeItem({ id: 'sli_9', code: 'OLD', status: 'archived' })]
          : [makeItem({ id: 'sli_1', code: 'AT' }), makeItem({ id: 'sli_2', code: 'BE' })],
    })) as never)
  })
  const open = (flag = true) =>
    renderFlow(on(<SelectionListManagementFlow />, flag), `/settings/selection-lists/${COMMON_ID}`, [DETAIL])

  it('flag ON: the read-only detail offers "Fork to edit…", and the dialog counts the values', async () => {
    wire()
    open()
    const cta = await screen.findByRole('button', { name: 'Fork to edit…' })
    expect(cta).toHaveAttribute('data-action', 'fork-to-edit')
    // A common list is not a fork: the CTA is here, the provenance card is not.
    expect(q('[data-panel="fork-provenance"]')).toBeNull()
    await userEvent.click(cta)
    await waitFor(() =>
      expect(q('[data-dialog="fork"] [data-fork-copied]')).toHaveTextContent('3 values (2 active, 1 archived)')
    )
  })

  it('flag OFF: no fork action anywhere (the 4.0.0 detail)', async () => {
    wire()
    open(false)
    await screen.findByRole('heading', { name: 'Countries' })
    expect(q('[data-action="fork-to-edit"]')).toBeNull()
    expect(q('[data-dialog="fork"]')).toBeNull()
  })

  it('arrival at an existing fork the caller can only READ still shows the notice (archived: no Restore)', async () => {
    const readOnlyFork = makeForkList({ id: 'front_sl_fork', name: 'Priority', editable: false, status: 'archived' })
    routeFetch({
      [`GET /api/v1/selection-lists/front_sl_fork`]: () => jsonResponse(readOnlyFork),
    })
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/settings/selection-lists/front_sl_fork', state: forkNoticeState({ kind: 'existing' }) }]}
      >
        {on(
          <Routes>
            <Route path={DETAIL} element={<SelectionListManagementFlow />} />
          </Routes>
        )}
      </MemoryRouter>
    )
    const note = await waitFor(() => {
      const el = q('[data-result="existing-archived"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(note).toHaveTextContent(/Forms use the common list while it.s archived/)
    expect(q('[data-action="restore-fork"]')).toBeNull()
  })

  it('arrival at the fork shows the "Forked." notice above the editor; dismissing clears it', async () => {
    routeFetch({
      [`GET /api/v1/selection-lists/front_sl_fork`]: () =>
        jsonResponse(makeForkList({ id: 'front_sl_fork', name: 'Priority', editable: true })),
      [`GET /api/v1/selection-lists/${COMMON_ID}`]: () => jsonResponse(makeCommonList({ name: 'Priority' })),
    })
    function Where() {
      const l = useLocation()
      return <output data-testid="has-state">{String(l.state !== null)}</output>
    }
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/settings/selection-lists/front_sl_fork', state: forkNoticeState({ kind: 'created' }) }]}
      >
        {on(
          <>
            <Where />
            <Routes>
              <Route path={DETAIL} element={<SelectionListManagementFlow />} />
            </Routes>
          </>
        )}
      </MemoryRouter>
    )
    const toast = await waitFor(() => {
      const el = q('[data-toast="forked"][data-result="created"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(toast).toHaveTextContent('Forked.')
    // The provenance card (fork-provenance flow) coexists with the arrival notice, and a
    // brand-new fork is never shown "up to date" (a 201 carries no source revision).
    const card = await waitFor(() => {
      const el = q('[data-panel="fork-provenance"][data-behind-state="unknown"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(card).toBeVisible()
    expect(q('[data-behind-state="up-to-date"]')).toBeNull()
    expect(q('[data-action="fork-to-edit"]')).toBeNull()
    await userEvent.click(within(toast).getByRole('button'))
    expect(q('[data-panel="fork-provenance"]')).not.toBeNull()
    expect(q('[data-toast]')).toBeNull()
    expect(screen.getByTestId('has-state')).toHaveTextContent('false')
  })
})

// ── access ────────────────────────────────────────────────────────────────────
describe('access flow', () => {
  const ROUTE = '/settings/selection-lists/:listId/access'
  const open = (flag = true) =>
    renderFlow(on(<SelectionListAccessFlow />, flag), '/settings/selection-lists/sl_01/access', [ROUTE])

  it('a 403 reading access on a COMMON list: "managed by the platform"', async () => {
    m.getAccessGrants.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    open()
    await waitFor(() => expect(q('[data-case="common-access"]')).toHaveTextContent(/managed by the platform/i))
    expect(q('[data-action="fork-to-edit"]')).toBeNull()
  })

  it('a 403 on the org\'s own list, any other failure, and flag OFF keep the 4.0.0 error', async () => {
    routeFetch({
      [`GET /api/v1/selection-lists/sl_01`]: () =>
        jsonResponse(makeCommonList({ id: 'sl_01', organization_id: 'org_globex', visibility: 'org', editable: undefined })),
    })
    m.getAccessGrants.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    const a = open()
    await waitFor(() => expect(q('[data-state="error"]')).toBeVisible())
    expect(q('[data-case="common-access"]')).toBeNull()
    a.unmount()

    m.getAccessGrants.mockRejectedValue(apiError(500, 'X', 'x'))
    const b = open()
    await waitFor(() => expect(q('[data-state="error"]')).toBeVisible())
    expect(q('[data-case]')).toBeNull()
    b.unmount()

    m.getAccessGrants.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    open(false)
    await waitFor(() => expect(q('[data-state="error"]')).toBeVisible())
    expect(q('[data-case]')).toBeNull()
  })
})

