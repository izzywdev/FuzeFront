/**
 * ForkListFlow (frames 04, 05, 06, 12) — the orchestrator of the "fork" flow.
 *
 * It owns the open/closed state of ForkListDialog, decides what the user can do
 * (never from a guess at their role), and lands the result:
 *
 *  DETAIL mode  (`list`, no `refusal`) — a common list's read-only detail:
 *    the effective-list check -> `forkCtaFor` -> ForkToEditButton -> dialog.
 *    Pass `effective` when the page already holds the lookup (so it is asked once).
 *
 *  REFUSAL mode (`refusal` = a classified mutation failure) — a mutation (value
 *    editor, reorder, list settings, translation workbench, auto-fill) was
 *    refused: `fork_required` -> ForkRequiredBanner whose CTA forks the list the
 *    SERVICE named (`sourceListId`, not the URL id); `forbidden` on a shared list
 *    -> the "you can't change this list" explanation (no CTA); `not_found` ->
 *    "List not found". Anything else (and flag OFF) renders `fallback` — the
 *    caller's own 4.0.0 message — so existing behaviour is untouched.
 *
 * Success (201 / 200) navigates to the fork with the success notice carried in
 * location state (ForkResultNotice renders it on arrival). Refusals stay inside
 * the open dialog. Nothing ever forks without the user pressing "Fork list".
 *
 * Flag OFF: only `fallback` renders; no dialog, CTA or banner is ever mounted.
 */

import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  editableStateOf,
  forkCtaFor,
  isCommonList,
  useEffectiveList,
  useSharedList,
  useSharedLists,
  type ApiFailure,
  type EffectiveLookup,
  type ForkOutcome,
  type SelectionListId,
  type SharedList,
} from '../core'
import type { ValueCounts } from './copy'
import { ForkListDialog, type ForkSuccess } from './ForkListDialog'
import { ForkRequiredBanner } from './ForkRequiredBanner'
import {
  CommonNoCreateNotice,
  ListNotFoundNotice,
} from './ForkRefusalNotice'
import { ForkToEditButton } from './ForkToEditButton'
import { SELECTION_LISTS_ROUTE, forkNoticeState, listRoute } from './notice'
import { hasForkForbidden, markForkForbidden } from './session'

export interface ForkListFlowProps {
  /**
   * DETAIL mode: the common list on screen. REFUSAL mode: the list the refused
   * control belongs to, when the page holds it (saves a read).
   */
  list?: SharedList
  /** REFUSAL mode without `list`: the id of the list the refused control belongs to. */
  listId?: SelectionListId
  /** A classified mutation refusal (`classifyMutationError`). Switches to REFUSAL mode. */
  refusal?: ApiFailure
  /** The source's loaded values (`status=all`), for the "(4 active, 1 archived)" copy. */
  counts?: ValueCounts
  /** Languages besides the source locale. */
  localeCount?: number
  /** DETAIL mode: the page's own effective-list lookup, so it is asked once. */
  effective?: EffectiveLookup
  /** Rendered when this flow has nothing to say (flag OFF, a non-fork refusal). */
  fallback?: ReactNode
  /** Overrides the provider's organization name. */
  organizationName?: string
  /** "Back to the list" on the banner. */
  onBack?: () => void
  /** The dialog was closed on a stale answer (`fork_not_applicable`): reload the detail. */
  onStale?: () => void
}

export function ForkListFlow(props: ForkListFlowProps) {
  const shared = useSharedLists()
  if (!shared.enabled) return <>{props.fallback ?? null}</>
  return props.refusal ? (
    <RefusalFlow {...props} refusal={props.refusal} />
  ) : props.list ? (
    <DetailFlow {...props} list={props.list} />
  ) : (
    <>{props.fallback ?? null}</>
  )
}

// ── shared: the dialog + what happens when it ends ────────────────────────────

function useForkDialog(opts: {
  organizationId: string | undefined
  onStale?: () => void
}) {
  const navigate = useNavigate()
  const [sourceId, setSourceId] = useState<SelectionListId | null>(null)
  const [forbidden, setForbidden] = useState(() =>
    hasForkForbidden(opts.organizationId)
  )

  const onForked = (outcome: ForkSuccess) => {
    // The fork now exists: leave the source behind and land on it.
    navigate(listRoute(outcome.list.id), {
      state: forkNoticeState({ kind: outcome.kind }),
    })
  }
  const onClose = (outcome?: ForkOutcome) => {
    setSourceId(null)
    if (outcome?.kind === 'forbidden') {
      markForkForbidden(opts.organizationId)
      setForbidden(true)
    }
    if (outcome?.kind === 'fork_not_applicable') opts.onStale?.()
    // "Back to lists": the source is gone, or the key belongs to a list we must not name.
    if (outcome?.kind === 'key_taken' || outcome?.kind === 'not_found')
      navigate(SELECTION_LISTS_ROUTE)
  }
  return { sourceId, open: setSourceId, forbidden, onForked, onClose }
}

/** The dialog for `sourceId`, using the loaded list when it is the source, else reading it. */
function SourceDialog({
  sourceId,
  known,
  counts,
  localeCount,
  organizationName,
  onForked,
  onClose,
}: {
  sourceId: SelectionListId
  known?: SharedList
  counts?: ValueCounts
  localeCount?: number
  organizationName?: string
  onForked: (outcome: ForkSuccess) => void
  onClose: (outcome?: ForkOutcome) => void
}) {
  return known && known.id === sourceId ? (
    <ForkListDialog
      source={known}
      counts={counts}
      localeCount={localeCount}
      organizationName={organizationName}
      onForked={onForked}
      onClose={onClose}
    />
  ) : (
    <LoadedSourceDialog
      sourceId={sourceId}
      localeCount={localeCount}
      organizationName={organizationName}
      onForked={onForked}
      onClose={onClose}
    />
  )
}

/**
 * The refused list is not the one on screen: read it for the dialog's wording.
 * The fork itself needs only the id, so a slow or failed read never blocks it —
 * the dialog shows generic wording until (unless) the list arrives.
 */
function LoadedSourceDialog({
  sourceId,
  localeCount,
  organizationName,
  onForked,
  onClose,
}: {
  sourceId: SelectionListId
  localeCount?: number
  organizationName?: string
  onForked: (outcome: ForkSuccess) => void
  onClose: (outcome?: ForkOutcome) => void
}) {
  const source = useSharedList(sourceId)
  return (
    <ForkListDialog
      source={source.phase === 'ready' ? source.list : { id: sourceId }}
      localeCount={localeCount}
      organizationName={organizationName}
      onForked={onForked}
      onClose={onClose}
    />
  )
}

// ── detail mode ───────────────────────────────────────────────────────────────

function DetailFlow({
  list,
  counts,
  localeCount,
  effective,
  organizationName,
  onStale,
}: ForkListFlowProps & { list: SharedList }) {
  const shared = useSharedLists()
  const dialog = useForkDialog({
    organizationId: shared.organizationId,
    onStale,
  })
  // Only a read-only common list can offer Fork; the lookup is asked at most once.
  const candidate = isCommonList(list) && editableStateOf(list) === 'read-only'
  const own = useEffectiveList(list.key, {
    skip: !candidate || effective !== undefined,
  })
  const cta = forkCtaFor({
    list,
    sharedLists: true,
    effective: effective ?? own,
    forkForbidden: dialog.forbidden,
  })
  return (
    <>
      <ForkToEditButton
        cta={cta}
        listName={list.name}
        organizationName={organizationName}
        onFork={() => dialog.open(list.id)}
      />
      {dialog.sourceId && (
        <SourceDialog
          sourceId={dialog.sourceId}
          known={list}
          counts={counts}
          localeCount={localeCount}
          organizationName={organizationName}
          onForked={dialog.onForked}
          onClose={dialog.onClose}
        />
      )}
    </>
  )
}

// ── refusal mode ──────────────────────────────────────────────────────────────

function RefusalFlow({
  refusal,
  list,
  listId,
  counts,
  localeCount,
  fallback,
  organizationName,
  onBack,
  onStale,
}: ForkListFlowProps & { refusal: ApiFailure }) {
  const shared = useSharedLists()
  const dialog = useForkDialog({
    organizationId: shared.organizationId,
    onStale,
  })

  switch (refusal.kind) {
    case 'fork_required':
      return (
        <>
          <ForkRequiredBanner
            sourceListId={refusal.sourceListId}
            forkUrl={refusal.forkUrl}
            listName={list?.id === refusal.sourceListId ? list.name : undefined}
            organizationName={organizationName}
            onFork={dialog.open}
            onBack={onBack}
          />
          {dialog.sourceId && (
            <SourceDialog
              sourceId={dialog.sourceId}
              known={list}
              counts={counts}
              localeCount={localeCount}
              organizationName={organizationName}
              onForked={dialog.onForked}
              onClose={dialog.onClose}
            />
          )}
        </>
      )
    case 'forbidden':
      return (
        <ForbiddenOnMutation
          list={list}
          listId={listId}
          organizationName={organizationName}
          fallback={fallback}
        />
      )
    case 'not_found':
      return <ListNotFoundNotice />
    default:
      return <>{fallback ?? null}</>
  }
}

/**
 * A 403 FORBIDDEN on a mutation. On a COMMON list it means "you can't create
 * lists here, so you can't fork it either" (no CTA); on any other list it is
 * the plain 4.0.0 permission message, which stays the caller's `fallback`.
 * Whether the list is shared is read from the list — loaded here when the page
 * does not hold it — and the fallback shows meanwhile, so nothing flashes blank.
 */
function ForbiddenOnMutation({
  list,
  listId,
  organizationName,
  fallback,
}: {
  list?: SharedList
  listId?: SelectionListId
  organizationName?: string
  fallback?: ReactNode
}) {
  const shared = useSharedLists()
  const loaded = useSharedList(list ? null : listId)
  const known = list ?? (loaded.phase === 'ready' ? loaded.list : undefined)
  if (!known || !isSharedByOthers(known, shared.organizationId))
    return <>{fallback ?? null}</>
  return (
    <CommonNoCreateNotice
      listName={known.name}
      organizationName={organizationName}
    />
  )
}

/**
 * Whether the caller reads this list WITHOUT owning it: a common list, or (when
 * the host passed its organization id) any list owned by another organization —
 * which the service only ever shows a caller if it is common.
 */
export function isSharedByOthers(
  list: SharedList,
  organizationId: string | undefined
): boolean {
  return (
    isCommonList(list) ||
    (organizationId !== undefined && list.organization_id !== organizationId)
  )
}
