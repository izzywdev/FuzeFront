/**
 * Pure derivations over the shared-lists view model. No React, no network.
 *
 * Every rule here is one the approved frames state outright; the comment on
 * each names the frame so a reviewer can check it against the source of truth.
 */

import type {
  AuthorPrincipalKind,
  EditableState,
  EffectiveLookup,
  EffectiveSource,
  EffectiveValueRedirect,
  ForkCtaState,
  ListGroups,
  ListQueryParams,
  SelectionListForkProvenance,
  SelectionListVisibility,
  SharedList,
  SharedListsQuery,
  StoredValueOutcome,
} from './types'

// ── Absent fields have defined meanings (contract 4.1.0) ──────────────────────

/** `visibility`, absent = `private` (a 4.0.0-behaviour service omits it). */
export function visibilityOf(list: SharedList): SelectionListVisibility {
  return list.visibility ?? 'private'
}

/** `forked_from`, absent = `null` (not a fork). */
export function forkProvenanceOf(
  list: SharedList
): SelectionListForkProvenance | null {
  return list.forked_from ?? null
}

/**
 * `editable`, three-valued (frames 01, 03): absent is `unknown`, which is NOT
 * `read-only` — it renders no marker and no notice, and each mutation's own
 * authorization answers.
 */
export function editableStateOf(list: SharedList): EditableState {
  if (list.editable === true) return 'editable'
  if (list.editable === false) return 'read-only'
  return 'unknown'
}

/** A common list: readable by every organization, owned by the platform org. */
export function isCommonList(list: SharedList): boolean {
  return visibilityOf(list) === 'platform'
}

/** A fork of a common list (its `forked_from` may dangle; this only reads the pointer). */
export function isFork(list: SharedList): boolean {
  return forkProvenanceOf(list) !== null
}

/**
 * Which kind of principal wrote a row, decided offline from its prefix (frame
 * 03: the read-only hint branches on this and never looks a user up).
 */
export function createdByKind(createdBy: string): AuthorPrincipalKind {
  if (createdBy === '[deleted-user]') return 'deleted-user'
  if (createdBy.startsWith('system:')) return 'system'
  if (createdBy.startsWith('usr_')) return 'user'
  return 'unknown'
}

// ── Index (frame 01) ──────────────────────────────────────────────────────────

/**
 * Turn the index controls into the request's query parameters.
 *
 *  - `include_shared` and `visibility` are sent ONLY while the flag is ON and
 *    the "Include common lists" switch is ON.
 *  - `visibility` is sent only for a real choice; `any` is the absence of the
 *    parameter. The filter is meaningless without `include_shared`, so it is
 *    dropped with the switch.
 *  - Flag OFF therefore yields exactly the 4.0.0 request.
 */
export function toListParams(
  query: SharedListsQuery,
  sharedLists: boolean
): ListQueryParams {
  const params: ListQueryParams = {}
  if (query.limit !== undefined) params.limit = query.limit
  if (query.cursor) params.cursor = query.cursor
  if (query.status) params.status = query.status
  if (query.key) params.key = query.key
  if (query.locale) params.locale = query.locale
  if (sharedLists && query.includeShared) {
    params.include_shared = true
    if (query.visibility && query.visibility !== 'any')
      params.visibility = query.visibility
  }
  return params
}

/** Whether the index shows "Your organization" / "Common lists" groups for this query. */
export function groupingApplies(
  query: SharedListsQuery,
  sharedLists: boolean
): boolean {
  return (
    sharedLists &&
    query.includeShared === true &&
    (query.visibility ?? 'any') === 'any'
  )
}

/** Split rows into the two source groups, keeping the service's order within each. */
export function groupBySource(rows: readonly SharedList[]): ListGroups {
  const own: SharedList[] = []
  const common: SharedList[] = []
  for (const row of rows) (isCommonList(row) ? common : own).push(row)
  return { own, common }
}

/**
 * Keys of the loaded rows that are forks. Drives the index's source-neutral
 * shadow note (frame 01): it states only that the row is a fork and that no
 * common list with that key is listed — it cannot claim the source exists.
 */
export function forkedKeysOf(rows: readonly SharedList[]): string[] {
  return Array.from(new Set(rows.filter(isFork).map(row => row.key)))
}

/** Append a page to the rows already loaded, dropping any id already present. */
export function appendUnique(
  rows: readonly SharedList[],
  next: readonly SharedList[]
): SharedList[] {
  const seen = new Set(rows.map(row => row.id))
  const merged = rows.slice()
  for (const row of next) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  return merged
}

// ── Fork CTA (frames 02, 03, 06) ──────────────────────────────────────────────

/**
 * Decide the Fork CTA. It renders when `visibility = platform`, `editable =
 * false` and the effective list for this key IS this list. It is never offered
 * on a guess: while the effective answer is pending or failed, or when the org
 * already uses its own version, the caller gets a distinct state instead.
 */
export function forkCtaFor(input: {
  list: SharedList
  sharedLists: boolean
  effective: EffectiveLookup
  /** A fork attempt already answered 403 FORBIDDEN in this session. */
  forkForbidden?: boolean
}): ForkCtaState {
  const { list, sharedLists, effective } = input
  if (!sharedLists) return { kind: 'hidden', reason: 'flag-off' }
  if (!isCommonList(list)) return { kind: 'hidden', reason: 'not-common' }
  if (editableStateOf(list) !== 'read-only')
    return { kind: 'hidden', reason: 'not-read-only' }
  if (input.forkForbidden) return { kind: 'forbidden' }
  switch (effective.status) {
    case 'idle':
    case 'loading':
      return { kind: 'pending' }
    case 'error':
      return { kind: 'lookup-failed' }
    case 'none':
      return { kind: 'hidden', reason: 'not-effective' }
    case 'ready':
      return effective.list.id === list.id
        ? { kind: 'offer' }
        : { kind: 'shadowed', ownVersion: effective.list }
  }
}

// ── Picker (frames 09, 10) ────────────────────────────────────────────────────

/**
 * Where the effective list came from, from the one list the service returned
 * (no extra request, and no "behind source" check in a picker).
 */
export function effectiveSourceOf(list: SharedList): EffectiveSource {
  if (isCommonList(list)) return { kind: 'common' }
  const forkedFrom = forkProvenanceOf(list)
  if (forkedFrom) {
    return visibilityOf(list) === 'private'
      ? { kind: 'draft-fork', forkedFrom }
      : { kind: 'fork', forkedFrom }
  }
  return { kind: 'own' }
}

/**
 * The `(stored, effective)` pairs a host may opt in to migrating. Only an item
 * the service redirected to a DIFFERENT id counts; the picker never rewrites
 * the value it holds (frame 10).
 */
export function redirectsOf(
  outcomes: Record<string, StoredValueOutcome>
): EffectiveValueRedirect[] {
  const redirects: EffectiveValueRedirect[] = []
  for (const outcome of Object.values(outcomes)) {
    if (
      outcome.kind === 'resolved' &&
      outcome.effectiveItemId !== null &&
      outcome.effectiveItemId !== outcome.id
    ) {
      redirects.push({ stored: outcome.id, effective: outcome.effectiveItemId })
    }
  }
  return redirects
}

// ── Visibility control (frame 08) ─────────────────────────────────────────────

/**
 * Whether the third, "Every organization" option may render: only for a
 * platform operator acting in the platform org, on a list that is not already
 * common. In the platform org every readable non-common list is its own, so the
 * active-org check doubles as the ownership check. The service still decides
 * (`publish_platform`); this only decides what is shown.
 */
export function canOfferPlatformPublish(input: {
  sharedLists: boolean
  isPlatformOrg: boolean
  list: SharedList
}): boolean {
  return input.sharedLists && input.isPlatformOrg && !isCommonList(input.list)
}

/** Whether a same-origin-relative fork path is safe to keep (never an absolute or protocol-relative URL). */
export function isSameOriginPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value)
}
