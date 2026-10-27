/**
 * ForkProvenancePanel - frame 07 / 13 (flow `fork-provenance`) for an org's fork.
 *
 * Renders, for a fork of a common list:
 *  - the provenance CARD: the facts recorded at copy time (source link, forked
 *    on, copied version), the "behind source" line (`BehindSourceIndicator`) and
 *    a "View common list" link;
 *  - the HEADER ACTION, gated on what the source read established:
 *      source active              -> "Revert to common list..."
 *      source archived / gone     -> "Archive fork..." (the word revert never appears)
 *      checking / check failed    -> no action until the read answers;
 *  - the confirmation (`RevertToCommonConfirm`) and the refusal banner.
 *
 * Nothing here changes data because the common list moved: the comparison is
 * informational, with no merge or sync action. The only write is
 * `POST .../archive`, behind an explicit confirmation.
 *
 * Flag OFF, or a list that is not a fork: renders NOTHING and reads nothing.
 *
 * Mount it directly for a standalone card, or inside `ForkProvenanceBoundary`
 * (which shares ONE source read with the value editor's "Copied from" cells).
 */

import {
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, TextLink } from '@fuzefront/design-system'
import { useSharedLists, type SharedList } from '../core'
import type { ArchiveOutcome } from './api'
import { RevertToCommonConfirm } from './RevertToCommonConfirm'
import { BehindSourceIndicator } from './BehindSourceIndicator'
import { useForkProvenanceContext } from './ProvenanceContext'
import { useArchiveFork } from './useArchiveFork'
import { useCompactViewport } from './useCompactViewport'
import { useForkProvenance, type ForkProvenance } from './useForkProvenance'

/** The detail route of a list; the host's router decides where lists live. */
export const defaultSourceHref = (listId: string): string =>
  `/settings/selection-lists/${encodeURIComponent(listId)}`

export interface ForkProvenancePanelProps {
  /** The fork, as `GET /v1/selection-lists/{id}` returned it. */
  list: SharedList
  /** The caller's organization name, for the confirmation copy. Optional. */
  organizationName?: string
  /** Where the common list's detail lives. Default: `/settings/selection-lists/{id}`. */
  sourceHref?: (sourceListId: string) => string
  /** Offers "Change who can see it" (the Access tab) when given. */
  onChangeVisibility?: () => void
  /** The fork was archived (the entity the service returned, when it did). */
  onArchived?: (list: SharedList | null) => void
}

/** Date-only, in the page's language; an unparsable stamp is shown as sent. */
export function formatForkedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    dateStyle: 'medium',
  }).format(date)
}

// ── Styles (design-system tokens only; logical properties throughout) ─────────

const styles = {
  card: (compact: boolean): CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: compact ? 'auto minmax(0, 1fr)' : 'auto 1fr auto',
    gap: 'var(--space-3) var(--space-4)',
    alignItems: 'start',
    marginBlock: 'var(--space-4)',
    padding: 'var(--space-4)',
    background: 'var(--bg-secondary)',
    border: 'var(--border-width) solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    minInlineSize: 0,
  }),
  glyph: {
    fontSize: 'var(--text-xl)',
    lineHeight: 1,
    color: 'var(--accent-color)',
  } satisfies CSSProperties,
  title: {
    margin: 0,
    marginBlockEnd: 'var(--space-1)',
    color: 'var(--text-primary)',
    fontWeight: 'var(--weight-semibold)',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,
  facts: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: 'var(--space-1) var(--space-4)',
    margin: 0,
    marginBlockStart: 'var(--space-2)',
    fontSize: 'var(--text-sm)',
  } satisfies CSSProperties,
  factLabel: {
    color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-2xs)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-wide)',
  } satisfies CSSProperties,
  factValue: {
    margin: 0,
    color: 'var(--text-secondary)',
  } satisfies CSSProperties,
  isolate: { unicodeBidi: 'isolate' } satisfies CSSProperties,
  actions: (compact: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: compact ? 'column' : 'row',
    alignItems: compact ? 'stretch' : 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-3)',
    marginBlockEnd: 'var(--space-4)',
  }),
  hint: {
    margin: 0,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--text-sm)',
  } satisfies CSSProperties,
  banner: { marginBlockEnd: 'var(--space-4)' } satisfies CSSProperties,
}

/** A touch-sized control on a compact viewport (frame 13). */
const touch = (compact: boolean): CSSProperties | undefined =>
  compact ? { minBlockSize: 'var(--touch-target)' } : undefined

/** Plain left-click on a real link navigates in-app; modifier clicks keep the browser's behaviour. */
function useSpaClick(href: string) {
  const navigate = useNavigate()
  return (event: MouseEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    event.preventDefault()
    navigate(href)
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt style={styles.factLabel}>{label}</dt>
      <dd style={styles.factValue}>{children}</dd>
    </>
  )
}

/** The refusal copy of a failed archive (frame 07 "Refused - 403" and the unframed rest). */
function ArchiveFailure({ outcome }: { outcome: ArchiveOutcome }) {
  switch (outcome.kind) {
    case 'archived':
      return null
    case 'forbidden':
      return (
        <Alert
          tone="error"
          title="Only the list's owner can archive it"
          style={styles.banner}
          data-error="FORBIDDEN"
          data-case="revert-not-owner"
        >
          You can edit this fork's values, but archiving needs the owner role.
          Nothing changed.
        </Alert>
      )
    case 'unauthenticated':
      return (
        <Alert
          tone="error"
          title="You're signed out"
          style={styles.banner}
          data-error="UNAUTHENTICATED"
        >
          Sign in again to archive this list. Nothing changed.
        </Alert>
      )
    case 'not_found':
      return (
        <Alert
          tone="error"
          title="This list no longer exists"
          style={styles.banner}
          data-error="NOT_FOUND"
        >
          It may have been removed by someone else. Nothing changed.
        </Alert>
      )
    case 'conflict':
      return (
        <Alert
          tone="error"
          title="The list can't be archived right now"
          style={styles.banner}
          data-error="CONFLICT"
        >
          The service refused the request. Nothing changed.
        </Alert>
      )
    case 'unknown_outcome':
      return (
        <Alert
          tone="warning"
          title="We couldn't confirm the list was archived"
          style={styles.banner}
          data-error="UNKNOWN_OUTCOME"
        >
          Reload to see its current state, then try again if it is still
          active.
        </Alert>
      )
  }
}

interface PanelViewProps extends Omit<ForkProvenancePanelProps, 'list'> {
  provenance: ForkProvenance
}

function PanelView({
  provenance,
  organizationName,
  sourceHref = defaultSourceHref,
  onChangeVisibility,
  onArchived,
}: PanelViewProps) {
  const compact = useCompactViewport()
  const archive = useArchiveFork()
  const [confirming, setConfirming] = useState(false)
  const [archivedHere, setArchivedHere] = useState(false)

  const { fork, recorded, behind, gate, sourceName, sourceRevision } =
    provenance
  const href = sourceHref(recorded.list_id)
  const onLinkClick = useSpaClick(href)

  const busy = archive.state.status === 'submitting'
  const failure =
    archive.state.status === 'done' && archive.state.outcome.kind !== 'archived'
      ? archive.state.outcome
      : null
  const alreadyArchived = fork.status === 'archived' || archivedHere

  const forkedOn = formatForkedAt(recorded.forked_at)
  const commonName = sourceName ?? fork.name
  // The source link is offered once the read RETURNED a list (active or archived).
  const linkable =
    behind === 'behind' ||
    behind === 'up-to-date' ||
    behind === 'unknown' ||
    behind === 'source-archived'

  const confirm = async () => {
    const outcome = await archive.run(fork.id)
    setConfirming(false)
    if (outcome.kind === 'archived') {
      setArchivedHere(true)
      onArchived?.(outcome.list)
    }
  }

  const openConfirm = () => {
    archive.reset()
    setConfirming(true)
  }

  const showComparison =
    sourceRevision !== null && (behind === 'behind' || behind === 'up-to-date')

  let title: ReactNode
  if (behind === 'source-gone')
    title = 'Forked from a common list that is no longer available'
  else if (linkable)
    title = (
      <>
        Forked from the common list{' '}
        <TextLink href={href} data-action="view-source" onClick={onLinkClick}>
          {commonName}
        </TextLink>
      </>
    )
  else title = `Forked from the common list ${commonName}`

  return (
    <div data-fork-provenance="">
      <section
        data-panel="fork-provenance"
        data-behind-state={behind}
        aria-label="Fork provenance"
        aria-busy={behind === 'checking' ? true : undefined}
        style={styles.card(compact)}
      >
        <span aria-hidden="true" style={styles.glyph}>
          ⑂
        </span>
        <div style={{ minInlineSize: 0 }}>
          <p style={styles.title}>{title}</p>
          <dl style={styles.facts}>
            <Fact label="Forked">
              <bdi data-forked-at={recorded.forked_at} style={styles.isolate}>
                {forkedOn}
              </bdi>
            </Fact>
            <Fact label="Copied version">
              <bdi
                data-forked-revision={recorded.revision}
                style={styles.isolate}
              >
                {recorded.revision}
              </bdi>
            </Fact>
            {showComparison && (
              <Fact label="Common list now">
                <bdi
                  data-source-revision={sourceRevision}
                  style={styles.isolate}
                >
                  {sourceRevision}
                </bdi>
              </Fact>
            )}
          </dl>
          <div aria-live="polite">
            <BehindSourceIndicator
              state={behind}
              copiedRevision={recorded.revision}
              forkedOn={<bdi style={styles.isolate}>{forkedOn}</bdi>}
              onRetry={provenance.retry}
              compact={compact}
            />
          </div>
        </div>
        {linkable && (
          <Button
            variant="ghost"
            size="sm"
            href={href}
            data-action="view-source"
            fullWidth={compact}
            style={{
              ...touch(compact),
              ...(compact ? { gridColumn: '1 / -1' } : null),
            }}
            onClick={onLinkClick}
          >
            View common list
          </Button>
        )}
      </section>

      {failure && <ArchiveFailure outcome={failure} />}

      {archivedHere && (
        <Alert
          tone="success"
          role="status"
          style={styles.banner}
          data-state="archived"
        >
          Your fork is archived. You can restore it later with its values and
          translations intact.
        </Alert>
      )}

      {!alreadyArchived && (
        <div style={styles.actions(compact)}>
          {gate === 'source-active' && (
            <Button
              variant="ghost"
              type="button"
              fullWidth={compact}
              style={touch(compact)}
              data-action="revert-to-common"
              data-revert-gate="source-active"
              onClick={openConfirm}
            >
              Revert to common list…
            </Button>
          )}
          {gate === 'source-unavailable' && (
            <Button
              variant="ghost"
              type="button"
              fullWidth={compact}
              style={touch(compact)}
              data-action="archive-fork"
              data-revert-gate="source-unavailable"
              onClick={openConfirm}
            >
              Archive fork…
            </Button>
          )}
          {gate === 'source-unknown' && (
            <p data-revert-gate="source-unknown" style={styles.hint}>
              Archiving is offered once the common list has been checked.
            </p>
          )}
          {onChangeVisibility && (
            <Button
              variant="ghost"
              type="button"
              fullWidth={compact}
              style={touch(compact)}
              data-action="change-visibility"
              onClick={onChangeVisibility}
            >
              Change who can see it
            </Button>
          )}
        </div>
      )}

      {confirming && !alreadyArchived && gate !== 'source-unknown' && (
        <RevertToCommonConfirm
          confirmCase={
            gate === 'source-active'
              ? 'revert'
              : behind === 'source-archived'
                ? 'source-archived'
                : 'source-gone'
          }
          listKey={fork.key}
          listName={fork.name}
          commonListName={sourceName}
          organizationName={organizationName}
          busy={busy}
          presentation={compact ? 'bottom-sheet' : 'inline'}
          onCancel={() => setConfirming(false)}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}

/** Reads the source itself - used when no boundary shares one. */
function StandalonePanel({ list, ...rest }: ForkProvenancePanelProps) {
  const provenance = useForkProvenance(list, true)
  return provenance ? <PanelView provenance={provenance} {...rest} /> : null
}

export function ForkProvenancePanel(props: ForkProvenancePanelProps) {
  const { enabled } = useSharedLists()
  const shared = useForkProvenanceContext()
  if (!enabled) return null
  if (shared) {
    // Inside a boundary the page's ONE source read is reused; `list` is the
    // boundary's own fork and is not read again.
    const { list: _list, ...rest } = props
    return <PanelView provenance={shared.provenance} {...rest} />
  }
  return <StandalonePanel {...props} />
}
