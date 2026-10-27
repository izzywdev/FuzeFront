/**
 * ReadOnlyListNotice — why a list is read-only for the caller, and the way
 * forward (frames 02, 03, 11).
 *
 * Decided from the list and the Fork-CTA state, never from a guess at the
 * caller's role:
 *  - `platform`  a common list: shared by every organization; forking is how an
 *                organization gets its own editable copy. A failed effective-list
 *                lookup keeps this plain notice (no CTA) plus a quiet retry.
 *  - `shadowed`  a common list the organization already replaced: the way
 *                forward is "Open your version"; Fork is not offered.
 *  - `org`       the organization's own org-visible list, read-only for this
 *                member. No Fork (it would be `409 fork_not_applicable`) and no
 *                invented access-request action; the owner hint states only what
 *                `created_by` proves, decided offline from its form.
 *  - `private`   a private list the caller holds a read-only role on.
 *
 * While the effective-list answer is pending nothing renders: a notice that
 * flashes and then changes reads as a bug. `editable` absent (unknown) renders
 * nothing either.
 */

import type { MouseEvent } from 'react'
import { Button, StatusCallout } from '@fuzefront/design-system'
import {
  createdByKind,
  editableStateOf,
  isCommonList,
  visibilityOf,
  type ForkCtaState,
  type SharedList,
} from '../core'
import { NOTICE_COPY, OWNER_HINT } from './copy'

export type ReadOnlyNoticeKind = 'platform' | 'shadowed' | 'org' | 'private'

/** Which notice applies, or `null` when none should render (yet). */
export function readOnlyNoticeKind(
  list: SharedList,
  cta: ForkCtaState
): ReadOnlyNoticeKind | null {
  if (editableStateOf(list) !== 'read-only') return null
  if (isCommonList(list)) {
    if (cta.kind === 'pending') return null
    return cta.kind === 'shadowed' ? 'shadowed' : 'platform'
  }
  return visibilityOf(list) === 'org' ? 'org' : 'private'
}

export interface ReadOnlyListNoticeProps {
  list: SharedList
  cta: ForkCtaState
  /** Where "Open your version" links to. */
  hrefFor: (list: SharedList) => string
  onOpenOwnVersion: (list: SharedList) => void
  /** Re-run the failed effective-list lookup. */
  onRetryLookup: () => void
}

const block = { display: 'block' } as const
const gap = { display: 'block', marginBlockStart: 'var(--space-2)' } as const

export function ReadOnlyListNotice({
  list,
  cta,
  hrefFor,
  onOpenOwnVersion,
  onRetryLookup,
}: ReadOnlyListNoticeProps) {
  const kind = readOnlyNoticeKind(list, cta)
  if (kind === null) return null

  if (kind === 'shadowed' && cta.kind === 'shadowed') {
    const own = cta.ownVersion
    return (
      <StatusCallout
        tone="info"
        icon="⑂"
        title={NOTICE_COPY.shadowed.title}
        role="note"
        data-readonly-notice="shadowed"
        actions={
          <Button
            as="a"
            href={hrefFor(own)}
            variant="primary"
            size="sm"
            data-action="open-own-version"
            onClick={(event: MouseEvent) => {
              event.preventDefault()
              onOpenOwnVersion(own)
            }}
          >
            {NOTICE_COPY.shadowed.open}
          </Button>
        }
      >
        <span style={block}>
          This is the common <b>{list.name}</b> list. {NOTICE_COPY.shadowed.body}
        </span>
      </StatusCallout>
    )
  }

  if (kind === 'platform') {
    return (
      <StatusCallout
        tone="info"
        icon="◎"
        title={NOTICE_COPY.platform.title}
        role="note"
        data-readonly-notice="platform"
        actions={
          cta.kind === 'lookup-failed' ? (
            <span
              data-state="lookup-failed"
              style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}
            >
              {NOTICE_COPY.lookupFailed}{' '}
              <button
                type="button"
                data-action="retry"
                className="fz-sl-link"
                onClick={onRetryLookup}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                {NOTICE_COPY.lookupRetry}
              </button>
            </span>
          ) : undefined
        }
      >
        <span style={block}>{NOTICE_COPY.platform.lead}</span>
        <span style={gap}>{NOTICE_COPY.platform.fork}</span>
      </StatusCallout>
    )
  }

  if (kind === 'org') {
    const hintKind = createdByKind(list.created_by)
    return (
      <StatusCallout
        tone="info"
        icon="☰"
        title={NOTICE_COPY.org.title}
        role="note"
        data-readonly-notice="org"
      >
        <span style={block}>
          {NOTICE_COPY.org.body}
          {hintKind !== 'unknown' && (
            <>
              {' '}
              <span data-owner-hint="" data-created-by-kind={hintKind}>
                {OWNER_HINT[hintKind]}
              </span>
            </>
          )}
        </span>
      </StatusCallout>
    )
  }

  return (
    <StatusCallout
      tone="info"
      icon="○"
      title={NOTICE_COPY.private.title}
      role="note"
      data-readonly-notice="private"
    >
      <span style={block}>{NOTICE_COPY.private.body}</span>
    </StatusCallout>
  )
}
