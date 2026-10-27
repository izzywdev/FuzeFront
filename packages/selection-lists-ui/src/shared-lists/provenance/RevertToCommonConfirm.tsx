/**
 * RevertToCommonConfirm - the confirmation behind the header action of frame 07
 * (inline) and frame 13 (bottom sheet). Reverting to the common list IS archiving
 * the fork, so all three cases confirm the same `POST .../archive`; only the
 * title, the promised consequence and the labels differ, and the consequence
 * never claims more than the provenance read established:
 *
 *  - `revert`          - the read RETURNED an active common list: forms go back to it.
 *  - `source-archived` - the read RETURNED the list with `status: archived`:
 *                        stated outright - there is no common list to go back to.
 *  - `source-gone`     - the read was a 404 (purged OR unreadable by this caller,
 *                        deliberately indistinguishable): the consequence is
 *                        CONDITIONAL and never claims every form becomes unavailable.
 *
 * The word "revert" appears only in the first case. Cancel is the safe action and
 * holds initial focus. Renders no network of its own: the caller owns the command.
 */

import type { CSSProperties } from 'react'
import { ConfirmSurface } from './ConfirmSurface'

export type ArchiveConfirmCase =
  'revert' | 'source-archived' | 'source-gone'

export interface RevertToCommonConfirmProps {
  confirmCase: ArchiveConfirmCase
  /** The fork's key, quoted in the consequence (an LTR island). */
  listKey: string
  /** The fork's name: the title of the archive cases and the fallback common-list name. */
  listName: string
  /** The common list's name, when the source was read. */
  commonListName?: string | null
  /** The caller's organization, when the host knows it. */
  organizationName?: string
  /** `POST .../archive` is in flight. */
  busy: boolean
  /** `bottom-sheet` at <= 40em (frame 13), `inline` otherwise (frame 07). */
  presentation: 'inline' | 'bottom-sheet'
  onCancel: () => void
  onConfirm: () => void
}

const keyStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-primary)',
  unicodeBidi: 'isolate',
}

function Key({ value }: { value: string }) {
  return (
    <bdi dir="ltr" style={keyStyle}>
      {value}
    </bdi>
  )
}

export function RevertToCommonConfirm({
  confirmCase,
  listKey,
  listName,
  commonListName,
  organizationName,
  busy,
  presentation,
  onCancel,
  onConfirm,
}: RevertToCommonConfirmProps) {
  if (confirmCase === 'revert') {
    return (
      <ConfirmSurface
        presentation={presentation}
        title={`Revert ${organizationName ?? 'this fork'} to the common ${commonListName ?? listName} list?`}
        cancelLabel="Cancel"
        confirmLabel="Archive and revert"
        confirmAction="confirm-revert"
        busy={busy}
        onCancel={onCancel}
        onConfirm={onConfirm}
        dataAttributes={{ 'data-confirm': 'revert-to-common' }}
      >
        <li>
          Your fork is <b>archived</b>, not deleted — you can restore it later
          with its values and translations intact.
        </li>
        <li>
          Forms go back to the common list. Values saved from your fork keep
          showing (archived values still resolve).
        </li>
        <li>
          Your edits stay in the archived fork; they are not applied to the
          common list.
        </li>
      </ConfirmSurface>
    )
  }

  const archivedSource = confirmCase === 'source-archived'
  const title = organizationName
    ? `Archive ${organizationName}'s ${listName} list?`
    : `Archive your ${listName} list?`

  return (
    <ConfirmSurface
      presentation={presentation}
      title={title}
      cancelLabel="Keep using this list"
      confirmLabel="Archive anyway"
      confirmAction="confirm-archive-fork"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
      dataAttributes={{
        'data-confirm': archivedSource
          ? 'archive-fork-no-common'
          : 'archive-fork-source-unknown',
        'data-case': 'revert-unavailable',
        'data-source-state': archivedSource ? 'archived' : 'gone',
      }}
    >
      {archivedSource ? (
        <li data-consequence="no-effective-list">
          <b>There is no common list to go back to.</b> Every form that uses{' '}
          <Key value={listKey} />
          {organizationName ? ` in ${organizationName}` : ''} will show “List
          unavailable” and offer no values until you restore this list.
        </li>
      ) : (
        <li data-consequence="conditional-no-effective-list">
          We couldn't read the common list this was copied from — it may have
          been removed, or it may no longer be shared with you.{' '}
          <b>
            If no active common {commonListName ?? listName} list is available
            to your organization
          </b>
          , every form that uses <Key value={listKey} /> will show “List
          unavailable” until you restore this list.
        </li>
      )}
      <li>Values already saved keep showing (archived values still resolve).</li>
      <li>
        Your fork is <b>archived</b>, not deleted — restore it later with its
        values and translations intact.
      </li>
    </ConfirmSurface>
  )
}
