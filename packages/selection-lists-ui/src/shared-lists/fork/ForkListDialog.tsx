/**
 * ForkListDialog (frames 05, 06, 12) — the confirmation for "Fork to edit…".
 *
 * One component, two presentations: the DS Modal at >= 40em and the DS
 * BottomSheet below it. Content, order, hooks and focus rules are identical;
 * only the container (and the condensed copy / stacked actions) changes.
 *
 * Rules the frames make contract:
 *  - Visibility is a RadioCardGroup of EXACTLY `org` (default) and `private` — a
 *    fork can never be `platform`, so no third option exists, not even disabled.
 *  - Confirm sends `POST …/{sourceId}/fork` with `{ visibility }` ONLY. Never an
 *    id, key or name: the service mints the id and the fork keeps the key.
 *  - While in flight the options are locked, the dialog is not dismissible (Esc,
 *    scrim, Cancel), and BOTH buttons carry the native `disabled` attribute, so a
 *    second activation cannot send a concurrent request (`useForkList` is also
 *    single-flight).
 *  - NO client-side size pre-check: an existing archived fork the page cannot see
 *    makes the same request answer 200, so Confirm stays enabled for any source.
 *    The 5,000-value cap renders only from the service's 400.
 *  - Success (201 / 200) hands the fork to `onForked` — the flow navigates.
 *    Every refusal renders INSIDE the open dialog in place of the options and
 *    nothing navigates; only a lost answer (network / 5xx) offers "Try again",
 *    which re-sends the same body (the service is idempotent per org + source).
 *  - Focus starts on the selected option, is trapped by the DS container, and
 *    returns to the element that opened the dialog when it closes.
 *  - The quota preview renders only when `GET /quota` succeeds.
 *
 * Mount it only inside flag-ON UI; with the flag OFF it renders nothing.
 */

import {
  BottomSheet,
  Badge,
  Button,
  Modal,
  ProgressMeter,
  RadioCardGroup,
  Spinner,
  StatusCallout,
} from '@fuzefront/design-system'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_FORK_VISIBILITY,
  useForkList,
  useSharedLists,
  type ForkOutcome,
  type ForkVisibility,
  type SharedList,
} from '../core'
import {
  FORK_VALUE_CAP_LABEL,
  GENERIC_ORGANIZATION,
  copiedValuesText,
  forkQuotaCopy,
  type ValueCounts,
} from './copy'
import { useIsWide } from './useIsWide'
import { useOrgListsQuota, type OrgListsQuota } from './useOrgListsQuota'
import { ISOLATE, LTR_ISLAND, TOUCH_TARGET } from './ui'

/** What the dialog needs to know about the list it forks. Only `id` is required. */
export type ForkSource = Pick<SharedList, 'id'> &
  Partial<Pick<SharedList, 'key' | 'name' | 'item_count'>>

export type ForkSuccess = Extract<ForkOutcome, { kind: 'created' | 'existing' }>

export interface ForkListDialogProps {
  source: ForkSource
  /** Overrides the provider's organization name. */
  organizationName?: string
  /** The source's loaded values (`status=all`), for "5 values (4 active, 1 archived)". */
  counts?: ValueCounts
  /** Languages besides the source locale, for the copied-translations sentence. */
  localeCount?: number
  /** 201 / 200: the fork to land on. The flow navigates; the dialog stays busy meanwhile. */
  onForked: (outcome: ForkSuccess) => void
  /** Dismissed (Esc / scrim / Cancel / Close). `outcome` is the refusal being closed, if any. */
  onClose: (outcome?: ForkOutcome) => void
}

type Refusal = Exclude<ForkOutcome, ForkSuccess>

const isSuccess = (o: ForkOutcome | undefined): o is ForkSuccess =>
  o !== undefined && (o.kind === 'created' || o.kind === 'existing')

export function ForkListDialog(props: ForkListDialogProps) {
  const shared = useSharedLists()
  if (!shared.enabled) return null
  return (
    <ForkDialogBody
      {...props}
      organization={
        props.organizationName ?? shared.organizationName ?? GENERIC_ORGANIZATION
      }
    />
  )
}

// ── Body ──────────────────────────────────────────────────────────────────────

function ForkDialogBody({
  source,
  organization,
  counts,
  localeCount,
  onForked,
  onClose,
}: ForkListDialogProps & { organization: string }) {
  const wide = useIsWide()
  const [visibility, setVisibility] = useState<ForkVisibility>(
    DEFAULT_FORK_VISIBILITY
  )
  const { state, run } = useForkList()
  const quota = useOrgListsQuota()
  const ids = useId()
  const subId = `${ids}-sub`
  const visLabelId = `${ids}-vis`

  // The element that opened the dialog, captured before the DS container moves focus.
  const opener = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement
  )
  const bodyRef = useRef<HTMLDivElement>(null)

  const outcome = state.status === 'done' ? state.outcome : undefined
  const refusal: Refusal | undefined = isSuccess(outcome) ? undefined : outcome
  // Success keeps the dialog busy until the flow navigates away.
  const busy = state.status === 'submitting' || isSuccess(outcome)
  const phase = busy ? 'submitting' : refusal ? 'refused' : 'idle'

  // Initial focus on the selected visibility option (the container focuses the dialog first).
  useEffect(() => {
    bodyRef.current
      ?.querySelector<HTMLElement>('[data-visibility-option][aria-checked="true"]')
      ?.focus()
  }, [])

  // The options unmount while busy: pull focus back inside the dialog so Tab stays trapped.
  useEffect(() => {
    if (!busy) return
    const dialog = bodyRef.current?.closest<HTMLElement>('[role="dialog"]')
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
  }, [busy])

  // Return focus to the opener when the dialog goes away.
  useEffect(
    () => () => {
      const el = opener.current
      if (el instanceof HTMLElement && el.isConnected) el.focus()
    },
    []
  )

  const confirm = async () => {
    if (busy) return
    const result = await run(source.id, visibility)
    if (isSuccess(result)) onForked(result)
  }
  const dismiss = () => {
    if (busy) return
    onClose(refusal)
  }

  const name = source.name
  const key = source.key
  const title: ReactNode = name ? (
    <>
      Fork <bdi>“{name}”</bdi> for <span style={ISOLATE}>{organization}</span>
    </>
  ) : (
    <>
      Fork this list for <span style={ISOLATE}>{organization}</span>
    </>
  )

  const content = refusal ? (
    <RefusalContent
      refusal={refusal}
      organization={organization}
      listKey={key}
      listName={name}
      onRetry={confirm}
      onClose={dismiss}
      wide={wide}
    />
  ) : (
    <IdleContent
      busy={busy}
      wide={wide}
      subId={subId}
      visLabelId={visLabelId}
      organization={organization}
      source={source}
      counts={counts}
      localeCount={localeCount}
      visibility={visibility}
      onVisibility={setVisibility}
      quota={quota}
      onCancel={dismiss}
      onConfirm={confirm}
    />
  )

  const containerProps = {
    open: true,
    onClose: dismiss,
    title: refusal ? undefined : title,
    'aria-label': refusal
      ? refusal.kind === 'unknown_outcome'
        ? 'Fork failed'
        : 'Fork refused'
      : undefined,
    'aria-describedby': phase === 'idle' ? subId : undefined,
    'aria-busy': busy ? true : undefined,
    'data-dialog': 'fork',
    'data-state': phase,
    'data-presentation': wide ? 'modal' : 'bottom-sheet',
    'data-result': refusal ? resultOf(refusal) : undefined,
  } as const

  return wide ? (
    <Modal {...containerProps} size="md">
      <div ref={bodyRef} style={bodyStyle}>
        {content}
      </div>
    </Modal>
  ) : (
    <BottomSheet {...containerProps}>
      <div ref={bodyRef} style={bodyStyle}>
        {content}
      </div>
    </BottomSheet>
  )
}

const bodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
} as const

/** `data-result` on the dialog, per frame 06. */
function resultOf(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'key_taken':
      return 'key-conflict'
    case 'too_large':
      return 'too-large'
    case 'not_found':
      return 'not-found'
    case 'unknown_outcome':
      return 'network'
    default:
      return refusal.kind
  }
}

// ── Idle / submitting ─────────────────────────────────────────────────────────

interface IdleContentProps {
  busy: boolean
  wide: boolean
  subId: string
  visLabelId: string
  organization: string
  source: ForkSource
  counts?: ValueCounts
  localeCount?: number
  visibility: ForkVisibility
  onVisibility: (v: ForkVisibility) => void
  quota: OrgListsQuota | null
  onCancel: () => void
  onConfirm: () => void
}

const factsStyle = {
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  columnGap: 'var(--space-4)',
  rowGap: 'var(--space-2)',
  margin: 0,
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
} as const
const dtStyle = {
  margin: 0,
  color: 'var(--text-tertiary)',
  fontWeight: 'var(--weight-medium)',
} as const
const ddStyle = { margin: 0, color: 'var(--text-primary)' } as const
const subStyle = {
  margin: 0,
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
} as const

function IdleContent(p: IdleContentProps) {
  const { source, organization, wide } = p
  const key = source.key
  const keyNode = key ? (
    <span style={LTR_ISLAND} dir="ltr" data-fork-key={key}>
      {key}
    </span>
  ) : null
  const copied = copiedValuesText(p.counts, source.item_count, !wide)
  const translations =
    p.localeCount !== undefined && p.localeCount > 0
      ? `every translation (${p.localeCount} ${p.localeCount === 1 ? 'language' : 'languages'} besides English)`
      : 'every translation'

  if (p.busy) {
    return (
      <>
        <p style={subStyle} role="status">
          {source.item_count !== undefined
            ? `Copying ${source.item_count} values and their translations… `
            : 'Copying the values and their translations… '}
          Options are locked; the dialog can’t be dismissed until the service
          answers.
        </p>
        <Footer
          wide={wide}
          cancel={
            <Button
              variant="ghost"
              style={TOUCH_TARGET}
              fullWidth={!wide}
              disabled
              data-action="cancel"
            >
              Cancel
            </Button>
          }
          primary={
            <Button
              style={TOUCH_TARGET}
              fullWidth={!wide}
              disabled
              aria-busy="true"
              data-action="confirm-fork"
              leadingIcon={
                <Spinner size={14} role="presentation" aria-hidden="true" />
              }
            >
              Forking…
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <p id={p.subId} style={subStyle}>
        Your organization gets its own copy that you can change. The common list{' '}
        {wide ? 'itself does not change.' : 'doesn’t change.'}
      </p>

      <dl style={factsStyle} data-fork-summary="">
        {wide && (
          <>
            <dt style={dtStyle}>Copy of</dt>
            <dd style={ddStyle}>
              <Badge tone="info" size="sm" data-badge="common">
                ◎ Common list
              </Badge>{' '}
              {source.name}
            </dd>
          </>
        )}
        <dt style={dtStyle}>Key</dt>
        <dd style={ddStyle}>
          {keyNode} — kept.
          {wide && ' A fork always has the same key, so forms don’t need to change.'}
        </dd>
        <dt style={dtStyle}>Copied</dt>
        <dd style={ddStyle} data-fork-copied="">
          {wide
            ? `${copied} with their codes and order, and ${translations}`
            : `${copied} and every translation`}
        </dd>
        {wide && (
          <>
            <dt style={dtStyle}>You become</dt>
            <dd style={ddStyle}>
              Owner of the fork — you can edit it and give others roles on it
            </dd>
            <dt style={dtStyle}>Then</dt>
            <dd style={ddStyle} data-fork-shadows="">
              Forms in <span style={ISOLATE}>{organization}</span>
              {key && (
                <>
                  {' '}
                  that use{' '}
                  <span style={LTR_ISLAND} dir="ltr">
                    {key}
                  </span>
                </>
              )}{' '}
              show your version instead of the common list. Values already saved
              in records keep showing correctly.
            </dd>
          </>
        )}
      </dl>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        <span
          id={p.visLabelId}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-primary)',
          }}
        >
          Who should use your version?
        </span>
        <RadioCardGroup
          data-control="fork-visibility"
          ariaLabelledBy={p.visLabelId}
          value={p.visibility}
          onChange={v => p.onVisibility(v as ForkVisibility)}
          options={[
            {
              value: 'org',
              'data-visibility-option': 'org',
              label: (
                <>
                  Everyone in <span style={ISOLATE}>{organization}</span>
                  {wide && (
                    <>
                      {' '}
                      <Badge tone="accent" size="sm">
                        ◉ Organization
                      </Badge>{' '}
                      <Badge tone="success" size="sm">
                        Recommended
                      </Badge>
                    </>
                  )}
                </>
              ),
              description: wide
                ? 'Every member sees and picks from your version. It replaces the common list in every form, for everyone.'
                : 'Replaces the common list in every form.',
            },
            {
              value: 'private',
              'data-visibility-option': 'private',
              label: (
                <>
                  Only people I give a role — a draft
                  {wide && (
                    <>
                      {' '}
                      <Badge tone="neutral" size="sm">
                        ○ Private
                      </Badge>
                    </>
                  )}
                </>
              ),
              description: wide
                ? 'Prepare changes first. Everyone else keeps using the common list, and saved values keep their common labels, until you switch it to Organization.'
                : 'Everyone else keeps the common list.',
            },
          ]}
        />
      </div>

      {!wide && (
        <p style={subStyle} data-note="owner">
          You become the owner — you can edit it and give others roles on it.
        </p>
      )}

      {wide ? (
        <StatusCallout
          tone="info"
          icon="ℹ"
          title="Your fork won’t follow the common list"
          data-note="no-sync"
        >
          Later changes to the common list are not copied into your fork, and
          there is no automatic merge. Your fork remembers which version it
          copied, so its page can tell you when the common list has changed
          since.
        </StatusCallout>
      ) : (
        <p style={subStyle} data-note="no-sync">
          Later changes to the common list won’t be copied into your fork.
        </p>
      )}

      {p.quota && <QuotaPreview quota={p.quota} />}

      <Footer
        wide={wide}
        cancel={
          <Button
            variant="ghost"
            style={TOUCH_TARGET}
            fullWidth={!wide}
            data-action="cancel"
            onClick={p.onCancel}
          >
            Cancel
          </Button>
        }
        primary={
          <Button
            style={TOUCH_TARGET}
            fullWidth={!wide}
            data-action="confirm-fork"
            onClick={p.onConfirm}
          >
            Fork list
          </Button>
        }
      />
    </>
  )
}

function QuotaPreview({ quota }: { quota: OrgListsQuota }) {
  const after = quota.current + 1
  return (
    <div data-quota-preview="org_lists">
      <ProgressMeter
        role="meter"
        label="Organization lists"
        valueLabel={`${quota.current} → ${after} of ${quota.limit}`}
        value={after}
        max={quota.limit}
        tone={after > quota.limit ? 'danger' : 'seam'}
      />
    </div>
  )
}

/** Cancel + primary: a row on the modal, a full-width stack (primary last) on the sheet. */
function Footer({
  wide,
  cancel,
  primary,
}: {
  wide: boolean
  cancel: ReactNode
  primary: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: wide ? 'row' : 'column',
        justifyContent: wide ? 'flex-end' : undefined,
        gap: 'var(--space-3)',
      }}
    >
      {cancel}
      {primary}
    </div>
  )
}

// ── Refusals (frame 06) ───────────────────────────────────────────────────────

interface RefusalContentProps {
  refusal: Refusal
  organization: string
  listKey?: string
  listName?: string
  wide: boolean
  onRetry: () => void
  onClose: () => void
}

function RefusalContent({
  refusal,
  organization,
  listKey,
  listName,
  wide,
  onRetry,
  onClose,
}: RefusalContentProps) {
  const org = <span style={ISOLATE}>{organization}</span>
  const name = listName ? <b>{listName}</b> : 'this list'
  const closeLabel =
    refusal.kind === 'key_taken' || refusal.kind === 'not_found'
      ? 'Back to lists'
      : 'Close'

  let alert: ReactNode
  switch (refusal.kind) {
    case 'fork_exists':
      alert = (
        <StatusCallout
          tone="warning"
          role="alert"
          icon="⑂"
          title="Your organization already has a fork you can’t see"
          data-error="CONFLICT"
          data-reason="fork_exists"
        >
          Someone in {org} forked {name} as a private draft. A second fork isn’t
          possible. Only that fork’s owner can give you a role on it or share it
          with the organization — ask whoever is preparing it.
        </StatusCallout>
      )
      break
    case 'fork_not_applicable':
      alert = (
        <StatusCallout
          tone="info"
          role="alert"
          icon="☰"
          title="This list already belongs to your organization"
          data-error="CONFLICT"
          data-reason="fork_not_applicable"
        >
          There’s nothing to fork — ask the list’s owner for an editor role
          instead.
        </StatusCallout>
      )
      break
    case 'key_taken':
      alert = (
        <StatusCallout
          tone="warning"
          role="alert"
          icon="⚠"
          title={
            <>
              Your organization already has a list with the key{' '}
              {listKey && (
                <span style={LTR_ISLAND} dir="ltr">
                  {listKey}
                </span>
              )}
            </>
          }
          data-error="CONFLICT"
          data-reason="none"
        >
          It isn’t a fork of this common list (for example, an older copy made
          before common lists existed), so a fork can’t take its key. Nothing
          was created.
        </StatusCallout>
      )
      break
    case 'quota': {
      const copy = forkQuotaCopy(refusal, organization)
      alert = (
        <StatusCallout
          tone="error"
          role="alert"
          icon="▣"
          title={copy.title}
          data-error="QUOTA_EXCEEDED"
          data-quota-scope={refusal.scope}
        >
          {copy.body}
        </StatusCallout>
      )
      break
    }
    case 'too_large':
      alert = (
        <StatusCallout
          tone="error"
          role="alert"
          icon="▣"
          title="This list is too large to fork"
          data-error="VALIDATION_ERROR"
          data-case="fork-size-cap"
        >
          Lists with more than {FORK_VALUE_CAP_LABEL} values (archived ones
          included) can’t be forked. You can still pick from it in every form.
        </StatusCallout>
      )
      break
    case 'forbidden':
      alert = (
        <StatusCallout
          tone="error"
          role="alert"
          icon="⚠"
          title={<>You can’t fork lists in {org}</>}
          data-error="FORBIDDEN"
          data-case="fork-no-create"
        >
          Forking creates a list, and your role can’t create lists. Ask an admin
          or editor to fork {name}.
        </StatusCallout>
      )
      break
    case 'not_found':
      alert = (
        <StatusCallout
          tone="error"
          role="alert"
          icon="∅"
          title="This list is no longer available"
          data-error="NOT_FOUND"
        >
          It may have been removed. Nothing was created.
        </StatusCallout>
      )
      break
    case 'unauthenticated':
      alert = (
        <StatusCallout
          tone="error"
          role="alert"
          icon="⚠"
          title="Your session has ended"
          data-error="UNAUTHENTICATED"
        >
          Sign in again, then fork the list. Nothing was created.
        </StatusCallout>
      )
      break
    case 'unknown_outcome':
      alert = (
        <StatusCallout
          tone="error"
          role="alert"
          icon="⚠"
          title="We couldn’t confirm the fork"
          data-error="network"
        >
          The connection failed before the service answered, so the fork may or
          may not exist. Trying again is safe — if it was created, you’ll be
          taken to it.
        </StatusCallout>
      )
      break
  }

  return (
    <>
      {alert}
      <Footer
        wide={wide}
        cancel={
          <Button
            variant="ghost"
            style={TOUCH_TARGET}
            fullWidth={!wide}
            data-action="close"
            onClick={onClose}
          >
            {closeLabel}
          </Button>
        }
        primary={
          refusal.kind === 'unknown_outcome' ? (
            <Button
              style={TOUCH_TARGET}
              fullWidth={!wide}
              data-action="retry"
              onClick={onRetry}
            >
              Try again
            </Button>
          ) : null
        }
      />
    </>
  )
}
