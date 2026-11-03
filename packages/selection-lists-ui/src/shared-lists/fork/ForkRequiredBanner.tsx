/**
 * ForkRequiredBanner (frame 04) — a mutation on a common list was refused with
 * `409 CONFLICT reason=fork_required`. It turns the refusal into a way forward:
 * "Fork to edit…", bound to the list the SERVICE refused (`source_list_id`), not
 * to the id in the page URL.
 *
 * It never forks by itself — forking creates a list and costs quota, so it is
 * always an explicit choice in the dialog. `forkUrl` (same-origin relative,
 * already vetted by `core`) is exposed as `data-fork-url` only; the request is
 * always `forkList(sourceListId)` against the same-origin API base, so a
 * body-supplied URL can never steer it.
 *
 * Flag OFF: renders nothing, even if a stray `reason` arrives.
 */

import { Button, StatusCallout } from '@fuzefront/design-system'
import { useSharedLists, type SelectionListId } from '../core'
import { GENERIC_ORGANIZATION } from './copy'
import { ISOLATE, TOUCH_TARGET } from './ui'

export interface ForkRequiredBannerProps {
  /** `Error.source_list_id` — the common list to fork. */
  sourceListId: SelectionListId
  /** `Error.fork_url`, only when same-origin relative. */
  forkUrl?: string
  /** The refused list's name, for the sentence ("Priority"). */
  listName?: string
  /** Overrides the provider's organization name. */
  organizationName?: string
  onFork: (sourceListId: SelectionListId) => void
  /** Renders "Back to the list" when given. */
  onBack?: () => void
}

export function ForkRequiredBanner({
  sourceListId,
  forkUrl,
  listName,
  organizationName,
  onFork,
  onBack,
}: ForkRequiredBannerProps) {
  const shared = useSharedLists()
  if (!shared.enabled) return null
  const org = organizationName ?? shared.organizationName ?? GENERIC_ORGANIZATION
  return (
    <StatusCallout
      tone="info"
      role="alert"
      icon="⑂"
      title="Not saved — this is a common list"
      data-error="CONFLICT"
      data-reason="fork_required"
      actions={
        <>
          <Button
            size="sm"
            style={TOUCH_TARGET}
            data-action="fork-to-edit"
            data-fork-url={forkUrl}
            onClick={() => onFork(sourceListId)}
          >
            Fork to edit…
          </Button>
          {onBack && (
            <Button
              size="sm"
              variant="ghost"
              style={TOUCH_TARGET}
              data-action="back-to-list"
              onClick={onBack}
            >
              Back to the list
            </Button>
          )}
        </>
      }
    >
      {listName ? <bdi>“{listName}”</bdi> : 'This list'} is shared by every
      organization, so it can’t be changed here. Fork it to get{' '}
      <b>
        <span style={ISOLATE}>{org}</span>
        {org === GENERIC_ORGANIZATION ? '' : '’s'} own version
      </b>
      , then make this change there. Nothing has been saved.
    </StatusCallout>
  )
}
