/**
 * Refusals of a per-list MUTATION and of the fork itself that are not the
 * `fork_required` banner (frame 04's side-by-side, frame 06's `forbidden`):
 *
 *  - ForkForbiddenNotice  403 FORBIDDEN where the caller cannot create lists:
 *    "you can't fork lists". No Fork CTA, ever — a viewer cannot fork.
 *  - CommonNoCreateNotice 403 FORBIDDEN on a mutation of a COMMON list: the list
 *    is shared and the caller's role cannot create a fork of it either.
 *  - CommonAccessNotice   403 on access management of a common list: managed by
 *    the platform, not forkable, so the 409 path never applies.
 *  - ListNotFoundNotice   404 NOT_FOUND: "List not found" (same words as a list
 *    that never existed — another customer's list is indistinguishable).
 *
 * Each branches on `code` only, carries the frame's `data-*` hooks, and is
 * `role=alert`. Flag OFF: every one renders nothing — the 4.0.0 message stays.
 */

import { StatusCallout } from '@fuzefront/design-system'
import { useSharedLists } from '../core'
import { GENERIC_ORGANIZATION } from './copy'
import { ISOLATE } from './ui'

interface NoticeBase {
  organizationName?: string
  listName?: string
}

function useOrg(override: string | undefined) {
  const shared = useSharedLists()
  return {
    enabled: shared.enabled,
    org: override ?? shared.organizationName ?? GENERIC_ORGANIZATION,
  }
}

/** 403 on `POST …/fork` (also the detail's replacement for the Fork CTA). */
export function ForkForbiddenNotice({ organizationName, listName }: NoticeBase) {
  const { enabled, org } = useOrg(organizationName)
  if (!enabled) return null
  return (
    <StatusCallout
      tone="error"
      role="alert"
      icon="⚠"
      title={
        <>
          You can’t fork lists in <span style={ISOLATE}>{org}</span>
        </>
      }
      data-error="FORBIDDEN"
      data-case="fork-no-create"
    >
      Forking creates a list, and your role can’t create lists. Ask an admin or
      editor to fork {listName ? <b>{listName}</b> : 'this list'}.
    </StatusCallout>
  )
}

/** 403 on a mutation of a common list. */
export function CommonNoCreateNotice({ organizationName, listName }: NoticeBase) {
  const { enabled, org } = useOrg(organizationName)
  if (!enabled) return null
  return (
    <StatusCallout
      tone="error"
      role="alert"
      icon="⚠"
      title="Not saved — you can’t change this list"
      data-error="FORBIDDEN"
      data-case="common-no-create"
    >
      {listName ? <bdi>“{listName}”</bdi> : 'This list'} is a common list, and
      your role in <span style={ISOLATE}>{org}</span> can’t create lists, so it
      can’t be forked by you either. Ask someone who can create lists here (an
      admin or editor) to fork it.
    </StatusCallout>
  )
}

/** 403 on access management of a common list. */
export function CommonAccessNotice() {
  const { enabled } = useOrg(undefined)
  if (!enabled) return null
  return (
    <StatusCallout
      tone="error"
      role="alert"
      icon="⚠"
      title="Access to common lists is managed by the platform"
      data-error="FORBIDDEN"
      data-case="common-access"
    >
      Roles on a common list can’t be changed from an organization. To work on
      your own version, fork the list from its detail page.
    </StatusCallout>
  )
}

/** 404 on a mutation. */
export function ListNotFoundNotice() {
  const { enabled } = useOrg(undefined)
  if (!enabled) return null
  return (
    <StatusCallout
      tone="error"
      role="alert"
      icon="∅"
      title="List not found"
      data-error="NOT_FOUND"
    >
      It may belong to another organization, or it was removed.
    </StatusCallout>
  )
}
