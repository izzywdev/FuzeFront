/**
 * ForkResultNotice (frame 06) — what the user sees ON ARRIVAL at the fork's
 * detail after "Fork list" succeeded, plus the "Restore your version" action
 * for an existing fork that is archived.
 *
 *  - 201 created           -> success toast ("Forked."), or the draft variant
 *                             when the fork is private. role=status.
 *  - 200 existing, active  -> an INFO notice ("You're on your organization's
 *                             existing version"). Not an error: no red, no retry.
 *  - 200 existing, archived-> warning notice + "Restore your version"
 *                             (`PATCH {status:'active'}`), offered ONLY when the
 *                             fork is `editable`. While restoring the button
 *                             carries native `disabled`. A refusal is branched on
 *                             `code` (QUOTA_EXCEEDED by scope vs FORBIDDEN) and
 *                             the fork stays archived, so Restore stays offered.
 *
 * The provenance card lands in "comparison unavailable" on a new fork; this
 * notice never says "up to date" (a 201 carries only `forked_from.revision`).
 *
 * The notice kind travels in router location state (`notice.ts`). Flag OFF:
 * renders nothing.
 */

import { Button, StatusCallout, Toast } from '@fuzefront/design-system'
import { useEffect, useRef, useState } from 'react'
import {
  editableStateOf,
  useRestoreList,
  useSharedLists,
  visibilityOf,
  type RestoreOutcome,
  type SharedList,
} from '../core'
import { GENERIC_ORGANIZATION, restoreQuotaCopy, shortDate } from './copy'
import { useForkNotice, type ForkNotice } from './notice'
import { ISOLATE, TOUCH_TARGET } from './ui'

export interface ForkResultNoticeProps {
  /** The fork now on screen. */
  list: SharedList
  /** Overrides the notice carried by router location state (needs a Router when omitted). */
  notice?: ForkNotice | null
  /** Overrides the provider's organization name. */
  organizationName?: string
  /** The restore PATCH succeeded: the list as returned (patch the cache from it). */
  onRestored?: (list: SharedList) => void
  /** Dismissed. Defaults to clearing the router state. */
  onDismiss?: () => void
}

export function ForkResultNotice(props: ForkResultNoticeProps) {
  // An explicit `notice` needs no Router; only the route-backed form reads location state.
  return props.notice !== undefined ? (
    <ExplicitNotice {...props} notice={props.notice} />
  ) : (
    <RouteNotice {...props} />
  )
}

function RouteNotice(props: ForkResultNoticeProps) {
  const shared = useSharedLists()
  if (!shared.enabled) return null
  return <RouteBackedNotice {...props} />
}

function RouteBackedNotice(props: ForkResultNoticeProps) {
  const { notice, clear } = useForkNotice()
  return (
    <ExplicitNotice {...props} notice={notice} onDismiss={props.onDismiss ?? clear} />
  )
}

function ExplicitNotice({
  notice,
  ...props
}: ForkResultNoticeProps & { notice: ForkNotice | null }) {
  const shared = useSharedLists()
  if (!shared.enabled || !notice) return null
  return (
    <Notice
      {...props}
      kind={notice.kind}
      organization={
        props.organizationName ?? shared.organizationName ?? GENERIC_ORGANIZATION
      }
      onDismiss={props.onDismiss ?? (() => undefined)}
    />
  )
}

function Notice({
  list,
  kind,
  organization,
  onRestored,
  onDismiss,
}: ForkResultNoticeProps & {
  kind: ForkNotice['kind']
  organization: string
  onDismiss: () => void
}) {
  const [dismissed, setDismissed] = useState(false)
  const restore = useRestoreList()
  const [restoredKey, setRestoredKey] = useState<string | null>(null)
  // The restore write is never cancelled on unmount, but its continuation must
  // not touch the router (clearing the state would navigate back to this list).
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  if (dismissed || restoredKey === list.id) return null

  const org = <span style={ISOLATE}>{organization}</span>
  const name = <b>{list.name}</b>
  const dismiss = () => {
    setDismissed(true)
    onDismiss()
  }

  if (kind === 'created') {
    const draft = visibilityOf(list) === 'private'
    return (
      <Toast
        level="success"
        data-toast="forked"
        data-result={draft ? 'created-private' : 'created'}
        onDismiss={dismiss}
        title={draft ? 'Draft fork created.' : 'Forked.'}
        message={
          draft ? (
            <>
              Only people with a role see it — everyone else still uses the
              common list until you set it to <b>Organization</b>.
            </>
          ) : (
            <>
              {org} now uses its own {name} in every form. You’re its owner.
            </>
          )
        }
        style={{ maxWidth: 'none' }}
      />
    )
  }

  if (list.status !== 'archived') {
    const made = shortDate(list.forked_from?.forked_at ?? list.created_at)
    return (
      <StatusCallout
        tone="info"
        role="status"
        icon="⑂"
        title="You’re on your organization’s existing version"
        data-result="existing"
      >
        {org} already had a fork of {name}
        {made ? ` (made ${made})` : ''}. Nothing new was created and nothing was
        copied.
      </StatusCallout>
    )
  }

  const outcome: RestoreOutcome | undefined =
    restore.state.status === 'done' ? restore.state.outcome : undefined
  const restoring = restore.state.status === 'submitting'
  const canRestore = editableStateOf(list) === 'editable'

  const onRestore = async () => {
    const result = await restore.run(list.id)
    if (result.kind === 'restored' && mounted.current) {
      setRestoredKey(list.id)
      onRestored?.(result.list)
      onDismiss()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <StatusCallout
        tone="warning"
        role="status"
        icon="⑂"
        title="Your organization’s fork is archived"
        data-result="existing-archived"
        data-state={restoring ? 'restoring' : undefined}
        aria-busy={restoring ? true : undefined}
        actions={
          canRestore ? (
            <Button
              size="sm"
              style={TOUCH_TARGET}
              data-action="restore-fork"
              disabled={restoring}
              aria-busy={restoring ? true : undefined}
              onClick={onRestore}
            >
              {restoring ? 'Restoring…' : 'Restore your version'}
            </Button>
          ) : undefined
        }
      >
        Forms use the common list while it’s archived. Restore it to use your
        version again — its values and translations are as you left them.
      </StatusCallout>
      {outcome && outcome.kind !== 'restored' && (
        <RestoreRefusal outcome={outcome} organization={organization} />
      )}
    </div>
  )
}

function RestoreRefusal({
  outcome,
  organization,
}: {
  outcome: Exclude<RestoreOutcome, { kind: 'restored' }>
  organization: string
}) {
  if (outcome.kind === 'quota') {
    const copy = restoreQuotaCopy(outcome, organization)
    return (
      <StatusCallout
        tone="error"
        role="alert"
        icon="▣"
        title={copy.title}
        data-case="restore-quota"
        data-error="QUOTA_EXCEEDED"
        data-quota-scope={outcome.scope}
      >
        {copy.body}
      </StatusCallout>
    )
  }
  if (outcome.kind === 'forbidden') {
    return (
      <StatusCallout
        tone="error"
        role="alert"
        icon="⚠"
        title="You don’t have permission to restore this list"
        data-case="restore-forbidden"
        data-error="FORBIDDEN"
      >
        The fork stays archived.
      </StatusCallout>
    )
  }
  return (
    <StatusCallout
      tone="error"
      role="alert"
      icon="⚠"
      title="We couldn’t restore the list"
      data-case="restore-failed"
      data-error="restore-failed"
    >
      The fork stays archived. Try again in a moment.
    </StatusCallout>
  )
}
