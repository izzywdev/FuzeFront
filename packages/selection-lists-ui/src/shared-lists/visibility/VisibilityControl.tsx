/**
 * VisibilityControl — who can see a list (frames 08, 14). Mounted at the TOP of
 * the Access tab; renders nothing while the shared-lists flag is OFF.
 *
 * Editable only when `GET …/access` succeeded: that endpoint needs
 * `manage_access`, the same action `PATCH {visibility}` needs, so "can change
 * visibility" is OBSERVED from the roster call, never guessed from a role name.
 * The Access tab owns that call and hands us its outcome (`access`), so the
 * roster and this control never race two requests for the same answer.
 *
 * States: loading (skeleton, no guessed editability) · error (Retry) · ready
 * (radio cards) · saving · read-only (a STATEMENT, not a disabled form) ·
 * locked (a common list; no radio group at all). Refusals and the saved toast
 * sit above the panel so they survive the list being reloaded under them.
 *
 * Real authorization stays in Permit / the service: this component only decides
 * what to SHOW. The platform ("Every organization") option is offered to a
 * platform operator on a list the platform org owns; whether they may publish
 * is the service's answer (403 → "You can't publish common lists").
 */

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import {
  Alert,
  Badge,
  Button,
  RadioCardGroup,
  Skeleton,
  Spinner,
  Toast,
} from '@fuzefront/design-system'
import {
  canOfferPlatformPublish,
  sameOrganization,
  isFork,
  useChangeVisibility,
  useSharedList,
  useSharedLists,
  visibilityOf,
  type SelectionListId,
  type SelectionListVisibility,
  type SharedList,
  type VisibilityOutcome,
} from '../core'
import { MakePrivateConfirm } from './MakePrivateConfirm'
import { PublishPlatformConfirm } from './PublishPlatformConfirm'
import { FALLBACK_ORG_NAME, MSG } from './messages'
import { useCompactViewport } from './useCompactViewport'

/** What the Access tab learned from `GET …/access` (the `manage_access` probe). */
export type AccessObservation = 'loading' | 'granted' | 'forbidden' | 'error'

export interface VisibilityControlProps {
  listId: SelectionListId
  /** The roster call's outcome: `granted` ⇒ the caller can manage access. */
  access: AccessObservation
  /** Re-run the roster call (Retry after `access: 'error'`). */
  onRetryAccess: () => void
  /** Display name of the active organization (the shell knows it; the package does not). */
  organizationName?: string
  /**
   * The active organization's id. When given, the platform option additionally
   * requires `list.organization_id` to equal it ("owned by the platform org").
   */
  activeOrganizationId?: string
  /** Called with the list the service returned after a successful change. */
  onChanged?: (list: SharedList) => void
}

type ConfirmKind = 'to-private' | 'publish'

type ErrorKind =
  | 'owner'
  | 'publish'
  | 'locked'
  | 'session'
  | 'gone'
  | 'refused'
  | 'fork'
  | 'conflict'
  | 'unknown'

type Notice =
  | { kind: 'saved'; to: SelectionListVisibility; name: string }
  | { kind: 'error'; error: ErrorKind }

const ERRORS: Record<
  ErrorKind,
  { title: string; body: string; attrs: Record<string, string> }
> = {
  owner: {
    title: MSG.errorOwnerTitle,
    body: MSG.errorOwnerBody,
    attrs: { 'data-error': 'FORBIDDEN', 'data-case': 'visibility-not-owner' },
  },
  publish: {
    title: MSG.errorPublishTitle,
    body: MSG.errorPublishBody,
    attrs: { 'data-error': 'FORBIDDEN', 'data-case': 'publish-forbidden' },
  },
  locked: {
    title: MSG.errorLockedTitle,
    body: MSG.errorLockedBody,
    attrs: { 'data-error': 'CONFLICT', 'data-reason': 'visibility_locked' },
  },
  session: {
    title: MSG.errorSessionTitle,
    body: MSG.errorSessionBody,
    attrs: { 'data-error': 'UNAUTHENTICATED' },
  },
  gone: {
    title: MSG.errorGoneTitle,
    body: MSG.errorGoneBody,
    attrs: { 'data-error': 'NOT_FOUND' },
  },
  refused: {
    title: MSG.errorRefusedTitle,
    body: MSG.errorRefusedBody,
    attrs: { 'data-error': 'VALIDATION_ERROR' },
  },
  fork: {
    title: MSG.errorForkTitle,
    body: MSG.errorForkBody,
    attrs: { 'data-error': 'CONFLICT', 'data-reason': 'fork_required' },
  },
  conflict: {
    title: MSG.errorConflictTitle,
    body: MSG.errorConflictBody,
    attrs: { 'data-error': 'CONFLICT' },
  },
  unknown: {
    title: MSG.errorUnknownTitle,
    body: MSG.errorUnknownBody,
    attrs: { 'data-error': 'UNKNOWN' },
  },
}

/** Refusal kinds that mean "the list may have changed under us": reload it. */
const RELOAD_ON: readonly ErrorKind[] = ['locked', 'conflict', 'unknown']

function errorKindOf(
  outcome: Exclude<VisibilityOutcome, { kind: 'changed' }>,
  requested: SelectionListVisibility
): ErrorKind {
  switch (outcome.kind) {
    case 'locked':
      return 'locked'
    case 'forbidden':
      return requested === 'platform' ? 'publish' : 'owner'
    case 'unauthenticated':
      return 'session'
    case 'not_found':
      return 'gone'
    case 'validation':
      return 'refused'
    case 'fork_required':
      return 'fork'
    case 'conflict':
      return 'conflict'
    case 'unknown_outcome':
      return 'unknown'
  }
}

// ── Presentation ──────────────────────────────────────────────────────────────

const card: CSSProperties = {
  marginBlockEnd: 'var(--space-6)',
  padding: 'var(--space-5)',
  background: 'var(--bg-tertiary)',
  border: 'var(--border-width) solid var(--border-color)',
  borderRadius: 'var(--radius-lg)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
}

const seam: CSSProperties = {
  blockSize: 'var(--border-width-strong)',
  marginBlockEnd: 'var(--space-4)',
  background: 'var(--seam)',
}

const label: CSSProperties = {
  display: 'block',
  marginBlockEnd: 'var(--space-1)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)',
  color: 'var(--text-secondary)',
}

const hint: CSSProperties = {
  margin: 0,
  marginBlockEnd: 'var(--space-3)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-tertiary)',
}

const statement: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--space-2)',
  color: 'var(--text-secondary)',
}

const stack: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
}

const notices: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  marginBlockEnd: 'var(--space-4)',
}

const toastFill: CSSProperties = { maxInlineSize: '100%' }

const GLYPH: Record<SelectionListVisibility, string> = {
  private: '○',
  org: '◉',
  platform: '◎',
}

function VisibilityBadge({ visibility }: { visibility: SelectionListVisibility }) {
  const tone =
    visibility === 'private' ? 'neutral' : visibility === 'org' ? 'accent' : 'info'
  const text =
    visibility === 'private'
      ? MSG.privateBadge
      : visibility === 'org'
        ? MSG.orgBadge
        : MSG.platformBadge
  return (
    <Badge tone={tone} size="sm">
      <span aria-hidden="true">{GLYPH[visibility]}</span> {text}
    </Badge>
  )
}

function Shell({
  state,
  busy,
  scope,
  visibility,
  ariaLabel,
  children,
}: {
  state: string
  busy?: boolean
  scope?: string
  visibility?: SelectionListVisibility
  ariaLabel?: string
  children: React.ReactNode
}) {
  return (
    <section
      data-panel="visibility-control"
      data-state={state}
      data-scope={scope}
      data-visibility={visibility}
      aria-busy={busy ? 'true' : undefined}
      aria-label={ariaLabel}
      style={card}
    >
      <div aria-hidden="true" style={seam} />
      {children}
    </section>
  )
}

function savedBody(
  to: SelectionListVisibility,
  name: string,
  orgName: string
): React.ReactNode {
  if (to === 'private')
    return (
      <>
        <b>
          <bdi>{name}</bdi> is now private.
        </b>{' '}
        Only people with a role see it.
      </>
    )
  if (to === 'org')
    return (
      <b>
        Everyone in <bdi>{orgName}</bdi> can now see <bdi>{name}</bdi>.
      </b>
    )
  return (
    <>
      <b>
        <bdi>{name}</bdi> is now a common list.
      </b>{' '}
      Every organization can read it.
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Keyed by list: a confirmation, an in-flight save and a notice belong to ONE
 * list, so navigating to another list's Access tab (same mounted tree) starts
 * from a clean control instead of re-binding a pending confirm to the new list.
 */
export function VisibilityControl(props: VisibilityControlProps) {
  return <VisibilityControlForList key={props.listId} {...props} />
}

function VisibilityControlForList({
  listId,
  access,
  onRetryAccess,
  organizationName,
  activeOrganizationId,
  onChanged,
}: VisibilityControlProps) {
  const { enabled, isPlatformOrg } = useSharedLists()
  const compact = useCompactViewport()
  const labelId = useId()
  const listState = useSharedList(enabled ? listId : null)
  const change = useChangeVisibility()
  const orgName = organizationName?.trim() || FALLBACK_ORG_NAME

  const [confirm, setConfirm] = useState<ConfirmKind | null>(null)
  const [busy, setBusy] = useState<'direct' | 'publish' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Focus goes back to the checked option once a confirmation closes or a save
  // finishes — the sheet / panel that held it is gone.
  const groupRef = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(false)
  useEffect(() => {
    if (!wantFocus.current) return
    wantFocus.current = false
    groupRef.current
      ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      ?.focus()
  })

  if (!enabled) return null

  const presentation = compact ? 'bottom-sheet' : 'inline'

  const dismiss = () => {
    wantFocus.current = true
    setConfirm(null)
  }

  const apply = async (list: SharedList, requested: SelectionListVisibility) => {
    setNotice(null)
    setBusy(requested === 'platform' ? 'publish' : 'direct')
    let outcome: VisibilityOutcome
    try {
      outcome = await change.run(list.id, requested)
    } catch {
      outcome = { kind: 'unknown_outcome', status: undefined }
    }
    wantFocus.current = true
    setBusy(null)
    setConfirm(null)
    if (outcome.kind === 'changed') {
      // The returned entity is the new truth: patch the cache, no re-read.
      const next: SharedList = {
        ...outcome.list,
        visibility: outcome.list.visibility ?? requested,
      }
      listState.setList(next)
      onChanged?.(next)
      setNotice({ kind: 'saved', to: requested, name: next.name })
      return
    }
    const error = errorKindOf(outcome, requested)
    setNotice({ kind: 'error', error })
    if (RELOAD_ON.includes(error)) listState.reload()
  }

  const choose = (list: SharedList, value: SelectionListVisibility) => {
    if (busy) return
    setNotice(null)
    if (value === 'org') void apply(list, 'org') // widening: no confirm
    else if (value === 'private') setConfirm('to-private')
    else setConfirm('publish')
  }

  // ── Notices (above the panel, so they outlive a reload) ─────────────────────
  const noticeNode = notice && (
    <div style={notices}>
      {notice.kind === 'saved' ? (
        <Toast
          level="success"
          data-result="visibility-saved"
          style={toastFill}
          message={savedBody(notice.to, notice.name, orgName)}
          onDismiss={() => setNotice(null)}
        />
      ) : (
        <Alert
          tone="error"
          title={ERRORS[notice.error].title}
          {...ERRORS[notice.error].attrs}
        >
          {ERRORS[notice.error].body}
        </Alert>
      )}
    </div>
  )

  const wrap = (panel: React.ReactNode) => (
    <div data-visibility-control="">
      {noticeNode}
      {panel}
    </div>
  )

  // ── Loading / error ─────────────────────────────────────────────────────────
  const loading = (
    <Shell state="loading" busy ariaLabel={MSG.loading}>
      <div style={stack}>
        <Skeleton width="40%" />
        <Skeleton width="90%" />
        <Skeleton width="90%" />
      </div>
    </Shell>
  )

  if (listState.phase === 'loading') return wrap(loading)

  // 404 (another org's list, or none) and every other failure read the same:
  // nothing was changed, and Retry re-reads the list.
  if (listState.phase !== 'ready') {
    return wrap(errorPanel(() => listState.reload()))
  }

  const list = listState.list
  const current = visibilityOf(list)

  // A common list can never be demoted: a statement, no radio group at all.
  if (current === 'platform') {
    return wrap(
      <Shell state="locked" visibility="platform">
        <span style={label}>{MSG.label}</span>
        <p style={{ ...statement, marginBlockEnd: 'var(--space-3)' }}>
          <VisibilityBadge visibility="platform" />
          <Badge tone="neutral" size="sm">
            {MSG.lockedBadge}
          </Badge>
        </p>
        <p style={{ ...statement, margin: 0 }}>{MSG.lockedBody}</p>
      </Shell>
    )
  }

  if (access === 'loading') return wrap(loading)
  if (access === 'error') return wrap(errorPanel(onRetryAccess))

  // Not an owner: say what it is and who can change it.
  if (access === 'forbidden') {
    return wrap(
      <Shell state="read-only" visibility={current}>
        <span style={label}>{MSG.label}</span>
        <p style={statement}>
          <VisibilityBadge visibility={current} />
          <span>
            —{' '}
            {current === 'org' ? (
              <>
                everyone in <bdi>{orgName}</bdi>.
              </>
            ) : (
              MSG.readOnlyPrivate
            )}{' '}
            {MSG.readOnlyOnlyOwner}
          </span>
        </p>
      </Shell>
    )
  }

  if (busy === 'direct') {
    return wrap(
      <Shell state="saving" busy>
        <div style={statement}>
          <Spinner size={16} label="Saving" />
          <span>{MSG.saving}</span>
        </div>
      </Shell>
    )
  }

  // ── Ready ───────────────────────────────────────────────────────────────────
  const fork = isFork(list)
  const showPlatform =
    canOfferPlatformPublish({ sharedLists: enabled, isPlatformOrg, list }) &&
    (activeOrganizationId === undefined ||
      sameOrganization(list.organization_id, activeOrganizationId))

  const options = [
    {
      value: 'private',
      label: (
        <>
          <span>{MSG.privateTitle}</span> <VisibilityBadge visibility="private" />
          {current === 'private' && <CurrentPill />}
        </>
      ),
      description: fork ? MSG.privateDescForkLine : MSG.privateDesc,
      'data-visibility-option': 'private',
    },
    {
      value: 'org',
      label: (
        <>
          <span>
            Everyone in <bdi>{orgName}</bdi>
          </span>{' '}
          <VisibilityBadge visibility="org" />
          {current === 'org' && <CurrentPill />}
        </>
      ),
      description: fork ? MSG.orgDesc + MSG.orgDescFork : MSG.orgDesc,
      'data-visibility-option': 'org',
    },
    ...(showPlatform
      ? [
          {
            value: 'platform',
            label: (
              <>
                <span>{MSG.platformTitle}</span>{' '}
                <VisibilityBadge visibility="platform" />
              </>
            ),
            description:
              MSG.platformDesc +
              (confirm === 'publish' ? MSG.platformDescPending : ''),
            pending: confirm === 'publish',
            'data-visibility-option': 'platform',
          },
        ]
      : []),
  ]

  return wrap(
    <Shell
      state="ready"
      scope={isPlatformOrg ? 'platform-org' : undefined}
      visibility={current}
    >
      <span id={labelId} style={label}>
        {MSG.label}
      </span>
      <p style={hint}>{MSG.hint}</p>
      <RadioCardGroup
        ref={groupRef}
        ariaLabelledBy={labelId}
        data-control="visibility"
        options={options}
        value={current}
        disabled={busy !== null}
        onChange={value => choose(list, value as SelectionListVisibility)}
      />
      {confirm === 'to-private' && (
        <MakePrivateConfirm
          list={list}
          presentation={presentation}
          organizationName={orgName}
          onCancel={dismiss}
          onConfirm={() => {
            setConfirm(null)
            void apply(list, 'private')
          }}
        />
      )}
      {confirm === 'publish' && (
        <PublishPlatformConfirm
          list={list}
          presentation={presentation}
          publishing={busy === 'publish'}
          onCancel={dismiss}
          onConfirm={() => void apply(list, 'platform')}
        />
      )}
    </Shell>
  )
}

function CurrentPill() {
  return (
    <Badge tone="neutral" size="sm">
      {MSG.current}
    </Badge>
  )
}

function errorPanel(onRetry: () => void) {
  return (
    <Shell state="error">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>{MSG.loadError}</span>
        <Button
          variant="ghost"
          type="button"
          data-action="retry"
          style={{ minBlockSize: 'var(--touch-target)' }}
          onClick={onRetry}
        >
          {MSG.retry}
        </Button>
      </div>
    </Shell>
  )
}
