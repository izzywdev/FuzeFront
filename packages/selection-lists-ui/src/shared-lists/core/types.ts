/**
 * Shared-lists view model (SL9, contract 4.1.0).
 *
 * Every wire shape here is DERIVED from `@fuzeone/selection-list-client` — the
 * package never restates a request/response field. The client is imported
 * type-only: nothing in `shared-lists/core` pulls it into the runtime bundle.
 *
 * This module is approval-independent infrastructure (frames manifest,
 * `build.sharedInfrastructure`): types and constants only, no UI.
 */

import type {
  AuthorPrincipalKind,
  ListSelectionListsParams,
  Locale,
  Page,
  Paged,
  QuotaScope,
  ResolvedSelectionListItem,
  SelectionList,
  SelectionListErrorBody,
  SelectionListErrorDetail,
  SelectionListErrorReason,
  SelectionListForkProvenance,
  SelectionListForkRequest,
  SelectionListId,
  SelectionListItemId,
  SelectionListUpdate,
  SelectionListVisibility,
  StatusFilter,
} from '@fuzeone/selection-list-client'

export type {
  AuthorPrincipalKind,
  Locale,
  Page,
  Paged,
  QuotaScope,
  ResolvedSelectionListItem,
  SelectionListErrorBody,
  SelectionListErrorDetail,
  SelectionListErrorReason,
  SelectionListForkProvenance,
  SelectionListForkRequest,
  SelectionListId,
  SelectionListItemId,
  SelectionListVisibility,
  StatusFilter,
}

/** A list as the 4.1.0 service sends it (`visibility`, `forked_from`, `editable` included). */
export type SharedList = SelectionList

/** Every visibility, narrowest first. */
export const LIST_VISIBILITIES: readonly SelectionListVisibility[] = [
  'private',
  'org',
  'platform',
]

/** The visibility a fork may be created with (`SelectionListForkRequest.visibility`). */
export type ForkVisibility = NonNullable<SelectionListForkRequest['visibility']>

/** Fork visibility the service applies when the body names none. */
export const DEFAULT_FORK_VISIBILITY: ForkVisibility = 'org'

/**
 * The index's visibility filter control. `'any'` means "no filter": the
 * parameter is absent from the request, it is never sent as a value.
 */
export type VisibilityFilter = 'any' | SelectionListVisibility

// ── Source grouping (frame 01) ────────────────────────────────────────────────

/** Which index group a list belongs to. */
export type ListSourceGroup = 'own' | 'common'

/** Group headings, worded exactly as the approved index frame words them. */
export const SOURCE_GROUP_LABELS: Record<ListSourceGroup, string> = {
  own: 'Your organization',
  common: 'Common lists',
}

/** The index rows split by source. */
export interface ListGroups {
  own: SharedList[]
  common: SharedList[]
}

// ── Caller-relative hints ─────────────────────────────────────────────────────

/**
 * `SelectionList.editable`, three-valued. `unknown` is NOT `read-only`: an
 * absent hint means a 4.0.0-behaviour service, and each mutation's own
 * authorization then decides.
 */
export type EditableState = 'editable' | 'read-only' | 'unknown'

/**
 * Where the effective list for a key came from — drives the opt-in
 * `showSource` caption on the picker and nothing else.
 */
export type EffectiveSource =
  | { kind: 'common' }
  | { kind: 'fork'; forkedFrom: SelectionListForkProvenance }
  | { kind: 'draft-fork'; forkedFrom: SelectionListForkProvenance }
  | { kind: 'own' }

/**
 * The answer to "which list does this key mean for this organization?"
 * (`useEffectiveList`). `none` is a 200 with an empty page — not an error, and
 * not the 403 a developer-role caller gets (that is `error`).
 */
export type EffectiveLookup =
  /** No key was given, so nothing is looked up. */
  | { status: 'idle' }
  | { status: 'loading' }
  /** `source` is `null` while the shared-lists flag is OFF: no caption, ever. */
  | { status: 'ready'; list: SharedList; source: EffectiveSource | null }
  | { status: 'none' }
  | { status: 'error'; error: ApiFailure }

/**
 * What the Fork CTA on a list detail should do (frames 02, 03, 06). The CTA is
 * decided from the list, never from a guess at the caller's role.
 */
export type ForkCtaState =
  | {
      kind: 'hidden'
      reason: 'flag-off' | 'not-common' | 'not-read-only' | 'not-effective'
    }
  /** Waiting for the effective-list answer: render neither the CTA nor an edit control. */
  | { kind: 'pending' }
  /** The effective-list lookup failed: no CTA ("Couldn't check…" + Retry). */
  | { kind: 'lookup-failed' }
  /** The org already uses its own version for this key; forking again would only return it. */
  | { kind: 'shadowed'; ownVersion: SharedList }
  /** A fork attempt already answered 403 FORBIDDEN this session: show the explanation instead. */
  | { kind: 'forbidden' }
  | { kind: 'offer' }

// ── Query ─────────────────────────────────────────────────────────────────────

/** What the list index controls hold (before the flag/toggle rules turn them into a request). */
export interface SharedListsQuery {
  status?: StatusFilter
  /** The "Include common lists" switch. */
  includeShared?: boolean
  visibility?: VisibilityFilter
  cursor?: string | null
  locale?: Locale
  key?: string
  limit?: number
}

/** The wire query parameters of `GET /v1/selection-lists`, as the client defines them. */
export type ListQueryParams = ListSelectionListsParams

// ── Errors and outcomes ───────────────────────────────────────────────────────

/** A quota scope the service named; unknown scopes are passed through untouched. */
export type QuotaScopeName = QuotaScope | (string & {})

/**
 * Every way a request can fail, decided from `status` + `code` + `reason` only
 * — never from `message`, and never from a guess about the caller's role
 * (a 403 is branched on `code`: `FORBIDDEN` and `QUOTA_EXCEEDED` share it).
 */
export type ApiFailure =
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | {
      kind: 'quota'
      /** Unknown scopes are passed through; the copy falls back to "A limit was reached". */
      scope: QuotaScopeName | undefined
      limit: number | undefined
      current: number | undefined
    }
  | { kind: 'not_found' }
  | { kind: 'validation'; details: SelectionListErrorDetail[] | undefined }
  /**
   * 409 `fork_required` AND the shared-lists flag is ON AND the body names the
   * source list. `sourceListId` is the list the service refused — NOT the id in
   * the page URL. `forkUrl` is kept only when it is same-origin relative.
   */
  | {
      kind: 'fork_required'
      sourceListId: SelectionListId
      forkUrl: string | undefined
    }
  /** Any other 409 (key taken, last owner, unknown reason, `fork_required` with the flag OFF). */
  | { kind: 'conflict'; reason: string | undefined }
  /** Transport failure or 5xx/other: the outcome of a write is unknown. */
  | { kind: 'unknown'; status: number | undefined; network: boolean }

/** `POST …/fork` answers, one variant per row of frame 06. */
export type ForkOutcome =
  /** 201 — a new fork; the caller is its owner. */
  | { kind: 'created'; list: SharedList }
  /** 200 — the org already had one; nothing was created. Not an error. */
  | { kind: 'existing'; list: SharedList }
  /** 409 `fork_exists` — a fork the caller cannot read; there is no id to link to. */
  | { kind: 'fork_exists' }
  /** 409 `fork_not_applicable` — the list already belongs to the caller's org. */
  | { kind: 'fork_not_applicable' }
  /** 409 without a (known) reason — the key is held by a list that is not a fork of this one. */
  | { kind: 'key_taken' }
  /** 403 `QUOTA_EXCEEDED`. */
  | {
      kind: 'quota'
      scope: QuotaScopeName | undefined
      limit: number | undefined
      current: number | undefined
    }
  /** 400 `VALIDATION_ERROR` — the source is over the service's value cap. */
  | { kind: 'too_large' }
  /** 403 `FORBIDDEN` — the caller's role cannot create lists. */
  | { kind: 'forbidden' }
  | { kind: 'unauthenticated' }
  /** 404 — the source is gone or unreadable. */
  | { kind: 'not_found' }
  /** Network failure / 5xx: the fork may or may not exist; retrying the same body is safe. */
  | { kind: 'unknown_outcome'; status: number | undefined }

/** `PATCH {status:'active'}` answers (restore an archived fork, frame 06). */
export type RestoreOutcome =
  | { kind: 'restored'; list: SharedList }
  | {
      kind: 'quota'
      scope: QuotaScopeName | undefined
      limit: number | undefined
      current: number | undefined
    }
  | { kind: 'forbidden' }
  | { kind: 'unauthenticated' }
  | { kind: 'not_found' }
  | {
      kind: 'fork_required'
      sourceListId: SelectionListId
      forkUrl: string | undefined
    }
  | { kind: 'conflict'; reason: string | undefined }
  | { kind: 'unknown_outcome'; status: number | undefined }

/** `PATCH {visibility}` answers (frame 08). */
export type VisibilityOutcome =
  | { kind: 'changed'; list: SharedList }
  /** 409 `visibility_locked` — a common list can never be demoted; reload the list. */
  | { kind: 'locked' }
  /**
   * 403 `FORBIDDEN`. `requested` echoes the visibility that was refused so the
   * UI can word it: `platform` is "You can't publish common lists", anything
   * else is "Only the list's owner can change who sees it".
   */
  | { kind: 'forbidden'; requested: SelectionListVisibility }
  | { kind: 'unauthenticated' }
  | { kind: 'not_found' }
  /** 400 — e.g. a non-`private` visibility while the service's flag is OFF. */
  | { kind: 'validation'; details: SelectionListErrorDetail[] | undefined }
  | {
      kind: 'fork_required'
      sourceListId: SelectionListId
      forkUrl: string | undefined
    }
  | { kind: 'conflict'; reason: string | undefined }
  | { kind: 'unknown_outcome'; status: number | undefined }

/** The part of `PATCH /v1/selection-lists/{listId}` that changes visibility. */
export type VisibilityUpdate = Required<Pick<SelectionListUpdate, 'visibility'>>

// ── Stored values across a fork (frame 10) ────────────────────────────────────

/** One stored item id, as `POST /v1/resolve` answered it. */
export type StoredValueOutcome =
  | {
      kind: 'resolved'
      id: SelectionListItemId
      label: string
      locale: Locale
      isMachine: boolean
      /** `archived` still resolves: read but not newly selectable. */
      status: ResolvedSelectionListItem['status']
      /**
       * The org-visible fork item standing in for this common item, when the
       * service redirected it (4.1.0); `null` otherwise. `label` and `status`
       * above are already the fork item's.
       */
      effectiveItemId: SelectionListItemId | null
    }
  /** Another org's item, or purged: keep the id in the form, render "Unknown value". */
  | { kind: 'missing'; id: SelectionListItemId }

/** A redirect the host may opt in to migrating (`onEffectiveValue(stored, effective)`). */
export interface EffectiveValueRedirect {
  stored: SelectionListItemId
  effective: SelectionListItemId
}
