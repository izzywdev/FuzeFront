import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Braces,
  Building2,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  Eye,
  ExternalLink,
  Layers3,
  LockKeyhole,
  LogOut,
  Network,
  Plus,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import type {
  ApiOperation,
  AdminTenantContext,
  CoverageState,
  Flow,
  FrontendSurface,
  Portfolio,
  OrganizationQualitySummary,
  QualityArtifact,
  PolicyGateEvaluation,
  PolicyGateReviewHistoryEntry,
  RepositoryFlowCandidate,
  RepositoryFlowReviewHistoryEntry,
  Repository,
  RepositoryScanHistoryPage,
  StorybookStory,
  TestExpectation,
  TestExecution,
  TestImplementationRequest,
} from '@fuzequality/contracts'
import type { ExecutionOutcomeTrend, PolicyGatePerformance } from '@fuzequality/core'
import {
  api,
  CatalogApiError,
  configurePlatformSecurity,
  type OrganizationMember,
  type OrganizationRole,
} from './api'
import { planGap } from './testPlan'
import { storybookPreviewUrl } from './storybook'
import { QualityAction, QualityIconAction } from './components/primitives'
import {
  ExecutionEvidenceMetadata,
  ExecutionEvidenceLinks,
  ExecutionEvidenceCoverage,
  ExecutionLinkageEvidence,
  ExecutionGateEvidence,
  ExecutionThresholdEvidence,
  ExecutionSourceLink,
  durationMsLabel,
  latestIntegrationExecution,
  latestPerformanceExecution,
  latestPostProductionExecution,
} from './components/executionEvidence'
import { PolicyGateEvidence } from './components/governanceEvidence'
import { FlowInventoryFilters, type FlowRevisionScope } from './components/flowInventoryFilters'
import { FlowInspector } from './components/flowInspector'
import { RepositoryAnalysisStatus } from './components/repositoryAnalysisStatus'
import { MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS, historicalFlowEvidenceSelection } from './flowEvidence'
import { governanceEvidenceSelection } from './governanceEvidence'
import { applyRepositoryProcessingStatus, repositoryNeedsProcessingPoll } from './repositoryProcessing'

export type View =
  | 'overview'
  | 'repositories'
  | 'api'
  | 'frontend'
  | 'requirements'
  | 'intelligence'
  | 'review'
  | 'operations'
  | 'organization'
  | 'administration'

function analyzedSourceRevision(repository: Repository): string | undefined {
  const details = repository.lastScanDetails
  if (!repository.lastScanRevision || details?.catalogRevision !== repository.lastScanRevision) return undefined
  const revision = details.sourceRevision
  return revision && /^[0-9a-f]{40}$/i.test(revision) ? revision : undefined
}

const navigation: Array<{ id: View; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Portfolio', icon: Activity },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'api', label: 'API catalog', icon: Braces },
  { id: 'frontend', label: 'Frontend inventory', icon: Layers3 },
  { id: 'requirements', label: 'Requirements & flows', icon: Network },
  { id: 'intelligence', label: 'Quality intelligence', icon: ShieldCheck },
  { id: 'review', label: 'AI review queue', icon: Sparkles },
  { id: 'operations', label: 'Operations', icon: Activity },
  { id: 'organization', label: 'Organization', icon: Users },
  { id: 'administration', label: 'Organizations', icon: Building2 },
]

export const portalMenuItems = navigation
  .filter(item => item.id !== 'administration')
  .map((item, index) => ({
    id: item.id,
    label: item.label,
    icon: item.id === 'review' ? '✨' : item.id === 'requirements' ? '🗺️' : '◦',
    route: `/${item.id}`,
    order: index + 1,
  }))

type PortalContextSnapshot = {
  user: { id: string } | null
  tenantId?: string | null
  activeOrganization?: { id: string } | null
}

export type FuzeFrontRuntimeBridge = {
  getContext?: () => PortalContextSnapshot
  subscribe?: (listener: (context: PortalContextSnapshot) => void) => () => void
  onOrgSwitch?: (listener: (organization: { id: string } | null) => void) => () => void
  onAccountSwitch?: (listener: (user: { id: string } | null) => void) => () => void
  menu?: {
    add: (appId: string, items: typeof portalMenuItems) => void
    remove: (appId: string) => void
  }
  navigate?: (path: string) => void
}

function runtimeBridge() {
  return (window as Window & { __FUZEFRONT__?: FuzeFrontRuntimeBridge })
    .__FUZEFRONT__
}

export function portalContextKey(context?: PortalContextSnapshot) {
  const tenant = context?.tenantId ?? context?.activeOrganization?.id ?? 'unresolved'
  return `${context?.user?.id ?? 'anonymous'}:${tenant}`
}

/** Refetch tenant-scoped data whenever the host changes account or organization. */
function usePortalContextKey() {
  const [contextKey, setContextKey] = useState(() =>
    portalContextKey(runtimeBridge()?.getContext?.())
  )

  useEffect(() => {
    const bridge = runtimeBridge()
    if (!bridge) return
    if (bridge.subscribe) {
      return bridge.subscribe(context => setContextKey(portalContextKey(context)))
    }

    // Compatibility for older versioned hosts that expose the focused switch
    // callbacks but not the aggregate context subscription.
    let revision = 0
    const changed = () => setContextKey(`legacy:${++revision}`)
    const unsubscribeOrganization = bridge.onOrgSwitch?.(changed)
    const unsubscribeAccount = bridge.onAccountSwitch?.(changed)
    return () => {
      unsubscribeOrganization?.()
      unsubscribeAccount?.()
    }
  }, [])

  return contextKey
}

function mergeExecutionOutcomeTrends(groups: ExecutionOutcomeTrend[][]): ExecutionOutcomeTrend[] {
  const merged = new Map<string, ExecutionOutcomeTrend>()
  for (const item of groups.flat()) {
    const current = merged.get(item.date) ?? {
      date: item.date,
      passed: 0,
      failed: 0,
      cancelled: 0,
      running: 0,
      durationSampleCount: 0,
      averageDurationMs: 0,
      maximumDurationMs: 0,
      retryAttemptCount: 0,
      successfulRetryCount: 0,
      recoveredRunCount: 0,
    }
    const itemDurationSampleCount = item.durationSampleCount ?? 0
    const itemAverageDurationMs = item.averageDurationMs ?? 0
    const combinedDurationMs =
      current.averageDurationMs * current.durationSampleCount +
      itemAverageDurationMs * itemDurationSampleCount
    current.passed += item.passed
    current.failed += item.failed
    current.cancelled += item.cancelled
    current.running += item.running
    current.durationSampleCount += itemDurationSampleCount
    current.averageDurationMs = current.durationSampleCount
      ? Math.round(combinedDurationMs / current.durationSampleCount)
      : 0
    current.maximumDurationMs = Math.max(current.maximumDurationMs, item.maximumDurationMs ?? 0)
    current.retryAttemptCount += item.retryAttemptCount ?? 0
    current.successfulRetryCount += item.successfulRetryCount ?? 0
    current.recoveredRunCount += item.recoveredRunCount ?? 0
    merged.set(item.date, current)
  }
  return [...merged.values()].sort((left, right) => left.date.localeCompare(right.date))
}

function isView(value: unknown): value is View {
  return typeof value === 'string' && navigation.some(item => item.id === value)
}

export function viewFromPathname(pathname: string): View | undefined {
  if (/^\/app\/fuzequality\/?$/.test(pathname)) return 'overview'
  const match = pathname.match(/^\/app\/fuzequality\/([^/?#]+)/)
  if (match && isView(match[1])) return match[1]
  if (/^\/?$/.test(pathname)) return 'overview'
  const standaloneMatch = pathname.match(/^\/([^/?#]+)/)
  return standaloneMatch && isView(standaloneMatch[1])
    ? standaloneMatch[1]
    : undefined
}

export function pathForView(view: View, embedded: boolean) {
  const suffix = view === 'overview' ? '' : `/${view}`
  return embedded ? `/app/fuzequality${suffix}` : suffix || '/'
}

export function navigatePortalView(
  view: View,
  embedded: boolean,
  bridge: FuzeFrontRuntimeBridge | undefined = runtimeBridge(),
  history: Pick<History, 'pushState'> = window.history
) {
  const path = pathForView(view, embedded)
  if (embedded && bridge?.navigate) bridge.navigate(path)
  else history.pushState({}, '', path)
}

/** Connect host menu events and browser history to the app's active view. */
export function connectPortalNavigation(
  bridge: FuzeFrontRuntimeBridge | undefined,
  setView: (view: View) => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  pathname: () => string = () => window.location.pathname
) {
  bridge?.menu?.add('fuzequality', portalMenuItems)
  const syncPath = () => {
    const view = viewFromPathname(pathname())
    if (view) setView(view)
  }
  const onNavigate = (event: Event) => {
    const detail = (event as CustomEvent<{ id?: unknown; section?: unknown }>)
      .detail
    const view = detail?.section ?? detail?.id
    if (isView(view)) setView(view)
  }
  target.addEventListener('fuzefront:navigate', onNavigate)
  target.addEventListener('popstate', syncPath)
  syncPath()
  return () => {
    target.removeEventListener('fuzefront:navigate', onNavigate)
    target.removeEventListener('popstate', syncPath)
    bridge?.menu?.remove('fuzequality')
  }
}

/** Publish the app's IA to the portal sidebar; the host remains its renderer. */
function usePortalMenu(setView: (view: View) => void) {
  useEffect(() => {
    return connectPortalNavigation(runtimeBridge(), setView)
  }, [setView])
}

const coverageLabel: Record<CoverageState, string> = {
  'covered-explicit': 'Covered',
  'covered-generated': 'Generated',
  'likely-covered': 'Likely',
  gap: 'Gap',
  excluded: 'Excluded',
  unknown: 'Unknown',
}

function coverageSummary(expectations: TestExpectation[]) {
  const relevant = expectations.filter(
    item => item.priority !== 'not-applicable'
  )
  const covered = relevant.filter(item =>
    item.coverage.startsWith('covered')
  ).length
  return {
    total: relevant.length,
    covered,
    gaps: relevant.filter(item => item.coverage === 'gap').length,
    percent: relevant.length
      ? Math.round((covered / relevant.length) * 100)
      : 0,
  }
}

function CoverageRail({ expectations }: { expectations: TestExpectation[] }) {
  const visible = expectations.slice(0, 36)
  return (
    <div className="coverage-rail" aria-label="Coverage evidence rail">
      {visible.length ? (
        visible.map(item => (
          <span
            key={item.id}
            className={`rail-segment state-${item.coverage}`}
            title={`${item.label}: ${coverageLabel[item.coverage]}`}
          />
        ))
      ) : (
        <span className="rail-empty">No expectations indexed yet</span>
      )}
    </div>
  )
}

function StatusPill({ state }: { state: CoverageState }) {
  return (
    <span className={`status-pill state-${state}`}>{coverageLabel[state]}</span>
  )
}

function GapPlanDrawer({
  subject,
  repository,
  expectations,
  selectedId,
  onClose,
}: {
  subject: ApiOperation | FrontendSurface
  repository?: Repository
  expectations: TestExpectation[]
  selectedId: string
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const gaps = expectations.filter(
    item => item.coverage === 'gap' && item.priority !== 'not-applicable'
  )
  const [selected, setSelected] = useState(
    () => new Set(gaps.map(item => item.id))
  )
  const [implementation, setImplementation] =
    useState<TestImplementationRequest>()
  const [implementationError, setImplementationError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    closeButton.current?.focus()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  useEffect(() => {
    if (
      !implementation ||
      !['queued', 'running'].includes(implementation.status)
    )
      return
    const timer = window.setInterval(async () => {
      try {
        setImplementation(await api.testImplementation(implementation.id))
      } catch {
        /* retain last known state */
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [implementation])
  const implement = async () => {
    if (!repository?.lastScanRevision || selected.size === 0) return
    setSubmitting(true)
    setImplementationError('')
    try {
      setImplementation(
        await api.implementTests({
          repositoryId: repository.id,
          sourceRevision: repository.lastScanRevision,
          expectationIds: [...selected],
        })
      )
    } catch (error) {
      setImplementationError(
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      setSubmitting(false)
    }
  }
  const subjectLabel =
    'method' in subject
      ? `${subject.method.toUpperCase()} ${subject.path}`
      : `${subject.name} · ${subject.packageName}`
  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="gap-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gap-plan-title"
      >
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Deterministic test planner</p>
            <h2 id="gap-plan-title">{gaps.length} tests to close this gap</h2>
            <code>{subjectLabel}</code>
          </div>
          <QualityIconAction
            ref={closeButton}
            onClick={onClose}
            label="Close test plan"
          >
            <X />
          </QualityIconAction>
        </header>
        <p className="drawer-intro">
          Generated from catalog policy and source metadata. These are
          authoritative expected tests—not AI suggestions.
        </p>
        <div className="implementation-toolbar">
          <label>
            <input
              type="checkbox"
              checked={selected.size === gaps.length}
              onChange={event =>
                setSelected(
                  event.target.checked
                    ? new Set(gaps.map(item => item.id))
                    : new Set()
                )
              }
            />{' '}
            Select all
          </label>
          <QualityAction
            disabled={
              submitting || selected.size === 0 || !repository?.lastScanRevision
            }
            onClick={implement}
          >
            <Sparkles size={15} />{' '}
            {submitting ? 'Launching…' : `Implement ${selected.size} selected`}
          </QualityAction>
        </div>
        {implementation && (
          <div
            className={`implementation-status implementation-${implementation.status}`}
            role="status"
          >
            <strong>Cloud Codex: {implementation.status}</strong>
            <span>
              {implementation.agentProfile} · {implementation.skills.join(', ')}
            </span>
            {implementation.workflowUrl && (
              <a
                href={implementation.workflowUrl}
                target="_blank"
                rel="noreferrer"
              >
                View workflow <ExternalLink size={13} />
              </a>
            )}
            {implementation.pullRequestUrl && (
              <a
                href={implementation.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open pull request <ExternalLink size={13} />
              </a>
            )}
            {implementation.error && <span>{implementation.error}</span>}
          </div>
        )}
        {implementationError && (
          <div className="form-error" role="alert">
            {implementationError}
          </div>
        )}
        <div className="planned-tests">
          {gaps.map((expectation, index) => {
            const plan = planGap(expectation, subject)
            return (
              <article
                className={
                  expectation.id === selectedId
                    ? 'planned-test selected'
                    : 'planned-test'
                }
                key={expectation.id}
              >
                <div className="plan-index">
                  <input
                    type="checkbox"
                    aria-label={`Select ${plan.title}`}
                    checked={selected.has(expectation.id)}
                    onChange={event =>
                      setSelected(current => {
                        const next = new Set(current)
                        event.target.checked
                          ? next.add(expectation.id)
                          : next.delete(expectation.id)
                        return next
                      })
                    }
                  />
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className="plan-body">
                  <div className="plan-heading">
                    <div>
                      <span>
                        {plan.priority} · {plan.level}
                      </span>
                      <h3>{plan.title}</h3>
                    </div>
                    {expectation.id === selectedId && <b>Selected gap</b>}
                  </div>
                  <dl className="plan-path">
                    <dt>Suggested file</dt>
                    <dd>
                      <code>{plan.suggestedFile}</code>
                    </dd>
                  </dl>
                  <div className="aaa-grid">
                    <section>
                      <h4>Arrange</h4>
                      <p>{plan.arrange}</p>
                    </section>
                    <section>
                      <h4>Act</h4>
                      <p>{plan.act}</p>
                    </section>
                    <section>
                      <h4>Assert</h4>
                      <ul>
                        {plan.assertions.map(assertion => (
                          <li key={assertion}>{assertion}</li>
                        ))}
                      </ul>
                    </section>
                  </div>
                  <footer>
                    <BookOpen size={13} />
                    <span>{plan.provenance}</span>
                  </footer>
                </div>
              </article>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

function ComponentPreviewDrawer({
  surface,
  repository,
  onClose,
}: {
  surface: FrontendSurface
  repository?: Repository
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const [story, setStory] = useState<StorybookStory | undefined>(
    surface.stories[0]
  )
  const previewUrl =
    story && storybookPreviewUrl(repository?.storybookBaseUrl, story)
  useEffect(() => {
    closeButton.current?.focus()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="preview-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="component-preview-title"
      >
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Storybook visual reference</p>
            <h2 id="component-preview-title">{surface.name}</h2>
            <code>
              {surface.packageName} · {surface.sourcePath}
            </code>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            onClick={onClose}
            aria-label="Close component preview"
          >
            <X />
          </button>
        </header>
        {surface.stories.length > 0 ? (
          <>
            <div className="preview-toolbar">
              <label>
                Story
                <select
                  value={story?.id}
                  onChange={event =>
                    setStory(
                      surface.stories.find(
                        item => item.id === event.target.value
                      )
                    )
                  }
                >
                  {surface.stories.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  Open Storybook <ExternalLink size={14} />
                </a>
              )}
            </div>
            {previewUrl ? (
              <div className="storybook-frame">
                <iframe
                  title={`${surface.name}: ${story?.name}`}
                  src={previewUrl}
                  sandbox="allow-scripts allow-forms"
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : (
              <div className="preview-empty">
                <Eye />
                <strong>Story discovered; preview host not configured</strong>
                <span>
                  Add this repository’s HTTPS Storybook URL to render its
                  isolated story here.
                </span>
                <code>
                  {story?.sourcePath} · {story?.exportName}
                </code>
              </div>
            )}
            <footer className="preview-provenance">
              <BookOpen size={14} /> Static CSF metadata from the scanned
              commit. The iframe runs sandboxed without same-origin, navigation,
              or popup privileges.
            </footer>
          </>
        ) : (
          <div className="preview-empty">
            <Eye />
            <strong>No Storybook visual reference found</strong>
            <span>
              Add a co-located <code>*.stories.tsx</code> file and publish
              Storybook to make this component renderable.
            </span>
          </div>
        )}
      </aside>
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  detail: string
  tone?: string
}) {
  return (
    <article className={`stat stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function Overview({
  data,
  onNavigate,
}: {
  data: Portfolio
  onNavigate: (view: View) => void
}) {
  const summary = coverageSummary(data.expectations)
  const openFindings = data.findings.filter(item => item.status === 'open')
  return (
    <>
      <header className="page-header thesis">
        <div>
          <p className="eyebrow">Coverage snapshot / default branches</p>
          <h1>See what the platform promises—and where proof stops.</h1>
          <p className="lede">
            One evidence map across API contracts, frontend surfaces, tests, and
            product intent.
          </p>
        </div>
        <div
          className="coverage-dial"
          style={
            {
              '--coverage': `${summary.percent * 3.6}deg`,
            } as React.CSSProperties
          }
        >
          <span>
            <strong>{summary.percent}%</strong> authoritative
          </span>
        </div>
      </header>

      <CoverageRail expectations={data.expectations} />
      <div className="rail-key">
        <span>
          <i className="key-covered" /> accepted evidence
        </span>
        <span>
          <i className="key-gap" /> required gap
        </span>
        <span>
          <i className="key-likely" /> review needed
        </span>
      </div>

      <section className="stats-grid">
        <Stat
          label="Repositories"
          value={data.repositories.length}
          detail="default branches indexed"
        />
        <Stat
          label="API operations"
          value={data.operations.length}
          detail="across discovered contracts"
        />
        <Stat
          label="Frontend surfaces"
          value={data.surfaces.length}
          detail="routes, pages, components"
        />
        <Stat
          label="Required gaps"
          value={summary.gaps}
          detail="without accepted evidence"
          tone="danger"
        />
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Repository pulse</p>
              <h2>Latest inventory</h2>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate('repositories')}
            >
              Manage <ArrowRight size={15} />
            </button>
          </div>
          <div className="repo-list">
            {data.repositories.map(repository => {
              const expectations = data.expectations.filter(item => {
                const operation = data.operations.find(
                  op => op.id === item.subjectId
                )
                const surface = data.surfaces.find(
                  ui => ui.id === item.subjectId
                )
                return (
                  operation?.repositoryId === repository.id ||
                  surface?.repositoryId === repository.id
                )
              })
              const repoSummary = coverageSummary(expectations)
              return (
                <div className="repo-row" key={repository.id}>
                  <div className="repo-mark">
                    {repository.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="repo-copy">
                    <strong>{repository.name}</strong>
                    <small>
                      {repository.owner} / {repository.defaultBranch}
                    </small>
                  </div>
                  <div className="mini-progress">
                    <span style={{ width: `${repoSummary.percent}%` }} />
                  </div>
                  <b>{repoSummary.percent}%</b>
                </div>
              )
            })}
          </div>
        </article>

        <article className="panel findings-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Attention queue</p>
              <h2>Highest-impact gaps</h2>
            </div>
            <button className="icon-button" aria-label="Refresh">
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="finding-list">
            {openFindings.slice(0, 5).map(finding => (
              <div className="finding-row" key={finding.id}>
                <AlertTriangle size={17} />
                <div>
                  <strong>{finding.title}</strong>
                  <small>{finding.detail}</small>
                </div>
                <span className={`severity severity-${finding.severity}`}>
                  {finding.severity}
                </span>
              </div>
            ))}
            {!openFindings.length && (
              <div className="empty-state">
                <ShieldCheck />
                <strong>No open findings</strong>
                <span>Run a repository scan to calculate gaps.</span>
              </div>
            )}
          </div>
        </article>
      </section>
    </>
  )
}

export function Repositories({
  data,
  reload,
  updateProcessingStatus,
}: {
  data: Portfolio
  reload: () => Promise<void>
  updateProcessingStatus: (status: import('@fuzequality/contracts').RepositoryProcessingStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [retryingAnalysis, setRetryingAnalysis] = useState<string>()
  const [history, setHistory] = useState<
    Record<string, RepositoryScanHistoryPage>
  >({})
  const [historyLoading, setHistoryLoading] = useState<
    Record<string, boolean>
  >({})
  const [form, setForm] = useState({
    owner: 'izzywdev',
    name: '',
    defaultBranch: 'main',
    kind: 'mixed',
    installationId: '',
    storybookBaseUrl: '',
  })
  const processingRepositoryIds = data.repositories
    .filter(repositoryNeedsProcessingPoll)
    .map(repository => repository.id)
    .sort()
    .join(',')
  useEffect(() => {
    if (!processingRepositoryIds) return
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      const ids = processingRepositoryIds.split(',')
      const results = await Promise.allSettled(ids.map(id => api.repositoryProcessingStatus(id)))
      if (active) {
        results.forEach(result => {
          if (result.status === 'fulfilled') updateProcessingStatus(result.value)
        })
        setPollError(results.some(result => result.status === 'rejected')
          ? 'Repository processing status is temporarily unavailable; the scan continues in the background.'
          : '')
      }
      refreshing = false
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 3_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [processingRepositoryIds, updateProcessingStatus])
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = {
        ...form,
        storybookBaseUrl: form.storybookBaseUrl || undefined,
        includeGlobs: [],
        excludeGlobs: [],
        jiraProjects: [],
      }
      await api.verifyRepository(payload)
      await api.addRepository(payload)
      setOpen(false)
      await reload()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Repository onboarding failed'
      )
    } finally {
      setBusy(false)
    }
  }
  async function scan(id: string, localPath?: string) {
    setBusy(true)
    try {
      await api.scanRepository(id, localPath)
      await reload()
    } finally {
      setBusy(false)
    }
  }
  async function retryAnalysis(id: string) {
    setRetryingAnalysis(id)
    setError('')
    try {
      updateProcessingStatus(await api.retryRepositoryAnalysis(id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reviewed analysis could not be requeued')
    } finally {
      setRetryingAnalysis(undefined)
    }
  }
  async function loadHistory(id: string, cursor?: string) {
    if ((!cursor && history[id]) || historyLoading[id]) return
    setHistoryLoading(current => ({ ...current, [id]: true }))
    try {
      const response = await api.repositoryScanHistory(id, cursor)
      const page = Array.isArray(response)
        ? { items: response, page: { nextCursor: null, hasMore: false } }
        : response
      setHistory(current => ({
        ...current,
        [id]: cursor && current[id]
          ? { items: [...current[id].items, ...page.items], page: page.page }
          : page,
      }))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Scan history could not be loaded'
      )
    } finally {
      setHistoryLoading(current => ({ ...current, [id]: false }))
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Source control"
        title="Repository inventory"
        detail="Onboard read-only sources and inspect their latest deterministic scan."
        action={
          <QualityAction onClick={() => setOpen(true)}>
            <Plus size={16} /> Add repository
          </QualityAction>
        }
      />
      <section className="repo-cards">
        {pollError && <p className="form-error" role="alert">{pollError}</p>}
        {data.repositories.map(repository => {
          const diagnostics = data.diagnostics.filter(
            item => item.repositoryId === repository.id
          )
          return (
            <article className="repo-card" key={repository.id}>
              <div className="repo-card-top">
                <div className="repo-mark large">
                  {repository.name.slice(0, 2).toUpperCase()}
                </div>
                <span
                  className={`scan-status scan-${repository.lastScanStatus}`}
                >
                  {repository.lastScanStatus}
                </span>
              </div>
              <h3>{repository.name}</h3>
              <p>{repository.canonicalUrl}</p>
              <RepositoryAnalysisStatus
                analysis={repository.lastAnalysis}
                onRetry={repository.lastAnalysis?.status === 'failed' ? () => void retryAnalysis(repository.id) : undefined}
                retrying={retryingAnalysis === repository.id}
              />
              <dl>
                <div>
                  <dt>Branch</dt>
                  <dd>{repository.defaultBranch}</dd>
                </div>
                <div>
                  <dt>Kind</dt>
                  <dd>{repository.kind}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd title={repository.lastScanRevision}>
                    {repository.lastScanRevision?.slice(0, 12) ?? 'Not scanned'}
                  </dd>
                </div>
                <div>
                  <dt>Last scan</dt>
                  <dd>
                    {repository.lastScanAt
                      ? new Date(repository.lastScanAt).toLocaleString()
                      : 'Never'}
                  </dd>
                </div>
              </dl>
              {diagnostics.length > 0 && (
                <details className="scan-diagnostics">
                  <summary>
                    <AlertTriangle size={14} /> {diagnostics.length} scan{' '}
                    {diagnostics.length === 1 ? 'diagnostic' : 'diagnostics'}
                  </summary>
                  <div>
                    {diagnostics.map(item => (
                      <article key={`${item.sourcePath}:${item.code}`}>
                        <span
                          className={`diagnostic-severity diagnostic-${item.severity}`}
                        >
                          {item.severity}
                        </span>
                        <code>{item.sourcePath}</code>
                        <strong>{item.code}</strong>
                        <p>{item.message}</p>
                      </article>
                    ))}
                  </div>
                </details>
              )}
              <details
                className="scan-diagnostics"
                onToggle={event => {
                  if ((event.currentTarget as HTMLDetailsElement).open)
                    void loadHistory(repository.id)
                }}
              >
                <summary>
                  <GitBranch size={14} /> Scan history
                </summary>
                <div>
                  {history[repository.id] ? (
                    history[repository.id].items.length ? (
                      <>
                        {history[repository.id].items.map(entry => (
                          <article key={entry.id}>
                            <span
                              className={`scan-status scan-${entry.status}`}
                            >
                              {entry.status}
                            </span>
                            <code>
                              {entry.revision.slice(0, 12)} · {entry.branch}
                            </code>
                            <strong>
                              {entry.counts.operations} API ·{' '}
                              {entry.counts.surfaces} surfaces ·{' '}
                              {entry.counts.tests} tests
                            </strong>
                            <p>
                              {entry.scannedAt
                                ? new Date(entry.scannedAt).toLocaleString()
                                : 'Scan queued'}
                            </p>
                          </article>
                        ))}
                        {history[repository.id].page.hasMore &&
                          history[repository.id].page.nextCursor && (
                            <QualityAction
                              intent="secondary"
                              disabled={historyLoading[repository.id]}
                              onClick={() =>
                                void loadHistory(
                                  repository.id,
                                  history[repository.id].page.nextCursor ??
                                    undefined
                                )
                              }
                            >
                              {historyLoading[repository.id]
                                ? 'Loading…'
                                : 'Load more scan history'}
                            </QualityAction>
                          )}
                      </>
                    ) : (
                      <p>No scan runs recorded yet.</p>
                    )
                  ) : (
                    <p>
                      {historyLoading[repository.id]
                        ? 'Loading scan history…'
                        : 'Scan history is not loaded.'}
                    </p>
                  )}
                </div>
              </details>
              <QualityAction
                intent="secondary"
                disabled={busy}
                onClick={() => scan(repository.id, repository.localPath)}
              >
                <RefreshCw size={15} /> Scan now
              </QualityAction>
            </article>
          )
        })}
      </section>
      {open && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" onSubmit={submit}>
            <div className="modal-title">
              <div>
                <p className="eyebrow">GitHub App source</p>
                <h2>Add repository</h2>
              </div>
              <QualityIconAction
                type="button"
                onClick={() => setOpen(false)}
                label="Close repository form"
              >
                <X />
              </QualityIconAction>
            </div>
            <label>
              Owner
              <input
                value={form.owner}
                onChange={event =>
                  setForm({ ...form, owner: event.target.value })
                }
                required
              />
            </label>
            <label>
              Repository name
              <input
                value={form.name}
                onChange={event =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="FuzeService"
                required
              />
            </label>
            <label>
              GitHub App installation ID
              <input
                value={form.installationId}
                onChange={event =>
                  setForm({
                    ...form,
                    installationId: event.target.value.trim(),
                  })
                }
                inputMode="numeric"
                placeholder="148577461"
                required
              />
              <small>
                The read-only FuzeQuality GitHub App installation that can
                access this repository.
              </small>
            </label>
            <label>
              Storybook URL (optional)
              <input
                type="url"
                value={form.storybookBaseUrl}
                onChange={event =>
                  setForm({
                    ...form,
                    storybookBaseUrl: event.target.value.trim(),
                  })
                }
                placeholder="https://storybook.example.com"
              />
              <small>
                HTTPS host for sandboxed component previews. Story metadata is
                cataloged even without it.
              </small>
            </label>
            <div className="form-row">
              <label>
                Default branch
                <input
                  value={form.defaultBranch}
                  onChange={event =>
                    setForm({ ...form, defaultBranch: event.target.value })
                  }
                />
              </label>
              <label>
                Kind
                <select
                  value={form.kind}
                  onChange={event =>
                    setForm({ ...form, kind: event.target.value })
                  }
                >
                  <option value="mixed">Mixed</option>
                  <option value="service">Service</option>
                  <option value="application">Application</option>
                  <option value="library">Library</option>
                  <option value="infrastructure">Infrastructure</option>
                </select>
              </label>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <QualityAction
                type="button"
                intent="secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </QualityAction>
              <QualityAction disabled={busy}>
                {busy ? 'Verifying…' : 'Verify and add'}
              </QualityAction>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function Matrix({
  items,
  expectations,
  kind,
  repositories = [],
}: {
  items: Array<ApiOperation | FrontendSurface>
  expectations: TestExpectation[]
  kind: 'api' | 'frontend'
  repositories?: Repository[]
}) {
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<{
    subject: ApiOperation | FrontendSurface
    expectationId: string
  }>()
  const [preview, setPreview] = useState<FrontendSurface>()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const filtered = items.filter(item =>
    JSON.stringify(item).toLowerCase().includes(query.toLowerCase())
  )
  function closePlan() {
    setSelection(undefined)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  return (
    <>
      <div className="filter-bar">
        <Search size={16} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={`Filter ${kind === 'api' ? 'operations' : 'surfaces'}…`}
        />
        <span>{filtered.length} shown</span>
      </div>
      <div className="matrix">
        <div className="matrix-head">
          <span>{kind === 'api' ? 'Operation' : 'Surface'}</span>
          <span>Expected evidence</span>
          <span>Status</span>
        </div>
        {filtered.map(item => {
          const rows = expectations.filter(
            expectation => expectation.subjectId === item.id
          )
          const surface =
            kind === 'frontend' ? (item as FrontendSurface) : undefined
          return (
            <div className="matrix-group" key={item.id}>
              <div className="matrix-subject">
                {kind === 'api' ? (
                  <code>
                    <b>{(item as ApiOperation).method.toUpperCase()}</b>{' '}
                    {(item as ApiOperation).path}
                  </code>
                ) : (
                  <>
                    <strong>{surface?.name}</strong>
                    <small>
                      {surface?.packageName} · {surface?.kind}
                    </small>
                    <button
                      className="preview-button"
                      onClick={() => setPreview(surface)}
                    >
                      <Eye size={14} />{' '}
                      {surface?.stories.length
                        ? `${surface.stories.length} visual ${surface.stories.length === 1 ? 'state' : 'states'}`
                        : 'Visual reference'}
                    </button>
                  </>
                )}
              </div>
              <div className="matrix-expectations">
                {rows.map(row => (
                  <div key={row.id}>
                    <span>{row.label}</span>
                    <small>{row.rule}</small>
                  </div>
                ))}
              </div>
              <div className="matrix-states">
                {rows.map(row =>
                  row.coverage === 'gap' ? (
                    <button
                      key={row.id}
                      className="gap-button state-gap"
                      onClick={event => {
                        trigger.current = event.currentTarget
                        setSelection({ subject: item, expectationId: row.id })
                      }}
                      aria-label={`Gap: ${row.label}. Show ${rows.filter(candidate => candidate.coverage === 'gap').length} tests to add.`}
                    >
                      Gap <ChevronRight size={14} />
                    </button>
                  ) : (
                    <StatusPill key={row.id} state={row.coverage} />
                  )
                )}
              </div>
            </div>
          )
        })}
        {!filtered.length && (
          <div className="empty-state roomy">
            <FileCode2 />
            <strong>No catalog entries match</strong>
            <span>Adjust the filter or scan a repository.</span>
          </div>
        )}
      </div>
      {selection && (
        <GapPlanDrawer
          subject={selection.subject}
          repository={repositories.find(
            item => item.id === selection.subject.repositoryId
          )}
          expectations={expectations.filter(
            item => item.subjectId === selection.subject.id
          )}
          selectedId={selection.expectationId}
          onClose={closePlan}
        />
      )}
      {preview && (
        <ComponentPreviewDrawer
          surface={preview}
          repository={repositories.find(
            item => item.id === preview.repositoryId
          )}
          onClose={() => setPreview(undefined)}
        />
      )}
    </>
  )
}

function CatalogPage({
  type,
  data,
}: {
  type: 'api' | 'frontend'
  data: Portfolio
}) {
  const isApi = type === 'api'
  const expectations = data.expectations.filter(
    item => item.subjectType === (isApi ? 'api-operation' : 'frontend-surface')
  )
  const items: Array<ApiOperation | FrontendSurface> = isApi
    ? data.operations
    : data.surfaces
  return (
    <>
      <PageHeading
        eyebrow={isApi ? 'Contract inventory' : 'Implemented surface'}
        title={isApi ? 'API coverage matrix' : 'Frontend coverage matrix'}
        detail={
          isApi
            ? 'Every operation measured against schema-derived test expectations.'
            : 'Routes, pages, components, states, Storybook documentation, and test evidence.'
        }
        action={
          <div className="header-badge">
            {isApi ? <Braces /> : <Code2 />} {items.length} indexed
          </div>
        }
      />
      <CoverageRail expectations={expectations} />
      <Matrix
        items={items}
        expectations={expectations}
        kind={type}
        repositories={data.repositories}
      />
    </>
  )
}

function FindingDetail({
  finding,
  onClose,
}: {
  finding: Portfolio['findings'][number]
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <aside
        className="modal finding-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finding-detail-title"
      >
        <div className="modal-title">
          <div>
            <p className="eyebrow">Coverage finding</p>
            <h2 id="finding-detail-title">{finding.title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close finding detail"
          >
            <X />
          </button>
        </div>
        <p>{finding.detail}</p>
        <dl className="finding-detail-grid">
          <div>
            <dt>Severity</dt>
            <dd>{finding.severity}</dd>
          </div>
          <div>
            <dt>Rule / policy</dt>
            <dd>{finding.policyVersion ?? finding.type ?? 'catalog policy'}</dd>
          </div>
          <div>
            <dt>Evidence strength</dt>
            <dd>{finding.evidenceStrength ?? 'unknown'}</dd>
          </div>
          <div>
            <dt>Source revision</dt>
            <dd>{finding.sourceRevision ?? 'catalog'}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{finding.owner ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{finding.status}</dd>
          </div>
        </dl>
        {(finding.evidence?.length ?? 0) > 0 && (
          <section>
            <b>Evidence</b>
            <div className="evidence-list">
              {finding.evidence?.map(item => (
                <blockquote key={item}>“{item}”</blockquote>
              ))}
            </div>
          </section>
        )}
        {(finding.affectedTargetIds?.length ?? 0) > 0 && (
          <section>
            <b>Related targets</b>
            <div className="finding-impact">
              {finding.affectedTargetIds?.map(item => (
                <code key={item}>{item}</code>
              ))}
            </div>
          </section>
        )}
        {finding.remediation && (
          <section>
            <b>Remediation</b>
            <p>{finding.remediation}</p>
          </section>
        )}
        <small>
          Generated{' '}
          {finding.generatedAt
            ? new Date(finding.generatedAt).toLocaleString()
            : 'pending projection'}{' '}
          · schema {finding.schemaVersion ?? 'unknown'}
        </small>
      </aside>
    </div>
  )
}

function ApiCatalogPage({ data }: { data: Portfolio }) {
  const [repositoryId, setRepositoryId] = useState('')
  const [tag, setTag] = useState('')
  const [coverage, setCoverage] = useState<CoverageState | ''>('')
  const [selectedFinding, setSelectedFinding] =
    useState<Portfolio['findings'][number]>()
  const apiExpectations = data.expectations.filter(
    item => item.subjectType === 'api-operation'
  )
  const tags = [
    ...new Set(data.operations.flatMap(operation => operation.tags)),
  ].sort()
  const operations = data.operations.filter(operation => {
    const expectations = apiExpectations.filter(
      item => item.subjectId === operation.id
    )
    return (
      (!repositoryId || operation.repositoryId === repositoryId) &&
      (!tag || operation.tags.includes(tag)) &&
      (!coverage || expectations.some(item => item.coverage === coverage))
    )
  })
  const visibleIds = new Set(operations.map(operation => operation.id))
  const expectations = apiExpectations.filter(item =>
    visibleIds.has(item.subjectId)
  )
  const findings = data.findings.filter(
    item =>
      item.status === 'open' &&
      (visibleIds.has(item.subjectId ?? '') ||
        (!item.subjectId &&
          operations.some(
            operation => operation.repositoryId === item.repositoryId
          )))
  )
  const summary = coverageSummary(expectations)
  return (
    <>
      <PageHeading
        eyebrow="Contract inventory / authoritative snapshot"
        title="API coverage matrix"
        detail="Every operation measured against schema-derived expectations, accepted test evidence, and actionable contract findings."
        action={
          <div className="header-badge">
            <Braces /> {operations.length} operations
          </div>
        }
      />
      <section
        className="stats-grid compact-stats"
        aria-label="API coverage totals"
      >
        <Stat
          label="Coverage"
          value={`${summary.percent}%`}
          detail={`${summary.covered} of ${summary.total} expectations`}
        />
        <Stat
          label="Required gaps"
          value={summary.gaps}
          detail="without accepted evidence"
          tone="danger"
        />
        <Stat
          label="Open findings"
          value={findings.length}
          detail="contract and coverage actions"
          tone={findings.length ? 'danger' : 'neutral'}
        />
        <Stat
          label="Revision set"
          value={
            data.repositories.filter(repository => repository.lastScanRevision)
              .length
          }
          detail="scanned repositories represented"
        />
      </section>
      <div className="catalog-filters" aria-label="API catalog filters">
        <label>
          Repository
          <select
            value={repositoryId}
            onChange={event => setRepositoryId(event.target.value)}
          >
            <option value="">All repositories</option>
            {data.repositories.map(repository => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <select value={tag} onChange={event => setTag(event.target.value)}>
            <option value="">All tags</option>
            {tags.map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Coverage
          <select
            value={coverage}
            onChange={event =>
              setCoverage(event.target.value as CoverageState | '')
            }
          >
            <option value="">All states</option>
            {Object.entries(coverageLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="snapshot-stamp">
          <span>Policy</span>
          <strong>api-coverage-v1</strong>
          <small>
            {
              data.repositories.filter(repository => repository.lastScanAt)
                .length
            }{' '}
            fresh scan snapshots
          </small>
        </div>
      </div>
      <CoverageRail expectations={expectations} />
      <Matrix
        items={operations}
        expectations={expectations}
        kind="api"
        repositories={data.repositories}
      />
      <section className="panel catalog-findings">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Remediation queue</p>
            <h2>OpenAPI quality and coverage findings</h2>
          </div>
          <span className="header-badge">
            <AlertTriangle /> {findings.length}
          </span>
        </div>
        <div className="finding-list">
          {findings.map(finding => (
            <button
              className="finding-row finding-action"
              key={finding.id}
              onClick={() => setSelectedFinding(finding)}
            >
              <AlertTriangle size={17} />
              <div>
                <strong>{finding.title}</strong>
                <small>{finding.detail}</small>
                {finding.remediation && (
                  <p>
                    <b>Next:</b> {finding.remediation}
                  </p>
                )}
              </div>
              <div className="finding-owner">
                <span className={`severity severity-${finding.severity}`}>
                  {finding.severity}
                </span>
                <small>{finding.owner ?? 'Unassigned'}</small>
              </div>
            </button>
          ))}
          {!findings.length && (
            <div className="empty-state">
              <ShieldCheck />
              <strong>No findings in this view</strong>
              <span>Adjust filters or scan another repository.</span>
            </div>
          )}
        </div>
      </section>
      {selectedFinding && (
        <FindingDetail
          finding={selectedFinding}
          onClose={() => setSelectedFinding(undefined)}
        />
      )}
    </>
  )
}

function Requirements({ data }: { data: Portfolio }) {
  const [freshness, setFreshness] = useState<
    'unknown' | 'fresh' | 'stale' | 'failed'
  >('unknown')
  useEffect(() => {
    api
      .requirementFreshness()
      .then(value => setFreshness(value.freshnessStatus))
      .catch(() => setFreshness('failed'))
  }, [])
  return (
    <>
      <PageHeading
        eyebrow="Product intent"
        title="Requirements & inferred flows"
        detail="Jira stays authoritative. AI proposals remain visibly separate until reviewed."
        action={
          <div className={`header-badge freshness-${freshness}`}>
            <Database /> Jira {freshness}
          </div>
        }
      />
      <div className="requirements-grid">
        {data.requirements.map(requirement => {
          const flows = data.flows.filter(
            flow => flow.requirementId === requirement.id
          )
          const suggestions = data.suggestions.filter(
            item =>
              item.requirementId === requirement.id && item.state === 'proposed'
          )
          const findings = data.findings.filter(
            item =>
              item.subjectId === requirement.id ||
              item.sourceRevision?.startsWith(`${requirement.jiraKey}@`)
          )
          return (
            <article className="requirement-card" key={requirement.id}>
              <div className="requirement-key">{requirement.jiraKey}</div>
              <span className="issue-type">{requirement.issueType}</span>
              <h3>{requirement.summary}</h3>
              <p>{requirement.description}</p>
              <div className="requirement-meta">
                <span>
                  <CircleDot /> {requirement.status}
                </span>
                <span>
                  <Network /> {flows.length} confirmed flows
                </span>
                <span>
                  <Sparkles /> {suggestions.length} proposals
                </span>
                <span
                  className={findings.length ? 'requirement-gap-count' : ''}
                >
                  <AlertTriangle /> {findings.length} quality findings
                </span>
              </div>
              <details className="requirement-flows">
                <summary>
                  <Network size={14} /> Confirmed actor-step flows
                </summary>
                {flows.length ? (
                  flows.map(flow => {
                    const steps = flow.steps ?? []
                    return (
                      <section className="requirement-flow" key={flow.id}>
                        <strong>{flow.title}</strong>
                        <small>
                          {flow.origin ?? 'confirmed'} · {steps.length} steps
                        </small>
                        <ol className="flow-steps">
                          {steps.map(step => (
                            <li
                              key={step.id}
                              className={`flow-step-${step.variant}`}
                            >
                              <b>{step.position}</b>
                              <div>
                                <strong>{step.actor}</strong>
                                <span>{step.action}</span>
                                <small>Expected: {step.expectedOutcome}</small>
                                {(step.targetIds ?? []).length > 0 && (
                                  <div className="flow-targets">
                                    {step.targetIds.map(target => (
                                      <code key={target}>{target}</code>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                        {!steps.length && (
                          <p className="flow-empty">
                            This reviewed flow has no stored steps yet.
                          </p>
                        )}
                      </section>
                    )
                  })
                ) : (
                  <p className="flow-empty">
                    No reviewed flow is attached to this requirement yet. AI
                    proposals remain in the review queue until confirmed.
                  </p>
                )}
              </details>
              {findings.length > 0 && (
                <div className="requirement-findings">
                  {findings.map(finding => (
                    <details key={finding.id}>
                      <summary>
                        <span
                          className={`severity severity-${finding.severity}`}
                        >
                          {finding.severity}
                        </span>
                        {finding.title}
                      </summary>
                      <p>{finding.detail}</p>
                      <small>
                        {finding.evidenceStrength ?? 'unknown'} evidence
                        {finding.confidence !== undefined
                          ? ` · ${Math.round(finding.confidence * 100)}% confidence`
                          : ''}{' '}
                        · policy {finding.policyVersion ?? 'unknown'} · schema{' '}
                        {finding.schemaVersion ?? 'unknown'} · source{' '}
                        {finding.sourceRevision ?? 'catalog'} ·{' '}
                        {finding.generatedAt
                          ? new Date(finding.generatedAt).toLocaleString()
                          : 'pending projection'}
                      </small>
                      {(finding.sourcePassages?.length ?? 0) > 0 && (
                        <div className="finding-passages">
                          <b>Conflicting or incomplete source</b>
                          {finding.sourcePassages?.map((passage, index) => (
                            <blockquote key={`${finding.id}:passage:${index}`}>
                              “{passage}”
                            </blockquote>
                          ))}
                        </div>
                      )}
                      {((finding.affectedFlowIds?.length ?? 0) > 0 ||
                        (finding.affectedTargetIds?.length ?? 0) > 0) && (
                        <div className="finding-impact">
                          <b>Affected graph</b>
                          {finding.affectedFlowIds?.map(id => (
                            <code key={id}>{id}</code>
                          ))}
                          {finding.affectedTargetIds?.map(id => (
                            <code key={id}>{id}</code>
                          ))}
                        </div>
                      )}
                      {finding.remediation && (
                        <p className="finding-remediation">
                          <b>Next:</b> {finding.remediation}
                        </p>
                      )}
                      {(finding.remediationOptions?.length ?? 0) > 0 && (
                        <div
                          className="remediation-options"
                          aria-label="Remediation choices"
                        >
                          {finding.remediationOptions?.map(option => (
                            <span key={option}>{option}</span>
                          ))}
                        </div>
                      )}
                      {(finding.evidence?.length ?? 0) > 0 && (
                        <code>{finding.evidence?.join(' · ')}</code>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}

function Operations({ data }: { data: Portfolio }) {
  const failed = data.repositories.filter(
    item => item.lastScanStatus === 'failed'
  )
  const active = data.repositories.filter(
    item =>
      item.lastScanStatus === 'queued' || item.lastScanStatus === 'running'
  )
  const parserErrors = data.diagnostics.filter(
    item => item.severity === 'error'
  )
  return (
    <>
      <PageHeading
        eyebrow="Runtime control"
        title="Operations"
        detail="Inspect scan freshness, parser failures, and asynchronous workflow recovery signals."
        action={
          <div className="header-badge">
            <Activity /> live catalog
          </div>
        }
      />
      <section className="stats-grid compact-stats">
        <Stat
          label="Active scans"
          value={active.length}
          detail="queued or running"
        />
        <Stat
          label="Failed scans"
          value={failed.length}
          detail="safe retry from repository inventory"
          tone={failed.length ? 'danger' : 'neutral'}
        />
        <Stat
          label="Parser errors"
          value={parserErrors.length}
          detail="from the latest revision"
          tone={parserErrors.length ? 'danger' : 'neutral'}
        />
        <Stat
          label="Jira sources"
          value={data.requirements.length}
          detail="requirements currently indexed"
        />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Workflow health</p>
            <h2>Source and parser diagnostics</h2>
          </div>
        </div>
        {data.repositories.map(repository => {
          const diagnostics = data.diagnostics.filter(
            item => item.repositoryId === repository.id
          )
          return (
            <article className="finding-row" key={repository.id}>
              <GitBranch size={17} />
              <div>
                <strong>
                  {repository.name} · {repository.lastScanStatus}
                </strong>
                <small>
                  {repository.lastScanRevision?.slice(0, 12) ??
                    'No completed revision'}{' '}
                  ·{' '}
                  {repository.lastScanAt
                    ? new Date(repository.lastScanAt).toLocaleString()
                    : 'not scanned'}
                </small>
                {diagnostics.length ? (
                  <p>
                    {diagnostics.length} parser diagnostics:{' '}
                    {diagnostics.map(item => item.code).join(', ')}
                  </p>
                ) : (
                  <p>No parser diagnostics in the latest scan.</p>
                )}
              </div>
            </article>
          )
        })}
      </section>
    </>
  )
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function FlowReviewDetail({
  data,
  requirement,
  payload,
  evidence,
}: {
  data: Portfolio
  requirement: Portfolio['requirements'][number] | undefined
  payload: Record<string, unknown>
  evidence: string[]
}) {
  const flow = payload as unknown as Partial<Flow>
  const steps = Array.isArray(flow.steps) ? flow.steps : []
  const targetName = (targetId: string) => {
    const operation = data.operations.find(item => item.id === targetId)
    if (operation) return `${operation.method.toUpperCase()} ${operation.path}`
    const surface = data.surfaces.find(item => item.id === targetId)
    if (surface) return `${surface.kind}: ${surface.name}`
    return targetId.startsWith('criterion:')
      ? `Jira criterion: ${targetId.slice('criterion:'.length)}`
      : targetId
  }
  const suggestedTests = requirement
    ? data.suggestions.filter(
        item =>
          item.requirementId === requirement.id && item.type === 'expected-test'
      )
    : []
  const analysis =
    payload.analysis && typeof payload.analysis === 'object'
      ? (payload.analysis as Record<string, unknown>)
      : undefined
  return (
    <div className="flow-review-detail">
      <section className="jira-source-panel" aria-label="Jira source">
        <div className="flow-panel-label">
          <BookOpen size={14} /> Jira source
        </div>
        <strong>
          {requirement?.jiraKey ?? 'Source unavailable'} ·{' '}
          {requirement?.updatedAt
            ? new Date(requirement.updatedAt).toLocaleString()
            : 'revision unavailable'}
        </strong>
        <p>
          {requirement?.description || 'No Jira description was synchronized.'}
        </p>
        <ol>
          {requirement?.acceptanceCriteria?.map(criterion => (
            <li key={criterion.fingerprint}>{criterion.text}</li>
          )) ?? <li>No acceptance criteria were synchronized.</li>}
        </ol>
        <small>
          Source revision:{' '}
          {requirement
            ? `${requirement.jiraKey}@${requirement.updatedAt}`
            : 'unknown'}
        </small>
      </section>
      <section className="flow-graph-panel" aria-label="Proposed flow graph">
        <div className="flow-panel-label">
          <Network size={14} /> Proposed flow graph
        </div>
        <div className="flow-context">
          <span>
            Actors: {stringList(flow.actors).join(' · ') || 'not inferred'}
          </span>
          {typeof flow.trigger === 'string' && (
            <span>Trigger: {flow.trigger}</span>
          )}
        </div>
        <ol className="flow-steps">
          {steps.map((step, index) => (
            <li key={step.id ?? index} className={`flow-step-${step.variant}`}>
              <b>{step.position ?? index + 1}</b>
              <div>
                <strong>{step.actor}</strong>
                <span>{step.action}</span>
                <small>Expected: {step.expectedOutcome}</small>
                {step.targetIds.length > 0 && (
                  <div className="flow-targets">
                    {step.targetIds.map(target => (
                      <code key={target}>{targetName(target)}</code>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!steps.length && (
          <p className="flow-empty">No structured steps were proposed.</p>
        )}
      </section>
      <section
        className="flow-provenance-panel"
        aria-label="Review evidence and provenance"
      >
        <div className="flow-panel-label">
          <Sparkles size={14} /> Evidence & provenance
        </div>
        <div className="flow-boundaries">
          {stringList(flow.preconditions).map(item => (
            <span key={`pre:${item}`}>Precondition: {item}</span>
          ))}
          {stringList(flow.authorizationBoundaries).map(item => (
            <span key={`auth:${item}`}>Authorization: {item}</span>
          ))}
          {stringList(flow.tenantBoundaries).map(item => (
            <span key={`tenant:${item}`}>Tenant: {item}</span>
          ))}
        </div>
        <div className="evidence-list">
          {evidence.map(item => (
            <blockquote key={item}>“{item}”</blockquote>
          ))}
        </div>
        <div className="suggested-test-list">
          <b>Suggested tests</b>
          {suggestedTests.length ? (
            suggestedTests.map(item => <span key={item.id}>{item.title}</span>)
          ) : (
            <span>No test proposals were generated for this revision.</span>
          )}
        </div>
        <small>
          Prompt {String(analysis?.promptVersion ?? 'unknown')} · schema{' '}
          {String(analysis?.schemaVersion ?? 'unknown')} · model{' '}
          {String(analysis?.model ?? 'unknown')} · unreviewed semantic evidence
        </small>
      </section>
    </div>
  )
}

function SuggestionActions({
  id,
  payload,
  onComplete,
}: {
  id: string
  payload: Record<string, unknown>
  onComplete: () => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [owner, setOwner] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [mergeIntoSuggestionId, setMergeIntoSuggestionId] = useState('')
  const [editedPayload, setEditedPayload] = useState(
    JSON.stringify(payload, null, 2)
  )
  const [error, setError] = useState('')
  async function submit(
    decision: 'confirm' | 'edit' | 'reject' | 'merge' | 'suppress'
  ) {
    setError('')
    try {
      const value: Record<string, unknown> = {
        decision,
        reason: reason || undefined,
      }
      if (decision === 'edit') value.editedPayload = JSON.parse(editedPayload)
      if (decision === 'merge')
        value.mergeIntoSuggestionId = mergeIntoSuggestionId
      // Assign the two suppression fields explicitly rather than spreading an
      // object into `value`: an Object.assign here is a mass-assignment shape
      // that grows silently if the source object ever gains fields.
      if (decision === 'suppress') {
        value.owner = owner
        value.expiresAt = expiresAt
      }
      await api.decideSuggestion(id, value)
      await onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div className="suggestion-actions">
      <div className="review-actions">
        <button className="reject-button" onClick={() => submit('reject')}>
          <X size={16} /> Reject
        </button>
        <button className="confirm-button" onClick={() => submit('confirm')}>
          <Check size={16} /> Confirm
        </button>
      </div>
      <details>
        <summary>Govern this proposal</summary>
        <label>
          Reason
          <input
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Required for suppression"
          />
        </label>
        <label>
          Edited payload
          <textarea
            value={editedPayload}
            onChange={event => setEditedPayload(event.target.value)}
          />
        </label>
        <button className="secondary-button" onClick={() => submit('edit')}>
          Save edit for review
        </button>
        <label>
          Merge into suggestion ID
          <input
            value={mergeIntoSuggestionId}
            onChange={event => setMergeIntoSuggestionId(event.target.value)}
            placeholder="Target proposal UUID"
          />
        </label>
        <button className="secondary-button" onClick={() => submit('merge')}>
          Merge and confirm
        </button>
        <label>
          Suppression owner
          <input
            value={owner}
            onChange={event => setOwner(event.target.value)}
            placeholder="Owning team"
          />
        </label>
        <label>
          Suppression expiry
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={event =>
              setExpiresAt(
                event.target.value
                  ? new Date(event.target.value).toISOString()
                  : ''
              )
            }
          />
        </label>
        <button className="reject-button" onClick={() => submit('suppress')}>
          Suppress with expiry
        </button>
        {error && <p className="form-error">{error}</p>}
      </details>
    </div>
  )
}

function ReviewQueue({
  data,
  reload,
}: {
  data: Portfolio
  reload: () => Promise<void>
}) {
  const proposals = data.suggestions.filter(item => item.state === 'proposed')
  return (
    <>
      <PageHeading
        eyebrow="Human-in-the-loop"
        title="AI review queue"
        detail="Review Jira source, the proposed graph, candidates, and provenance before a semantic proposal can affect coverage."
      />
      <div className="review-list">
        {proposals.map(item => {
          const requirement = data.requirements.find(
            req => req.id === item.requirementId
          )
          const payload = item.payload ?? {}
          return (
            <article className="review-card" key={item.id}>
              <div className="confidence">
                <Sparkles />
                <strong>{Math.round(item.confidence * 100)}%</strong>
                <span>confidence</span>
              </div>
              <div className="review-body">
                <div className="review-context">
                  <span>{requirement?.jiraKey ?? 'Unknown story'}</span>
                  <ChevronRight size={14} />
                  <span>{item.type}</span>
                </div>
                <h3>{item.title}</h3>
                {item.type === 'flow' ? (
                  <FlowReviewDetail
                    data={data}
                    requirement={requirement}
                    payload={payload}
                    evidence={item.evidence}
                  />
                ) : (
                  <>
                    <div className="evidence-list">
                      {item.evidence.map(evidence => (
                        <blockquote key={evidence}>“{evidence}”</blockquote>
                      ))}
                    </div>
                    <small className="review-source-revision">
                      Source revision:{' '}
                      {requirement
                        ? `${requirement.jiraKey}@${requirement.updatedAt}`
                        : 'unknown'}
                    </small>
                  </>
                )}
              </div>
              <SuggestionActions
                id={item.id}
                payload={payload}
                onComplete={reload}
              />
            </article>
          )
        })}
        {!proposals.length && (
          <div className="empty-state roomy">
            <ShieldCheck />
            <strong>Review queue cleared</strong>
            <span>New semantic proposals will appear after Jira analysis.</span>
          </div>
        )}
      </div>
    </>
  )
}

function RepositoryAdministrationCard({
  repository,
  reload,
}: {
  repository: Repository
  reload: () => Promise<void>
}) {
  const [team, setTeam] = useState(repository.ownership?.team ?? '')
  const [contact, setContact] = useState(repository.ownership?.contact ?? '')
  const [jiraProject, setJiraProject] = useState(
    repository.jiraBindings[0]?.project ?? ''
  )
  const [jiraComponent, setJiraComponent] = useState(
    repository.jiraBindings[0]?.component ?? ''
  )
  const [storybookBaseUrl, setStorybookBaseUrl] = useState(
    repository.storybookBaseUrl ?? ''
  )
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  async function save() {
    setBusy(true)
    setSaved(false)
    try {
      await api.updateRepositoryAdministration(repository.id, {
        ownership: team ? { team, contact: contact || undefined } : undefined,
        jiraBindings: jiraProject
          ? [
              {
                project: jiraProject.toUpperCase(),
                component: jiraComponent || undefined,
              },
            ]
          : [],
        storybookBaseUrl: storybookBaseUrl || undefined,
      })
      setSaved(true)
      await reload()
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="repository-admin-card">
      <div className="repository-admin-title">
        <div className="repo-mark">
          {repository.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <strong>{repository.name}</strong>
          <small>{repository.owner}</small>
        </div>
        {saved && <span>Saved</span>}
      </div>
      <div className="repository-admin-fields">
        <label>
          Owning team
          <input
            value={team}
            onChange={event => setTeam(event.target.value)}
            placeholder="Platform"
          />
        </label>
        <label>
          Owner contact
          <input
            value={contact}
            onChange={event => setContact(event.target.value)}
            type="email"
            placeholder="team@example.com"
          />
        </label>
        <label>
          Jira project
          <input
            value={jiraProject}
            onChange={event => setJiraProject(event.target.value)}
            placeholder="FQ"
          />
        </label>
        <label>
          Jira component
          <input
            value={jiraComponent}
            onChange={event => setJiraComponent(event.target.value)}
            placeholder="Catalog"
          />
        </label>
        <label className="wide-field">
          Storybook URL
          <input
            value={storybookBaseUrl}
            onChange={event => setStorybookBaseUrl(event.target.value)}
            type="url"
            placeholder="https://storybook.example.com"
          />
        </label>
      </div>
      <button className="secondary-button" disabled={busy} onClick={save}>
        <Save size={14} /> {busy ? 'Saving…' : 'Save bindings'}
      </button>
    </article>
  )
}

function OrganizationSettings({
  data,
  reload,
}: {
  data: Portfolio
  reload: () => Promise<void>
}) {
  const roles: OrganizationRole[] = ['owner', 'admin', 'member', 'viewer']
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrganizationRole>('member')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function loadMembers() {
    setLoading(true)
    try {
      const result = await api.organizationMembers()
      setMembers(
        Array.isArray(result) ? result : (result.items ?? result.members ?? [])
      )
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void loadMembers()
  }, [])
  async function invite(event: FormEvent) {
    event.preventDefault()
    await api.inviteOrganizationMember(email, role)
    setEmail('')
    await loadMembers()
  }
  async function updateRole(
    member: OrganizationMember,
    nextRole: OrganizationRole
  ) {
    await api.updateOrganizationMember(member.id, nextRole)
    await loadMembers()
  }
  async function remove(member: OrganizationMember) {
    if (
      !window.confirm(
        `Remove ${member.email ?? member.name ?? member.id} from this organization?`
      )
    )
      return
    await api.removeOrganizationMember(member.id)
    await loadMembers()
  }
  return (
    <>
      <PageHeading
        eyebrow="Tenant administration"
        title="Organization access & integrations"
        detail="Membership delegates to FuzeFront security. FuzeQuality owns only QA repository ownership and integration bindings."
      />
      <section className="organization-settings-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">FuzeFront security</p>
              <h2>Members & roles</h2>
            </div>
            <span className="header-badge">
              <Users /> {members.length}
            </span>
          </div>
          <form className="member-invite" onSubmit={invite}>
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
            />
            <select
              value={role}
              onChange={event =>
                setRole(event.target.value as OrganizationRole)
              }
            >
              {roles.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <button className="primary-button">
              <UserPlus size={15} /> Invite
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="member-list">
            {members.map(member => (
              <div className="member-row" key={member.id}>
                <div>
                  <strong>
                    {member.displayName ??
                      member.name ??
                      member.email ??
                      member.userId ??
                      member.user_id ??
                      member.id}
                  </strong>
                  <small>
                    {member.email ?? member.status ?? 'Active member'}
                  </small>
                </div>
                <select
                  value={member.role}
                  onChange={event =>
                    updateRole(member, event.target.value as OrganizationRole)
                  }
                >
                  {roles.map(item => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <button
                  className="icon-button danger-button"
                  onClick={() => remove(member)}
                  aria-label="Remove member"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!loading && !members.length && (
              <div className="empty-state">
                <Users />
                <strong>No members returned</strong>
                <span>
                  Membership remains authoritative in FuzeFront security.
                </span>
              </div>
            )}
            {loading && (
              <div className="loading-row">
                <RefreshCw className="spin" size={15} /> Loading members…
              </div>
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">QA source ownership</p>
              <h2>Repositories & bindings</h2>
            </div>
            <span className="header-badge">
              <GitBranch /> {data.repositories.length}
            </span>
          </div>
          <div className="repository-admin-list">
            {data.repositories.map(repository => (
              <RepositoryAdministrationCard
                key={repository.id}
                repository={repository}
                reload={reload}
              />
            ))}
          </div>
        </article>
      </section>
    </>
  )
}

function OrganizationAdministration({
  organizations,
}: {
  organizations: OrganizationQualitySummary[]
}) {
  const [query, setQuery] = useState('')
  const [context, setContext] = useState<AdminTenantContext>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const visible = organizations.filter(item =>
    item.organizationId.toLowerCase().includes(query.toLowerCase())
  )
  async function enter(organizationId: string) {
    setBusy(organizationId)
    setError('')
    try {
      setContext(
        await api.enterOrganizationContext(
          organizationId,
          'Platform QA portfolio review'
        )
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }
  const contextSummary = context
    ? coverageSummary(context.portfolio.expectations)
    : undefined
  return (
    <>
      {context && (
        <div className="tenant-context-banner" role="status">
          <LockKeyhole size={17} />
          <div>
            <strong>Read-only organization context</strong>
            <span>
              {context.organizationId} · audited as{' '}
              {context.auditId.slice(0, 8)}
            </span>
          </div>
          <button
            className="secondary-button"
            onClick={() => setContext(undefined)}
          >
            <LogOut size={15} /> Exit context
          </button>
        </div>
      )}
      <PageHeading
        eyebrow="Platform administration"
        title={
          context
            ? `Organization ${context.organizationId}`
            : 'Organization QA portfolio'
        }
        detail={
          context
            ? 'This audited context exposes QA evidence only. Repository, integration, and review mutations remain unavailable.'
            : 'Compare inventory freshness, coverage, gaps, and scan health across organizations.'
        }
        action={
          <div className="header-badge">
            <Building2 /> {organizations.length} organizations
          </div>
        }
      />
      {error && (
        <div className="error-banner">
          <AlertTriangle />
          <div>
            <strong>Organization context unavailable</strong>
            <span>{error}</span>
          </div>
        </div>
      )}
      {context && contextSummary ? (
        <section
          className="stats-grid"
          aria-label="Selected organization totals"
        >
          <Stat
            label="Repositories"
            value={context.portfolio.repositories.length}
            detail="read-only sources"
          />
          <Stat
            label="API operations"
            value={context.portfolio.operations.length}
            detail="cataloged contracts"
          />
          <Stat
            label="Frontend surfaces"
            value={context.portfolio.surfaces.length}
            detail="routes and components"
          />
          <Stat
            label="Coverage"
            value={`${contextSummary.percent}%`}
            detail={`${contextSummary.gaps} gaps`}
            tone={contextSummary.gaps ? 'danger' : 'neutral'}
          />
        </section>
      ) : (
        <>
          <div className="filter-bar">
            <Search size={16} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Filter organizations…"
            />
            <span>{visible.length} shown</span>
          </div>
          <div className="organization-table">
            <div className="organization-table-head">
              <span>Organization</span>
              <span>Inventory</span>
              <span>Coverage</span>
              <span>Risk</span>
              <span />
            </div>
            {visible.map(item => (
              <article key={item.organizationId}>
                <div>
                  <strong>{item.organizationId}</strong>
                  <small>
                    {item.latestScanAt
                      ? `Latest scan ${new Date(item.latestScanAt).toLocaleString()}`
                      : 'No completed scan'}
                  </small>
                </div>
                <div>
                  <b>{item.repositories}</b>
                  <small>
                    {item.apiOperations} APIs · {item.frontendSurfaces} UI ·{' '}
                    {item.tests} tests
                  </small>
                </div>
                <div>
                  <b>{item.coveragePercent}%</b>
                  <small>
                    {item.coveredExpectations} / {item.expectations}{' '}
                    expectations
                  </small>
                </div>
                <div
                  className={
                    item.gaps || item.failedScans ? 'organization-risk' : ''
                  }
                >
                  <b>{item.gaps} gaps</b>
                  <small>
                    {item.openFindings} findings · {item.failedScans} failed ·{' '}
                    {item.staleScans} stale
                  </small>
                </div>
                <button
                  className="secondary-button"
                  disabled={busy === item.organizationId}
                  onClick={() => enter(item.organizationId)}
                >
                  <LockKeyhole size={14} /> Review
                </button>
              </article>
            ))}
            {!visible.length && (
              <div className="empty-state">
                <Building2 />
                <strong>No organizations match</strong>
                <span>Adjust the filter or onboard a tenant repository.</span>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function FlowReviewHistory({
  flow,
}: {
  flow: RepositoryFlowCandidate
}) {
  const [history, setHistory] = useState<RepositoryFlowReviewHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const historyRequestInFlight = useRef(false)

  const loadHistory = useCallback(async (cursor?: string) => {
    if (historyRequestInFlight.current) return
    historyRequestInFlight.current = true
    setLoading(true)
    setError(undefined)
    try {
      const page = normalizeHistoryPage(
        await api.repositoryFlowReviewHistory(flow.repositoryId, flow.id, cursor)
      )
      setHistory(current => cursor
        ? [...new Map([...current, ...page.items].map(entry => [entry.id, entry])).values()]
        : page.items)
      setNextCursor(page.page.nextCursor)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load review history'
      )
    } finally {
      historyRequestInFlight.current = false
      setLoading(false)
    }
  }, [flow.id, flow.repositoryId])

  useEffect(() => {
    setHistory([])
    setNextCursor(null)
    setError(undefined)
    if (detailsRef.current?.open) void loadHistory()
  }, [flow.id, flow.reviewedAt, loadHistory])

  return (
    <details
      ref={detailsRef}
      className="policy-review-history"
      onToggle={event => {
        if (event.currentTarget.open && !history.length && !loading)
          void loadHistory()
      }}
    >
      <summary>UX flow review history</summary>
      <small>Recorded decisions are immutable.</small>
      {loading ? (
        <small>Loading decisions…</small>
      ) : error ? (
        <small className="policy-review-error">{error}</small>
      ) : history.length ? (
        <>
          <ol>
          {history.map(entry => (
            <li key={entry.id}>
              <span
                className={`status-pill severity-${entry.status === 'confirmed' ? 'low' : 'medium'}`}
              >
                {entry.status}
              </span>
              <strong>{entry.reviewedBy}</strong>
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
          </ol>
          {nextCursor && (
            <QualityAction
              intent="quiet"
              disabled={loading}
              onClick={() => void loadHistory(nextCursor)}
            >
              <ChevronRight size={14} /> Load more UX flow decisions
            </QualityAction>
          )}
        </>
      ) : (
        <small>No review decisions recorded.</small>
      )}
    </details>
  )
}

function FlowReviewControls({
  flow,
  currentRevision,
  onReview,
}: {
  flow: RepositoryFlowCandidate
  currentRevision?: string
  onReview: (
    flow: RepositoryFlowCandidate,
    status: 'confirmed' | 'rejected',
    reason?: string
  ) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [stale, setStale] = useState(false)
  const isCurrentRevision = Boolean(
    currentRevision && flow.revision === currentRevision
  )
  const isReviewable = isCurrentRevision && !stale

  useEffect(() => {
    setStale(false)
    setError(undefined)
  }, [flow.id, flow.revision])

  const submit = async (status: 'confirmed' | 'rejected') => {
    setBusy(true)
    setError(undefined)
    try {
      await onReview(flow, status, reason.trim() || undefined)
      setReason('')
    } catch (cause) {
      if (cause instanceof CatalogApiError && cause.code === 'STALE_FLOW_CANDIDATE') {
        setStale(true)
      }
      setError(cause instanceof Error ? cause.message : 'Unable to save review')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {flow.reviewedAt && (
        <div className="flow-current-review" aria-label="Current UX flow review">
          <strong>{flow.status}</strong>
          <span>
            Reviewed {new Date(flow.reviewedAt).toLocaleString()}
            {flow.reviewedBy ? ` by ${flow.reviewedBy}` : ''}
          </span>
          {flow.reviewReason && <p>{flow.reviewReason}</p>}
        </div>
      )}
      {flow.status === 'proposed' && (
        <div className="flow-review-controls">
          {!isCurrentRevision && (
            <p className="form-error" role="status">
              Historical proposal — review is locked until repository analysis
              produces a candidate for the current revision.
            </p>
          )}
          <label>
            Optional review rationale
            <input
              value={reason}
              disabled={!isReviewable || busy}
              onChange={event => setReason(event.target.value)}
              placeholder="Why is this flow accurate or unsuitable?"
            />
          </label>
          <div className="row-actions">
            <QualityAction
              intent="secondary"
              disabled={busy || !isReviewable}
              onClick={() => void submit('confirmed')}
            >
              <Check size={14} /> Confirm
            </QualityAction>
            <QualityAction
              intent="danger"
              disabled={busy || !isReviewable}
              onClick={() => void submit('rejected')}
            >
              <X size={14} /> Reject
            </QualityAction>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <FlowReviewHistory flow={flow} />
    </>
  )
}

function PolicyGateReviewHistory({
  evaluation,
}: {
  evaluation: PolicyGateEvaluation
}) {
  const [history, setHistory] = useState<PolicyGateReviewHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const historyRequestInFlight = useRef(false)

  const loadHistory = useCallback(async (cursor?: string) => {
    if (historyRequestInFlight.current) return
    historyRequestInFlight.current = true
    setLoading(true)
    setError(undefined)
    try {
      const page = normalizeHistoryPage(
        await api.policyGateReviewHistory(
          evaluation.repositoryId,
          evaluation.id,
          cursor
        )
      )
      setHistory(current => cursor
        ? [...new Map([...current, ...page.items].map(entry => [entry.id, entry])).values()]
        : page.items)
      setNextCursor(page.page.nextCursor)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load review history'
      )
    } finally {
      historyRequestInFlight.current = false
      setLoading(false)
    }
  }, [evaluation.id, evaluation.repositoryId])

  useEffect(() => {
    setHistory([])
    setNextCursor(null)
    setError(undefined)
    if (detailsRef.current?.open) void loadHistory()
  }, [evaluation.id, evaluation.reviewedAt, loadHistory])

  return (
    <details
      ref={detailsRef}
      className="policy-review-history"
      onToggle={event => {
        if (event.currentTarget.open && !history.length && !loading)
          void loadHistory()
      }}
    >
      <summary>Review history</summary>
      {loading ? (
        <small>Loading decisions…</small>
      ) : error ? (
        <small className="policy-review-error">{error}</small>
      ) : history.length ? (
        <>
          <ol>
          {history.map(entry => (
            <li key={entry.id}>
              <span
                className={`status-pill severity-${entry.status === 'accepted' ? 'low' : 'medium'}`}
              >
                {entry.status}
              </span>
              <strong>{entry.reviewedBy}</strong>
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
          </ol>
          {nextCursor && (
            <QualityAction
              intent="quiet"
              disabled={loading}
              onClick={() => void loadHistory(nextCursor)}
            >
              <ChevronRight size={14} /> Load more governance decisions
            </QualityAction>
          )}
        </>
      ) : (
        <small>No review decisions recorded.</small>
      )}
    </details>
  )
}

function PolicyGateReviewControls({
  evaluation,
  currentRevision,
  onReview,
}: {
  evaluation: PolicyGateEvaluation
  currentRevision?: string
  onReview: (
    evaluation: PolicyGateEvaluation,
    status: 'accepted' | 'dismissed',
    reason?: string
  ) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [stale, setStale] = useState(false)
  const isCurrentRevision = Boolean(
    currentRevision && evaluation.revision === currentRevision
  )
  const isReviewable = isCurrentRevision && !stale

  useEffect(() => {
    setStale(false)
    setError(undefined)
  }, [evaluation.id, evaluation.revision])

  const submit = async (status: 'accepted' | 'dismissed') => {
    setBusy(true)
    setError(undefined)
    try {
      await onReview(evaluation, status, reason.trim() || undefined)
      setReason('')
    } catch (cause) {
      if (
        cause instanceof CatalogApiError &&
        cause.code === 'STALE_POLICY_GATE_EVALUATION'
      ) {
        setStale(true)
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to save the governance review'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {evaluation.reviewStatus === 'proposed' && (
        <div className="flow-review-controls">
          {!isCurrentRevision && (
            <p className="form-error" role="status">
              Historical governance finding — review is locked until repository
              analysis produces a finding for the current revision.
            </p>
          )}
          <label>
            Optional governance rationale
            <input
              value={reason}
              disabled={!isReviewable || busy}
              onChange={event => setReason(event.target.value)}
              placeholder="Why should this recommendation be accepted or dismissed?"
            />
          </label>
          <div className="row-actions">
            <QualityAction
              intent="secondary"
              disabled={busy || !isReviewable}
              onClick={() => void submit('accepted')}
            >
              <Check size={14} /> Accept recommendation
            </QualityAction>
            <QualityAction
              intent="danger"
              disabled={busy || !isReviewable}
              onClick={() => void submit('dismissed')}
            >
              <X size={14} /> Dismiss
            </QualityAction>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <PolicyGateReviewHistory evaluation={evaluation} />
    </>
  )
}

type FlowInventorySelection = {
  repositoryId: string
  source: RepositoryFlowCandidate['source'] | ''
  status: RepositoryFlowCandidate['status'] | ''
  revisionScope: FlowRevisionScope
  model: string
  promptVersion: string
  schemaVersion: string
}

type PolicyGateInventorySelection = {
  kind: PolicyGateEvaluation['kind'] | ''
  severity: PolicyGateEvaluation['severity'] | ''
  reviewStatus: PolicyGateEvaluation['reviewStatus'] | ''
  revisionScope: FlowRevisionScope
}

type HistoryPage<T> = { items: T[]; page: { nextCursor: string | null; hasMore: boolean } }

export function normalizeHistoryPage<T>(value: T[] | HistoryPage<T>): HistoryPage<T> {
  return Array.isArray(value)
    ? { items: value, page: { nextCursor: null, hasMore: false } }
    : value
}

export function policyGateEvaluationMatchesInventory(
  evaluation: PolicyGateEvaluation,
  repositories: Repository[],
  selection: PolicyGateInventorySelection
) {
  if (selection.kind && evaluation.kind !== selection.kind) return false
  if (selection.severity && evaluation.severity !== selection.severity)
    return false
  if (
    selection.reviewStatus &&
    evaluation.reviewStatus !== selection.reviewStatus
  )
    return false
  if (selection.revisionScope === 'current') {
    const repository = repositories.find(
      item => item.id === evaluation.repositoryId
    )
    return Boolean(
      repository?.lastScanRevision &&
        evaluation.revision === repository.lastScanRevision
    )
  }
  return true
}

export function mergePolicyGateContinuation(
  current: PolicyGateEvaluation[],
  continued: PolicyGateEvaluation[],
  visibleAtRequestStart: ReadonlySet<string>,
) {
  const merged = new Map(current.map(evaluation => [evaluation.id, evaluation]))
  for (const evaluation of continued) {
    if (merged.has(evaluation.id)) continue
    // A row visible when pagination started but absent now was reviewed out of
    // the active filter. Do not resurrect its stale pre-review representation.
    if (visibleAtRequestStart.has(evaluation.id)) continue
    merged.set(evaluation.id, evaluation)
  }
  return [...merged.values()]
}

export function flowCandidateMatchesInventory(
  flow: RepositoryFlowCandidate,
  repositories: Repository[],
  selection: FlowInventorySelection
) {
  if (selection.repositoryId && flow.repositoryId !== selection.repositoryId)
    return false
  if (selection.source && flow.source !== selection.source) return false
  if (selection.status && flow.status !== selection.status) return false
  if (selection.model && flow.analysis?.model !== selection.model) return false
  if (
    selection.promptVersion &&
    flow.analysis?.promptVersion !== selection.promptVersion
  )
    return false
  if (
    selection.schemaVersion &&
    flow.analysis?.schemaVersion !== selection.schemaVersion
  )
    return false
  if (selection.revisionScope === 'current') {
    const repository = repositories.find(item => item.id === flow.repositoryId)
    return Boolean(
      repository?.lastScanRevision &&
        flow.revision === repository.lastScanRevision
    )
  }
  return true
}

export function RepositoryIntelligence({ data }: { data: Portfolio }) {
  const [artifacts, setArtifacts] = useState<QualityArtifact[]>([])
  const [artifactNextCursors, setArtifactNextCursors] = useState<Record<string, string>>({})
  const [loadingMoreArtifacts, setLoadingMoreArtifacts] = useState(false)
  const [artifactPaginationError, setArtifactPaginationError] = useState<string>()
  const [repositoryArtifactFailures, setRepositoryArtifactFailures] = useState<string[]>([])
  const [repositoryGovernanceFailures, setRepositoryGovernanceFailures] = useState<string[]>([])
  const [repositoryFlowFailures, setRepositoryFlowFailures] = useState<string[]>([])
  const [governanceEvidenceFailures, setGovernanceEvidenceFailures] = useState<string[]>([])
  const [governanceEvidenceArtifacts, setGovernanceEvidenceArtifacts] = useState<QualityArtifact[]>([])
  const [omittedGovernanceEvidenceRevisions, setOmittedGovernanceEvidenceRevisions] = useState(0)
  const [flowEvidenceArtifacts, setFlowEvidenceArtifacts] = useState<QualityArtifact[]>([])
  const [omittedFlowEvidenceRevisions, setOmittedFlowEvidenceRevisions] = useState(0)
  const [flowCandidates, setFlowCandidates] = useState<
    RepositoryFlowCandidate[]
  >([])
  const [flowNextCursors, setFlowNextCursors] = useState<Record<string, string>>({})
  const [loadingMoreFlows, setLoadingMoreFlows] = useState(false)
  const [flowRepositoryId, setFlowRepositoryId] = useState('')
  const [flowSource, setFlowSource] = useState<RepositoryFlowCandidate['source'] | ''>('')
  const [flowStatus, setFlowStatus] = useState<RepositoryFlowCandidate['status'] | ''>('')
  const [flowRevisionScope, setFlowRevisionScope] = useState<FlowRevisionScope>('all')
  const [flowModel, setFlowModel] = useState('')
  const [flowPromptVersion, setFlowPromptVersion] = useState('')
  const [flowSchemaVersion, setFlowSchemaVersion] = useState('')
  const [flowInspectorOpen, setFlowInspectorOpen] = useState(false)
  const [inspectedFlow, setInspectedFlow] = useState<RepositoryFlowCandidate>()
  const [flowInspectorLoading, setFlowInspectorLoading] = useState(false)
  const [flowInspectorError, setFlowInspectorError] = useState<string>()
  const flowInspectorRequest = useRef(0)
  const [policyGateEvaluations, setPolicyGateEvaluations] = useState<
    PolicyGateEvaluation[]
  >([])
  const policyGateEvaluationsRef = useRef(policyGateEvaluations)
  policyGateEvaluationsRef.current = policyGateEvaluations
  const [policyGateNextCursors, setPolicyGateNextCursors] = useState<Record<string, string>>({})
  const [loadingMorePolicyGates, setLoadingMorePolicyGates] = useState(false)
  const [historyPaginationError, setHistoryPaginationError] = useState<string>()
  const [executions, setExecutions] = useState<TestExecution[]>([])
  const [executionTrends, setExecutionTrends] = useState<ExecutionOutcomeTrend[][]>([])
  const [executionTrendNextCursors, setExecutionTrendNextCursors] = useState<Record<string, string>>({})
  const [loadingMoreExecutionTrend, setLoadingMoreExecutionTrend] = useState(false)
  const [executionTrendPaginationError, setExecutionTrendPaginationError] = useState<string>()
  const [executionNextCursors, setExecutionNextCursors] = useState<Record<string, string>>({})
  const [loadingMoreExecutions, setLoadingMoreExecutions] = useState(false)
  const [executionPaginationError, setExecutionPaginationError] = useState<string>()
  const [executionHistoryFailures, setExecutionHistoryFailures] = useState<string[]>([])
  const [executionTrendFailures, setExecutionTrendFailures] = useState<string[]>([])
  const [performanceExecutions, setPerformanceExecutions] = useState<TestExecution[]>([])
  const [performanceEvidenceFailures, setPerformanceEvidenceFailures] = useState<string[]>([])
  const [integrationExecutions, setIntegrationExecutions] = useState<TestExecution[]>([])
  const [integrationEvidenceFailures, setIntegrationEvidenceFailures] = useState<string[]>([])
  const [postProductionExecutions, setPostProductionExecutions] = useState<TestExecution[]>([])
  const [postProductionEvidenceFailures, setPostProductionEvidenceFailures] = useState<string[]>([])
  const [executionPerformance, setExecutionPerformance] = useState<
    PolicyGatePerformance[]
  >([])
  const [performanceNextCursors, setPerformanceNextCursors] = useState<Record<string, string>>({})
  const [loadingMorePerformance, setLoadingMorePerformance] = useState(false)
  const [performancePaginationError, setPerformancePaginationError] = useState<string>()
  const [executionPerformanceFailures, setExecutionPerformanceFailures] = useState<string[]>([])
  const [executionRepositoryId, setExecutionRepositoryId] = useState('')
  const [executionKind, setExecutionKind] = useState<
    TestExecution['kind'] | ''
  >('')
  const [executionStatus, setExecutionStatus] = useState<
    TestExecution['status'] | ''
  >('')
  const [executionProvider, setExecutionProvider] = useState<
    TestExecution['provider'] | ''
  >('')
  const [executionAttemptScope, setExecutionAttemptScope] = useState<
    'initial' | 'retry' | 'recovered' | ''
  >('')
  const [executionRevision, setExecutionRevision] = useState('')
  const [executionWorkflowPath, setExecutionWorkflowPath] = useState('')
  const [executionMinimumDurationSeconds, setExecutionMinimumDurationSeconds] = useState('')
  const [executionMaximumDurationSeconds, setExecutionMaximumDurationSeconds] = useState('')
  const [executionFrom, setExecutionFrom] = useState('')
  const [executionUntil, setExecutionUntil] = useState('')
  const invalidExecutionRange = Boolean(
    executionFrom &&
    executionUntil &&
    Date.parse(executionFrom) > Date.parse(executionUntil)
  )
  const invalidExecutionDurationRange = Boolean(
    executionMinimumDurationSeconds !== '' &&
    executionMaximumDurationSeconds !== '' &&
    Number(executionMinimumDurationSeconds) > Number(executionMaximumDurationSeconds)
  )
  const [policyGateKind, setPolicyGateKind] = useState<
    PolicyGateEvaluation['kind'] | ''
  >('')
  const [policyGateSeverity, setPolicyGateSeverity] = useState<
    PolicyGateEvaluation['severity'] | ''
  >('')
  const [policyGateReviewStatus, setPolicyGateReviewStatus] = useState<
    PolicyGateEvaluation['reviewStatus'] | ''
  >('')
  const [policyGateRevisionScope, setPolicyGateRevisionScope] =
    useState<FlowRevisionScope>('current')
  const policyGateSelection: PolicyGateInventorySelection = {
    kind: policyGateKind,
    severity: policyGateSeverity,
    reviewStatus: policyGateReviewStatus,
    revisionScope: policyGateRevisionScope,
  }
  const policyGateSelectionRef = useRef(policyGateSelection)
  policyGateSelectionRef.current = policyGateSelection
  const policyGateHistoryQuery = JSON.stringify([
    data.repositories.map(repository => [repository.id, repository.lastScanRevision ?? '']),
    policyGateSelection,
  ])
  const policyGateHistoryQueryRef = useRef(policyGateHistoryQuery)
  policyGateHistoryQueryRef.current = policyGateHistoryQuery
  const [dispatchingArtifact, setDispatchingArtifact] = useState<string>()
  const [performanceDispatch, setPerformanceDispatch] = useState<{
    artifactId: string
    state: 'success' | 'error'
    message: string
  }>()
  const [loadingArtifacts, setLoadingArtifacts] = useState(true)
  const [loadingFlows, setLoadingFlows] = useState(true)
  const [loadedFlowQuery, setLoadedFlowQuery] = useState('')
  const flowSelection: FlowInventorySelection = {
    repositoryId: flowRepositoryId,
    source: flowSource,
    status: flowStatus,
    revisionScope: flowRevisionScope,
    model: flowModel.trim(),
    promptVersion: flowPromptVersion.trim(),
    schemaVersion: flowSchemaVersion.trim(),
  }
  const flowSelectionRef = useRef(flowSelection)
  flowSelectionRef.current = flowSelection
  const flowQuery = JSON.stringify([
    data.repositories.map(repository => [
      repository.id,
      repository.lastScanRevision ?? '',
    ]),
    flowRepositoryId,
    flowSource,
    flowStatus,
    flowRevisionScope,
    flowModel.trim(),
    flowPromptVersion.trim(),
    flowSchemaVersion.trim(),
  ])
  const flowResultsAreCurrent =
    !loadingFlows && loadedFlowQuery === flowQuery
  const inspectFlow = async (flow: RepositoryFlowCandidate) => {
    const request = ++flowInspectorRequest.current
    setFlowInspectorOpen(true)
    setInspectedFlow(undefined)
    setFlowInspectorError(undefined)
    setFlowInspectorLoading(true)
    try {
      const detail = await api.repositoryFlowCandidate(flow.repositoryId, flow.id)
      if (request === flowInspectorRequest.current) setInspectedFlow(detail)
    } catch (cause) {
      if (request === flowInspectorRequest.current) {
        setFlowInspectorError(
          cause instanceof Error ? cause.message : 'Unable to load UX flow detail'
        )
      }
    } finally {
      if (request === flowInspectorRequest.current) setFlowInspectorLoading(false)
    }
  }
  const closeFlowInspector = () => {
    flowInspectorRequest.current++
    setFlowInspectorOpen(false)
    setInspectedFlow(undefined)
    setFlowInspectorError(undefined)
    setFlowInspectorLoading(false)
  }
  const reviewFlow = async (
    flow: RepositoryFlowCandidate,
    status: 'confirmed' | 'rejected',
    reason?: string
  ) => {
    const reviewed = await api.reviewRepositoryFlowCandidate(
      flow.repositoryId,
      flow.id,
      status,
      reason
    )
    setFlowCandidates(current =>
      flowCandidateMatchesInventory(
        reviewed,
        data.repositories,
        flowSelectionRef.current
      )
        ? current.map(item => (item.id === reviewed.id ? reviewed : item))
        : current.filter(item => item.id !== reviewed.id)
    )
    setInspectedFlow(current => current?.id === reviewed.id ? reviewed : current)
  }
  const reviewPolicyGate = async (
    evaluation: PolicyGateEvaluation,
    status: 'accepted' | 'dismissed',
    reason?: string
  ) => {
    const reviewed = await api.reviewPolicyGateEvaluation(
      evaluation.repositoryId,
      evaluation.id,
      status,
      reason
    )
    setPolicyGateEvaluations(current =>
      policyGateEvaluationMatchesInventory(
        reviewed,
        data.repositories,
        policyGateSelectionRef.current
      )
        ? current.map(item => (item.id === reviewed.id ? reviewed : item))
        : current.filter(item => item.id !== reviewed.id)
    )
  }
  const runTestSuite = async (artifact: QualityArtifact) => {
    const repository = data.repositories.find(
      candidate => candidate.id === artifact.repositoryId
    )
    const sourceRevision = repository
      ? analyzedSourceRevision(repository)
      : undefined
    if (!sourceRevision) return
    if (
      !window.confirm(
        `Dispatch ${artifact.title} from ${repository?.defaultBranch ?? 'the analyzed branch'} at analyzed commit ${sourceRevision}?`
      )
    )
      return
    setDispatchingArtifact(artifact.id)
    setPerformanceDispatch(undefined)
    try {
      const receipt = await api.runTestSuite(
        artifact.repositoryId,
        artifact.id
      )
      setPerformanceDispatch({
        artifactId: artifact.id,
        state: 'success',
        message: `Dispatched ${receipt.workflowPath} from ${receipt.ref} at analyzed commit ${receipt.sourceRevision}. GitHub Actions will report the run as execution evidence.`,
      })
    } catch (error) {
      setPerformanceDispatch({
        artifactId: artifact.id,
        state: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to dispatch the test workflow.',
      })
    } finally {
      setDispatchingArtifact(undefined)
    }
  }
  const executionFilter = useMemo(() => {
    const iso = (value: string) => (value ? new Date(value).toISOString() : '')
    return Object.fromEntries(
      Object.entries({
        kind: executionKind,
        status: executionStatus,
        provider: executionProvider,
        attemptScope: executionAttemptScope,
        revision: executionRevision.trim(),
        workflowPath: executionWorkflowPath.trim(),
        minimumDurationMs: executionMinimumDurationSeconds
          ? String(Math.round(Number(executionMinimumDurationSeconds) * 1000))
          : '',
        maximumDurationMs: executionMaximumDurationSeconds
          ? String(Math.round(Number(executionMaximumDurationSeconds) * 1000))
          : '',
        from: iso(executionFrom),
        until: iso(executionUntil),
      }).filter(([, value]) => Boolean(value))
    ) as Record<string, string>
  }, [executionKind, executionStatus, executionProvider, executionAttemptScope, executionRevision, executionWorkflowPath, executionMinimumDurationSeconds, executionMaximumDurationSeconds, executionFrom, executionUntil])
  const executionTrendQuery = JSON.stringify([
    data.repositories.map(repository => repository.id),
    executionRepositoryId,
    executionFilter,
    invalidExecutionRange,
    invalidExecutionDurationRange,
  ])
  const executionTrendQueryRef = useRef(executionTrendQuery)
  executionTrendQueryRef.current = executionTrendQuery
  const artifactQuery = JSON.stringify(data.repositories.map(repository => [
    repository.id,
    repository.lastScanRevision ?? '',
  ]))
  const artifactQueryRef = useRef(artifactQuery)
  artifactQueryRef.current = artifactQuery
  useEffect(() => {
    let active = true
    setArtifactNextCursors({})
    setArtifactPaginationError(undefined)
    setRepositoryArtifactFailures([])
    setRepositoryGovernanceFailures([])
    setLoadingMoreArtifacts(false)
    setPolicyGateNextCursors({})
    setHistoryPaginationError(undefined)
    void Promise.all(
      data.repositories.map(async repository => {
        const [repositoryArtifactsResult, evaluationResult] = await Promise.allSettled([
          api.qualityArtifacts(repository.id),
          policyGateRevisionScope === 'current' &&
          !repository.lastScanRevision
            ? []
            : api.policyGateEvaluations(
                repository.id,
                Object.fromEntries(
                  Object.entries({
                    kind: policyGateKind,
                    severity: policyGateSeverity,
                    reviewStatus: policyGateReviewStatus,
                    revision:
                      policyGateRevisionScope === 'current'
                        ? repository.lastScanRevision ?? ''
                        : '',
                  }).filter(([, value]) => Boolean(value))
                )
              ),
        ])
        const repositoryArtifacts = repositoryArtifactsResult.status === 'fulfilled'
          ? normalizeHistoryPage(repositoryArtifactsResult.value)
          : { items: [] as QualityArtifact[], page: { nextCursor: null, hasMore: false } }
        const evaluations = evaluationResult.status === 'fulfilled'
          ? normalizeHistoryPage(evaluationResult.value)
          : { items: [] as PolicyGateEvaluation[], page: { nextCursor: null, hasMore: false } }
        return {
          artifacts: repositoryArtifacts.items,
          artifactNextCursor: repositoryArtifacts.page.nextCursor,
          evaluations: evaluations.items,
          nextCursor: evaluations.page.nextCursor,
          repositoryId: repository.id,
          artifactsFailed: repositoryArtifactsResult.status === 'rejected',
          governanceFailed: evaluationResult.status === 'rejected',
        }
      })
    )
      .then(groups => {
        if (active) {
          setArtifacts(groups.flatMap(group => group.artifacts))
          setArtifactNextCursors(Object.fromEntries(
            groups.flatMap(group => group.artifactNextCursor
              ? [[group.repositoryId, group.artifactNextCursor]]
              : [])
          ))
          setPolicyGateEvaluations(groups.flatMap(group => group.evaluations))
          setPolicyGateNextCursors(Object.fromEntries(
            groups.flatMap(group => group.nextCursor ? [[group.repositoryId, group.nextCursor]] : [])
          ))
          setRepositoryArtifactFailures(groups.filter(group => group.artifactsFailed).map(group => group.repositoryId))
          setRepositoryGovernanceFailures(groups.filter(group => group.governanceFailed).map(group => group.repositoryId))
        }
      })
      .catch(() => {
        if (active) {
          setArtifacts([])
          setArtifactNextCursors({})
          setPolicyGateEvaluations([])
          setPolicyGateNextCursors({})
          setRepositoryArtifactFailures(data.repositories.map(repository => repository.id))
          setRepositoryGovernanceFailures(data.repositories.map(repository => repository.id))
        }
      })
      .finally(() => {
        if (active) setLoadingArtifacts(false)
      })
    return () => {
      active = false
    }
  }, [
    data.repositories,
    policyGateKind,
    policyGateRevisionScope,
    policyGateReviewStatus,
    policyGateSeverity,
  ])
  useEffect(() => {
    let active = true
    const selection = governanceEvidenceSelection(
      policyGateEvaluations,
      data.repositories,
      policyGateRevisionScope,
    )
    setOmittedGovernanceEvidenceRevisions(selection.omittedHistoricalRevisions)
    const batches = selection.requests.flatMap(({ repositoryId, artifactIds }) =>
      Array.from({ length: Math.ceil(artifactIds.length / 100) }, (_, index) => ({
        repositoryId,
        artifactIds: artifactIds.slice(index * 100, (index + 1) * 100),
      }))
    )
    if (!batches.length) {
      setGovernanceEvidenceArtifacts([])
      setGovernanceEvidenceFailures([])
      return () => { active = false }
    }
    void Promise.allSettled(
      batches.map(batch => api.qualityArtifactsByIds(batch.repositoryId, batch.artifactIds))
    ).then(results => {
      if (!active) return
      setGovernanceEvidenceArtifacts(results.flatMap(result =>
        result.status === 'fulfilled' ? result.value.items : []
      ))
      setGovernanceEvidenceFailures([...new Set(results.flatMap((result, index) =>
        result.status === 'rejected' ? [batches[index].repositoryId] : []
      ))])
    })
    return () => { active = false }
  }, [data.repositories, policyGateEvaluations, policyGateRevisionScope])
  const loadMoreArtifacts = async () => {
    const cursors = Object.entries(artifactNextCursors)
    if (!cursors.length) return
    const query = artifactQueryRef.current
    setLoadingMoreArtifacts(true)
    setArtifactPaginationError(undefined)
    try {
      const groups = await Promise.all(cursors.map(async ([repositoryId, cursor]) => ({
        repositoryId,
        page: normalizeHistoryPage(await api.qualityArtifacts(repositoryId, undefined, cursor)),
      })))
      if (artifactQueryRef.current !== query) return
      setArtifacts(current => [...new Map(
        [...current, ...groups.flatMap(group => group.page.items)].map(item => [item.id, item])
      ).values()])
      setArtifactNextCursors(Object.fromEntries(
        groups.flatMap(group => group.page.page.nextCursor
          ? [[group.repositoryId, group.page.page.nextCursor]]
          : [])
      ))
    } catch (cause) {
      if (artifactQueryRef.current === query) {
        setArtifactPaginationError(cause instanceof Error ? cause.message : 'Unable to load more repository evidence.')
      }
    } finally {
      if (artifactQueryRef.current === query) setLoadingMoreArtifacts(false)
    }
  }
  useEffect(() => {
    let active = true
    setLoadingFlows(true)
    setFlowNextCursors({})
    setRepositoryFlowFailures([])
    setHistoryPaginationError(undefined)
    void Promise.allSettled(
      data.repositories.map(repository =>
        flowRepositoryId && flowRepositoryId !== repository.id
          ? Promise.resolve({ repositoryId: repository.id, page: { items: [] as RepositoryFlowCandidate[], page: { nextCursor: null, hasMore: false } } })
          : flowRevisionScope === 'current' && !repository.lastScanRevision
            ? Promise.resolve({ repositoryId: repository.id, page: { items: [] as RepositoryFlowCandidate[], page: { nextCursor: null, hasMore: false } } })
            : api.repositoryFlowCandidates(
                repository.id,
                Object.fromEntries(
                  Object.entries({
                    source: flowSource,
                    status: flowStatus,
                    revision:
                      flowRevisionScope === 'current'
                        ? repository.lastScanRevision ?? ''
                        : '',
                    model: flowModel.trim(),
                    promptVersion: flowPromptVersion.trim(),
                    schemaVersion: flowSchemaVersion.trim(),
                  }).filter(([, value]) => Boolean(value))
                )
              ).then(response => ({ repositoryId: repository.id, page: normalizeHistoryPage(response) }))
      )
    )
      .then(results => {
        if (active) {
          const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
          setFlowCandidates(groups.flatMap(group => group.page.items))
          setFlowNextCursors(Object.fromEntries(
            groups.flatMap(group => group.page.page.nextCursor ? [[group.repositoryId, group.page.page.nextCursor]] : [])
          ))
          setRepositoryFlowFailures(results.flatMap((result, index) =>
            result.status === 'rejected' ? [data.repositories[index].id] : []
          ))
        }
      })
      .finally(() => {
        if (active) {
          setLoadedFlowQuery(flowQuery)
          setLoadingFlows(false)
        }
      })
    return () => {
      active = false
    }
  }, [
    data.repositories,
    flowQuery,
    flowRepositoryId,
    flowRevisionScope,
    flowSource,
    flowStatus,
    flowModel,
    flowPromptVersion,
    flowSchemaVersion,
  ])
  useEffect(() => {
    let active = true
    if (!flowResultsAreCurrent || flowRevisionScope !== 'all') {
      setFlowEvidenceArtifacts([])
      setOmittedFlowEvidenceRevisions(0)
      return () => { active = false }
    }
    const selection = historicalFlowEvidenceSelection(
      flowCandidates,
      data.repositories,
    )
    setOmittedFlowEvidenceRevisions(selection.omitted)
    const selectedRevisions = new Set(
      selection.selected.map(({ repositoryId, revision }) => `${repositoryId}\u0000${revision}`)
    )
    const evidenceIds = new Map<string, Set<string>>()
    flowCandidates.forEach(candidate => {
      if (!selectedRevisions.has(`${candidate.repositoryId}\u0000${candidate.revision}`)) return
      const ids = evidenceIds.get(candidate.repositoryId) ?? new Set<string>()
      const referencedIds = [
        ...candidate.evidence,
        ...candidate.steps.flatMap(step => step.targetIds),
        ...candidate.wireframe.nodes.flatMap(node => node.targetIds),
      ]
      referencedIds.forEach(id => ids.add(id))
      evidenceIds.set(candidate.repositoryId, ids)
    })
    const requests = [...evidenceIds].flatMap(([repositoryId, ids]) => {
      const values = [...ids]
      return Array.from({ length: Math.ceil(values.length / 100) }, (_, index) =>
        api.qualityArtifactsByIds(repositoryId, values.slice(index * 100, (index + 1) * 100))
          .then(response => response.items)
          .catch(() => [])
      )
    })
    void Promise.all(requests).then(
      groups => { if (active) setFlowEvidenceArtifacts(groups.flat()) },
      () => { if (active) setFlowEvidenceArtifacts([]) },
    )
    return () => { active = false }
  }, [data.repositories, flowCandidates, flowResultsAreCurrent, flowRevisionScope])
  useEffect(() => {
    let active = true
    setExecutionNextCursors({})
    setExecutionPaginationError(undefined)
    setExecutionTrendNextCursors({})
    setExecutionTrendPaginationError(undefined)
    setLoadingMoreExecutionTrend(false)
    setPerformanceNextCursors({})
    setPerformancePaginationError(undefined)
    setExecutionHistoryFailures([])
    setExecutionTrendFailures([])
    setExecutionPerformanceFailures([])
    if (invalidExecutionRange || invalidExecutionDurationRange) {
      setExecutions([])
      setPerformanceExecutions([])
      setPerformanceEvidenceFailures([])
      setIntegrationExecutions([])
      setIntegrationEvidenceFailures([])
      setPostProductionExecutions([])
      setPostProductionEvidenceFailures([])
      setExecutionPerformance([])
      setExecutionTrends([])
      return () => {
        active = false
      }
    }
    void Promise.all(
      data.repositories.map(async repository => {
        if (executionRepositoryId && executionRepositoryId !== repository.id) {
          return {
            repositoryId: repository.id,
            executions: { items: [] as TestExecution[], page: { nextCursor: null, hasMore: false } },
            performance: { items: [] as PolicyGatePerformance[], page: { nextCursor: null, hasMore: false } },
            trend: { items: [] as ExecutionOutcomeTrend[], page: { nextCursor: null, hasMore: false } },
            performanceExecutions: [] as TestExecution[],
            integrationExecutions: [] as TestExecution[],
            postProductionExecutions: [] as TestExecution[],
            executionFailed: false,
            performanceExecutionsFailed: false,
            integrationExecutionsFailed: false,
            postProductionExecutionsFailed: false,
            performanceFailed: false,
            trendFailed: false,
          }
        }
        const [executionResult, performanceResult, trendResult, performanceExecutionsResult, integrationExecutionsResult, postProductionExecutionsResult] = await Promise.allSettled([
          api.testExecutions(repository.id, executionFilter),
          api.executionPerformance(repository.id, executionFilter),
          api.executionTrend(repository.id, executionFilter),
          api.latestPerformanceExecutions(repository.id),
          api.latestIntegrationExecutions(repository.id),
          api.latestPostProductionExecutions(repository.id),
        ])
        return {
          repositoryId: repository.id,
          executions: executionResult.status === 'fulfilled'
            ? normalizeHistoryPage(executionResult.value)
            : { items: [] as TestExecution[], page: { nextCursor: null, hasMore: false } },
          performance: performanceResult.status === 'fulfilled'
            ? normalizeHistoryPage(performanceResult.value)
            : { items: [] as PolicyGatePerformance[], page: { nextCursor: null, hasMore: false } },
          trend: trendResult.status === 'fulfilled'
            ? normalizeHistoryPage(trendResult.value)
            : { items: [] as ExecutionOutcomeTrend[], page: { nextCursor: null, hasMore: false } },
          performanceExecutions: performanceExecutionsResult.status === 'fulfilled'
            ? performanceExecutionsResult.value.items
            : [],
          integrationExecutions: integrationExecutionsResult.status === 'fulfilled'
            ? integrationExecutionsResult.value.items
            : [],
          postProductionExecutions: postProductionExecutionsResult.status === 'fulfilled'
            ? postProductionExecutionsResult.value.items
            : [],
          executionFailed: executionResult.status === 'rejected',
          performanceExecutionsFailed: performanceExecutionsResult.status === 'rejected',
          integrationExecutionsFailed: integrationExecutionsResult.status === 'rejected',
          postProductionExecutionsFailed: postProductionExecutionsResult.status === 'rejected',
          performanceFailed: performanceResult.status === 'rejected',
          trendFailed: trendResult.status === 'rejected',
        }
      })
    )
      .then(groups => {
        if (active) {
          const loadedExecutions = groups.flatMap(group => group.executions.items)
          setExecutions(loadedExecutions)
          setPerformanceExecutions(groups.flatMap(group => group.performanceExecutions))
          setPerformanceEvidenceFailures(groups
            .filter(group => group.performanceExecutionsFailed)
            .map(group => group.repositoryId))
          setIntegrationExecutions(groups.flatMap(group => group.integrationExecutions))
          setIntegrationEvidenceFailures(groups
            .filter(group => group.integrationExecutionsFailed)
            .map(group => group.repositoryId))
          setPostProductionExecutions(groups.flatMap(group => group.postProductionExecutions))
          setPostProductionEvidenceFailures(groups
            .filter(group => group.postProductionExecutionsFailed)
            .map(group => group.repositoryId))
          setExecutionNextCursors(Object.fromEntries(
            groups.flatMap(group => group.executions.page.nextCursor
              ? [[group.repositoryId, group.executions.page.nextCursor]]
              : [])
          ))
          setExecutionPerformance(groups.flatMap(group => group.performance.items))
          setExecutionTrends(groups.map(group => group.trend.items))
          setExecutionTrendNextCursors(Object.fromEntries(
            groups.flatMap(group => group.trend.page.nextCursor
              ? [[group.repositoryId, group.trend.page.nextCursor]]
              : [])
          ))
          setPerformanceNextCursors(Object.fromEntries(
            groups.flatMap(group => group.performance.page.nextCursor
              ? [[group.repositoryId, group.performance.page.nextCursor]]
              : [])
          ))
          setExecutionHistoryFailures(groups.filter(group => group.executionFailed).map(group => group.repositoryId))
          setExecutionPerformanceFailures(groups.filter(group => group.performanceFailed).map(group => group.repositoryId))
          setExecutionTrendFailures(groups.filter(group => group.trendFailed).map(group => group.repositoryId))
        }
      })
      .catch(() => {
        if (active) {
          setExecutions([])
          setPerformanceExecutions([])
          setPerformanceEvidenceFailures(data.repositories.map(repository => repository.id))
          setIntegrationExecutions([])
          setIntegrationEvidenceFailures(data.repositories.map(repository => repository.id))
          setPostProductionExecutions([])
          setPostProductionEvidenceFailures(data.repositories.map(repository => repository.id))
          setExecutionNextCursors({})
          setExecutionPerformance([])
          setExecutionTrends([])
          setExecutionTrendNextCursors({})
          setPerformanceNextCursors({})
          setExecutionHistoryFailures(data.repositories.map(repository => repository.id))
          setExecutionPerformanceFailures(data.repositories.map(repository => repository.id))
          setExecutionTrendFailures(data.repositories.map(repository => repository.id))
        }
      })
    return () => {
      active = false
    }
  }, [
    data.repositories,
    executionFilter,
    executionRepositoryId,
    invalidExecutionRange,
    invalidExecutionDurationRange,
  ])
  const loadMoreExecutionTrend = async () => {
    const cursors = Object.entries(executionTrendNextCursors)
    if (!cursors.length) return
    const query = executionTrendQueryRef.current
    setLoadingMoreExecutionTrend(true)
    setExecutionTrendPaginationError(undefined)
    try {
      const groups = await Promise.all(cursors.map(async ([repositoryId, cursor]) => ({
        repositoryId,
        page: normalizeHistoryPage(await api.executionTrend(repositoryId, {
          ...executionFilter,
          cursor,
        })),
      })))
      if (executionTrendQueryRef.current !== query) return
      setExecutionTrends(current => [...current, ...groups.map(group => group.page.items)])
      setExecutionTrendNextCursors(Object.fromEntries(
        groups.flatMap(group => group.page.page.nextCursor
          ? [[group.repositoryId, group.page.page.nextCursor]]
          : [])
      ))
    } catch (cause) {
      if (executionTrendQueryRef.current === query) {
        setExecutionTrendPaginationError(cause instanceof Error ? cause.message : 'Unable to load more execution trend history.')
      }
    } finally {
      if (executionTrendQueryRef.current === query) setLoadingMoreExecutionTrend(false)
    }
  }
  const loadMoreExecutions = async () => {
    const cursors = Object.entries(executionNextCursors)
    if (!cursors.length) return
    setLoadingMoreExecutions(true)
    setExecutionPaginationError(undefined)
    try {
      const groups = await Promise.all(cursors.map(async ([repositoryId, cursor]) => ({
        repositoryId,
        page: normalizeHistoryPage(await api.testExecutions(repositoryId, {
          ...executionFilter,
          cursor,
        })),
      })))
      const continuedExecutions = groups.flatMap(group => group.page.items)
      setExecutions(current => [...new Map(
        [...current, ...continuedExecutions].map(item => [item.id, item])
      ).values()])
      setPerformanceExecutions(current => [...new Map(
        [
          ...current,
          ...continuedExecutions.filter(execution => execution.kind === 'load' || execution.kind === 'stress'),
        ].map(item => [item.id, item])
      ).values()])
      setExecutionNextCursors(Object.fromEntries(
        groups.flatMap(group => group.page.page.nextCursor
          ? [[group.repositoryId, group.page.page.nextCursor]]
          : [])
      ))
    } catch (cause) {
      setExecutionPaginationError(cause instanceof Error ? cause.message : 'Unable to load more execution evidence.')
    } finally {
      setLoadingMoreExecutions(false)
    }
  }
  const loadMorePerformance = async () => {
    const cursors = Object.entries(performanceNextCursors)
    if (!cursors.length) return
    const query = executionTrendQueryRef.current
    setLoadingMorePerformance(true)
    setPerformancePaginationError(undefined)
    try {
      const results = await Promise.allSettled(cursors.map(async ([repositoryId, cursor]) => ({
        repositoryId,
        page: normalizeHistoryPage(await api.executionPerformance(repositoryId, {
          ...executionFilter,
          cursor,
        })),
      })))
      if (executionTrendQueryRef.current !== query) return
      const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      const failedRepositoryIds = results.flatMap((result, index) =>
        result.status === 'rejected' ? [cursors[index][0]] : []
      )
      setExecutionPerformance(current => [...new Map(
        [...current, ...groups.flatMap(group => group.page.items)].map(item => [
          `${item.repositoryId}:${item.policyArtifactId}:${item.gateArtifactId}`,
          item,
        ])
      ).values()])
      setPerformanceNextCursors(current => {
        const next = { ...current }
        groups.forEach(group => {
          if (group.page.page.nextCursor) next[group.repositoryId] = group.page.page.nextCursor
          else delete next[group.repositoryId]
        })
        return next
      })
      if (failedRepositoryIds.length) {
        setPerformancePaginationError(`Unable to load more policy-gate performance for ${failedRepositoryIds.length} ${failedRepositoryIds.length === 1 ? 'repository' : 'repositories'}. Successful evidence remains visible.`)
      }
    } catch (cause) {
      if (executionTrendQueryRef.current === query) {
        setPerformancePaginationError(cause instanceof Error ? cause.message : 'Unable to load more policy-gate performance.')
      }
    } finally {
      if (executionTrendQueryRef.current === query) setLoadingMorePerformance(false)
    }
  }
  const loadMoreFlows = async () => {
    const cursors = Object.entries(flowNextCursors)
    if (!cursors.length) return
    setLoadingMoreFlows(true)
    setHistoryPaginationError(undefined)
    try {
      const groups = await Promise.all(cursors.map(async ([repositoryId, cursor]) => {
        const repository = data.repositories.find(item => item.id === repositoryId)
        const page = normalizeHistoryPage(await api.repositoryFlowCandidates(
          repositoryId,
          Object.fromEntries(Object.entries({
            source: flowSource,
            status: flowStatus,
            revision: flowRevisionScope === 'current' ? repository?.lastScanRevision ?? '' : '',
            model: flowModel.trim(),
            promptVersion: flowPromptVersion.trim(),
            schemaVersion: flowSchemaVersion.trim(),
            cursor,
          }).filter(([, value]) => Boolean(value)))
        ))
        return { repositoryId, page }
      }))
      setFlowCandidates(current => [...new Map(
        [...current, ...groups.flatMap(group => group.page.items)].map(item => [item.id, item])
      ).values()])
      setFlowNextCursors(Object.fromEntries(
        groups.flatMap(group => group.page.page.nextCursor ? [[group.repositoryId, group.page.page.nextCursor]] : [])
      ))
    } catch (cause) {
      setHistoryPaginationError(cause instanceof Error ? cause.message : 'Unable to load more UX-flow history.')
    } finally {
      setLoadingMoreFlows(false)
    }
  }
  const loadMorePolicyGates = async () => {
    const cursors = Object.entries(policyGateNextCursors)
    if (!cursors.length) return
    const selectionQuery = policyGateHistoryQueryRef.current
    const visibleAtRequestStart = new Set(
      policyGateEvaluationsRef.current.map(evaluation => evaluation.id)
    )
    setLoadingMorePolicyGates(true)
    setHistoryPaginationError(undefined)
    try {
      const groups = await Promise.all(cursors.map(async ([repositoryId, cursor]) => {
        const repository = data.repositories.find(item => item.id === repositoryId)
        const page = normalizeHistoryPage(await api.policyGateEvaluations(
          repositoryId,
          Object.fromEntries(Object.entries({
            kind: policyGateKind,
            severity: policyGateSeverity,
            reviewStatus: policyGateReviewStatus,
            revision: policyGateRevisionScope === 'current' ? repository?.lastScanRevision ?? '' : '',
            cursor,
          }).filter(([, value]) => Boolean(value)))
        ))
        return { repositoryId, page }
      }))
      if (policyGateHistoryQueryRef.current !== selectionQuery) return
      const continuedEvaluations = groups.flatMap(group => group.page.items)
      setPolicyGateEvaluations(current => mergePolicyGateContinuation(
        current,
        continuedEvaluations,
        visibleAtRequestStart,
      ))
      setPolicyGateNextCursors(Object.fromEntries(
        groups.flatMap(group => group.page.page.nextCursor ? [[group.repositoryId, group.page.page.nextCursor]] : [])
      ))
    } catch (cause) {
      setHistoryPaginationError(cause instanceof Error ? cause.message : 'Unable to load more policy and gate history.')
    } finally {
      setLoadingMorePolicyGates(false)
    }
  }
  const outcomeTrend = useMemo(
    () => mergeExecutionOutcomeTrends(executionTrends),
    [executionTrends]
  )
  const repositoryLabels = useMemo(
    () =>
      new Map(
        data.repositories.map(repository => [
          repository.id,
          `${repository.owner}/${repository.name}`,
        ])
      ),
    [data.repositories]
  )
  const evidenceArtifacts = useMemo(
    () => [...new Map(
      [...artifacts, ...governanceEvidenceArtifacts, ...flowEvidenceArtifacts]
        .map(artifact => [artifact.id, artifact])
    ).values()],
    [artifacts, governanceEvidenceArtifacts, flowEvidenceArtifacts]
  )
  const artifactsById = useMemo(
    () => new Map(evidenceArtifacts.map(artifact => [artifact.id, artifact])),
    [evidenceArtifacts]
  )
  const filteredPolicyGateEvaluations = useMemo(
    () =>
      policyGateEvaluations.filter(
        evaluation =>
          (!policyGateKind || evaluation.kind === policyGateKind) &&
          (!policyGateSeverity || evaluation.severity === policyGateSeverity) &&
          (!policyGateReviewStatus ||
            evaluation.reviewStatus === policyGateReviewStatus)
      ),
    [
      policyGateEvaluations,
      policyGateKind,
      policyGateSeverity,
      policyGateReviewStatus,
    ]
  )
  const groups: Array<[QualityArtifact['kind'], string, string]> = [
    [
      'route',
      'UX flows',
      'Routes and API transitions discovered from repository analysis',
    ],
    [
      'story',
      'Storybook states',
      'Component states and interaction stories supplied to reviewed flow analysis',
    ],
    [
      'documentation',
      'Repository documentation',
      'Journey, policy, release, and testing context discovered in source',
    ],
    [
      'test-plan',
      'Existing test plans',
      'Repository test cases available for flow and coverage analysis',
    ],
    [
      'integration-test',
      'Integration tests',
      'Integration workflows detected by repository analysis',
    ],
    [
      'post-production-test',
      'Post-production tests',
      'Production validation workflows detected by repository analysis',
    ],
    [
      'policy',
      'Policies',
      'Repository policy evidence awaiting governance review',
    ],
    [
      'gate',
      'Gates',
      'CI and repository guard evidence linked to policy candidates',
    ],
    [
      'load-test',
      'Load tests',
      'Load-test definitions and thresholds discovered in source',
    ],
    [
      'stress-test',
      'Stress tests',
      'Stress and soak-test definitions discovered in source',
    ],
  ]
  return (
    <>
      <PageHeading
        eyebrow="Repository analysis"
        title="Quality intelligence"
        detail="Deterministic repository evidence is stored by revision. LiteLLM proposals remain reviewable suggestions before they affect flows or policy governance."
      />
      <FlowInspector
        open={flowInspectorOpen}
        flow={inspectedFlow}
        repositoryLabel={inspectedFlow
          ? repositoryLabels.get(inspectedFlow.repositoryId)
          : undefined}
        artifacts={evidenceArtifacts}
        loading={flowInspectorLoading}
        error={flowInspectorError}
        onClose={closeFlowInspector}
      />
      {data.diagnostics.filter(item => item.category === 'repository').length > 0 && (
        <details className="scan-diagnostics" open>
          <summary>
            <AlertTriangle size={14} /> Repository analysis diagnostics
          </summary>
          <div>
            {data.diagnostics
              .filter(item => item.category === 'repository')
              .map(item => (
                <article key={`${item.repositoryId}:${item.revision}:${item.sourcePath}:${item.code}`}>
                  <span className={`diagnostic-severity diagnostic-${item.severity}`}>
                    {item.severity}
                  </span>
                  <code>{repositoryLabels.get(item.repositoryId) ?? item.repositoryId} · {item.sourcePath}</code>
                  <strong>{item.code}</strong>
                  <p>{item.message}</p>
                </article>
              ))}
          </div>
        </details>
      )}
      {loadingArtifacts ? (
        <div className="loading-screen">
          <RefreshCw className="spin" />
          <span>Loading repository evidence…</span>
        </div>
      ) : (
        <>
          <FlowInventoryFilters
            repositories={data.repositories}
            repositoryId={flowRepositoryId}
            source={flowSource}
            status={flowStatus}
            revisionScope={flowRevisionScope}
            model={flowModel}
            promptVersion={flowPromptVersion}
            schemaVersion={flowSchemaVersion}
            onRepositoryIdChange={setFlowRepositoryId}
            onSourceChange={setFlowSource}
            onStatusChange={setFlowStatus}
            onRevisionScopeChange={setFlowRevisionScope}
            onModelChange={setFlowModel}
            onPromptVersionChange={setFlowPromptVersion}
            onSchemaVersionChange={setFlowSchemaVersion}
          />
          {Object.keys(artifactNextCursors).length > 0 && (
            <QualityAction
              intent="quiet"
              onClick={() => void loadMoreArtifacts()}
              disabled={loadingMoreArtifacts}
            >
              {loadingMoreArtifacts ? <RefreshCw className="spin" size={14} /> : <ChevronRight size={14} />}
              Load more repository evidence
            </QualityAction>
          )}
          {artifactPaginationError && (
            <p className="form-error" role="alert">{artifactPaginationError}</p>
          )}
          {(repositoryArtifactFailures.length > 0 ||
            repositoryGovernanceFailures.length > 0 ||
            repositoryFlowFailures.length > 0) && (
            <p className="form-error" role="alert">
              Some repository intelligence is temporarily unavailable. Evidence from successful repositories remains visible.
            </p>
          )}
          {governanceEvidenceFailures.length > 0 && (
            <p className="form-error" role="alert">
              Some exact policy and gate evidence could not be loaded. Evidence from successful repositories remains visible.
            </p>
          )}
          <div
            className="catalog-filters"
            aria-label="Policy and gate finding filters"
          >
            <label>
              Relationship or anomaly
              <select
                value={policyGateKind}
                onChange={event =>
                  setPolicyGateKind(
                    event.target.value as PolicyGateEvaluation['kind'] | ''
                  )
                }
              >
                <option value="">All relationships and anomalies</option>
                {[
                  'guarded-policy',
                  'unguarded-policy',
                  'guard-without-policy',
                  'contradictory-policy',
                  'ambiguous-policy',
                ].map(kind => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select
                value={policyGateSeverity}
                onChange={event =>
                  setPolicyGateSeverity(
                    event.target.value as PolicyGateEvaluation['severity'] | ''
                  )
                }
              >
                <option value="">All severities</option>
                {['high', 'medium', 'low'].map(severity => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Review
              <select
                value={policyGateReviewStatus}
                onChange={event =>
                  setPolicyGateReviewStatus(
                    event.target.value as
                      PolicyGateEvaluation['reviewStatus'] | ''
                  )
                }
              >
                <option value="">All review states</option>
                {['proposed', 'accepted', 'dismissed'].map(status => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Governance revision
              <select
                value={policyGateRevisionScope}
                onChange={event =>
                  setPolicyGateRevisionScope(
                    event.target.value as FlowRevisionScope
                  )
                }
              >
                <option value="current">Current analysis</option>
                <option value="all">All revisions</option>
              </select>
            </label>
          </div>
          {(Object.keys(flowNextCursors).length > 0 ||
            Object.keys(policyGateNextCursors).length > 0) && (
            <div className="row-actions" aria-label="Analysis history pagination">
              {Object.keys(flowNextCursors).length > 0 && (
                <QualityAction
                  intent="quiet"
                  disabled={loadingMoreFlows}
                  onClick={() => void loadMoreFlows()}
                >
                  {loadingMoreFlows ? <RefreshCw className="spin" size={14} /> : <ChevronRight size={14} />}
                  Load more UX-flow history
                </QualityAction>
              )}
              {Object.keys(policyGateNextCursors).length > 0 && (
                <QualityAction
                  intent="quiet"
                  disabled={loadingMorePolicyGates}
                  onClick={() => void loadMorePolicyGates()}
                >
                  {loadingMorePolicyGates ? <RefreshCw className="spin" size={14} /> : <ChevronRight size={14} />}
                  Load more policy and gate history
                </QualityAction>
              )}
            </div>
          )}
          {historyPaginationError && (
            <p className="performance-evidence-warning" role="alert">
              {historyPaginationError}
            </p>
          )}
          {omittedGovernanceEvidenceRevisions > 0 && (
            <p className="performance-inventory-only" role="status">
              Historical policy and gate evidence is expanded for the {MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS} newest revisions.{' '}
              {omittedGovernanceEvidenceRevisions}{' '}
              {omittedGovernanceEvidenceRevisions === 1 ? 'older revision remains' : 'older revisions remain'}{' '}
              visible with stored evidence passages without an unbounded repository request fan-out.
            </p>
          )}
          <div className="catalog-grid">
            {groups.map(([kind, title, detail]) => {
              const items = artifacts.filter(item => item.kind === kind)
              const visibleFlowCandidates = flowResultsAreCurrent
                ? flowCandidates
                : []
              const deterministicFlowCount = visibleFlowCandidates.filter(
                flow => flow.source === 'deterministic'
              ).length
              const liteLlmFlowCount = visibleFlowCandidates.filter(
                flow => flow.source === 'litellm'
              ).length
              return (
                <section className="catalog-panel" key={kind}>
                  <header>
                    <div>
                      <p className="eyebrow">
                        {kind === 'route'
                          ? `${visibleFlowCandidates.length} flows · ${items.length} routes indexed`
                          : `${items.length} discovered`}
                      </p>
                      <h2>{title}</h2>
                      <p>{detail}</p>
                    </div>
                  </header>
                  <div className="catalog-list">
                    {kind === 'route' && (
                      <div
                        className="flow-origin-summary"
                        aria-label="UX flow origin summary"
                      >
                        <strong>
                          {deterministicFlowCount} deterministic{' '}
                          {deterministicFlowCount === 1 ? 'flow' : 'flows'}
                        </strong>
                        <strong>
                          {liteLlmFlowCount} FuzeInfra LiteLLM{' '}
                          {liteLlmFlowCount === 1 ? 'proposal' : 'proposals'}
                        </strong>
                        {liteLlmFlowCount === 0 && (
                          <p>
                            No AI proposals are available for this revision.
                            Deterministic repository evidence remains available
                            below.
                          </p>
                        )}
                      </div>
                    )}
                    {kind === 'route' && !flowResultsAreCurrent && (
                      <div className="loading-screen" role="status">
                        <RefreshCw className="spin" />
                        <span>Loading UX flows…</span>
                      </div>
                    )}
                    {kind === 'route' && omittedFlowEvidenceRevisions > 0 && (
                      <p className="performance-inventory-only" role="status">
                        Historical evidence is prefetched for the {MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS} newest revisions.{' '}
                        {omittedFlowEvidenceRevisions}{' '}
                        {omittedFlowEvidenceRevisions === 1 ? 'older revision remains' : 'older revisions remain'}{' '}
                        visible with stored evidence identifiers and can be inspected without an unbounded repository request fan-out.
                      </p>
                    )}
                    {kind === 'route' &&
                      visibleFlowCandidates.map(flow => (
                        <article className="catalog-row" key={flow.id}>
                          <div>
                            <strong>{flow.title}</strong>
                            <small className="flow-repository-label">
                              Repository {repositoryLabels.get(flow.repositoryId) ?? flow.repositoryId}
                            </small>
                            <div className="flow-origin-line">
                              <span
                                className={`flow-origin-badge flow-origin-${flow.source}`}
                              >
                                {flow.source === 'deterministic'
                                  ? 'Deterministic repository evidence'
                                  : 'FuzeInfra LiteLLM proposal'}
                              </span>
                              <code>
                                {Math.round(flow.confidence * 100)}% confidence ·{' '}
                                {flow.status}
                              </code>
                            </div>
                            {flow.analysis ? (
                              <dl
                                className="flow-analysis-provenance"
                                aria-label={`${flow.title} analysis provenance`}
                              >
                                <div>
                                  <dt>Provider</dt>
                                  <dd>{flow.analysis.provider}</dd>
                                </div>
                                <div>
                                  <dt>Model</dt>
                                  <dd>{flow.analysis.model}</dd>
                                </div>
                                <div>
                                  <dt>Prompt</dt>
                                  <dd>{flow.analysis.promptVersion}</dd>
                                </div>
                                <div>
                                  <dt>Schema</dt>
                                  <dd>{flow.analysis.schemaVersion}</dd>
                                </div>
                              </dl>
                            ) : flow.source === 'litellm' ? (
                              <small className="flow-provenance-missing">
                                Model provenance was not stored for this legacy
                                proposal.
                              </small>
                            ) : null}
                            <p>{flow.steps[0]?.action}</p>
                            <QualityAction
                              intent="quiet"
                              onClick={() => void inspectFlow(flow)}
                            >
                              <Eye size={14} /> Inspect flow and wireframe
                            </QualityAction>
                            <ol
                              className="flow-wireframe"
                              aria-label={`${flow.title} wireframe`}
                            >
                              {flow.wireframe.nodes.map((node, index) => (
                                <li key={`${node.label}:${index}`}>
                                  <span>
                                    {String(index + 1).padStart(2, '0')}
                                  </span>
                                  {node.label}
                                </li>
                              ))}
                            </ol>
                            <details className="flow-provenance">
                              <summary>Source evidence</summary>
                              <small>Revision {flow.revision}</small>
                              <ul>
                                {[
                                  ...new Set([
                                    ...flow.evidence,
                                    ...flow.steps.flatMap(
                                      step => step.targetIds
                                    ),
                                  ]),
                                ].map(evidence => {
                                  const artifact = artifactsById.get(evidence)
                                  return (
                                    <li key={evidence}>
                                      <code>
                                        {artifact
                                          ? `${artifact.kind} · ${artifact.sourcePath}`
                                          : evidence}
                                      </code>
                                      {artifact && (
                                        <span>Artifact: {artifact.title}</span>
                                      )}
                                    </li>
                                  )
                                })}
                              </ul>
                              <ol>
                                {flow.steps.map((step, index) => (
                                  <li key={`${step.action}:${index}`}>
                                    <strong>{step.actor}</strong> —{' '}
                                    {step.action} → {step.expectedOutcome}
                                    {step.targetIds.length ? (
                                      <small
                                        aria-label={`${step.action} targets`}
                                      >
                                        {' '}
                                        ({step.targetIds
                                          .map(targetId => {
                                            const artifact =
                                              artifactsById.get(targetId)
                                            return artifact
                                              ? `${artifact.kind} · ${artifact.sourcePath} · ${artifact.title}`
                                              : targetId
                                          })
                                          .join(', ')})
                                      </small>
                                    ) : null}
                                  </li>
                                ))}
                              </ol>
                            </details>
                            <FlowReviewControls
                              flow={flow}
                              currentRevision={
                                data.repositories.find(
                                  repository => repository.id === flow.repositoryId
                                )?.lastScanRevision
                              }
                              onReview={reviewFlow}
                            />
                          </div>
                        </article>
                      ))}
                    {(kind === 'policy' || kind === 'gate') &&
                      filteredPolicyGateEvaluations
                        .filter(evaluation =>
                          kind === 'policy'
                            ? evaluation.policyArtifactIds.length
                            : evaluation.gateArtifactIds.length
                        )
                        .map(evaluation => (
                          <article className="catalog-row" key={evaluation.id}>
                            <div>
                              <strong>{evaluation.title}</strong>
                              <code>
                                {evaluation.severity} · {evaluation.kind} ·{' '}
                                {evaluation.reviewStatus}
                              </code>
                              <p>{evaluation.detail}</p>
                              <small>
                                {evaluation.recommendation}
                                {evaluation.reviewedAt
                                  ? ` · Reviewed ${new Date(evaluation.reviewedAt).toLocaleString()}${evaluation.reviewedBy ? ` by ${evaluation.reviewedBy}` : ''}`
                                  : ''}
                                {evaluation.reviewReason
                                  ? ` · ${evaluation.reviewReason}`
                                  : ''}
                              </small>
                              <PolicyGateEvidence
                                evaluation={evaluation}
                                artifacts={evidenceArtifacts}
                              />
                              <PolicyGateReviewControls
                                evaluation={evaluation}
                                currentRevision={
                                  data.repositories.find(
                                    repository =>
                                      repository.id === evaluation.repositoryId
                                  )?.lastScanRevision
                                }
                                onReview={reviewPolicyGate}
                              />
                            </div>
                          </article>
                        ))}
                    {items.map(item => {
                      const latestExecution = item.kind === 'integration-test'
                        ? latestIntegrationExecution(item, integrationExecutions)
                        : item.kind === 'post-production-test'
                          ? latestPostProductionExecution(item, postProductionExecutions)
                          : latestPerformanceExecution(item, performanceExecutions)
                      const repository = data.repositories.find(
                        candidate => candidate.id === item.repositoryId
                      )
                      const analyzedRevision = repository
                        ? analyzedSourceRevision(repository)
                        : undefined
                      return (
                      <article className="catalog-row" key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          <code>{item.sourcePath}</code>
                          <p>{item.summary}</p>
                          {['load-test', 'stress-test'].includes(item.kind) &&
                            performanceEvidenceFailures.includes(item.repositoryId) && (
                              <small className="performance-evidence-warning" role="alert">
                                Latest execution evidence is temporarily unavailable. The discovered test definition remains available.
                              </small>
                            )}
                          {item.kind === 'post-production-test' &&
                            postProductionEvidenceFailures.includes(item.repositoryId) && (
                              <small className="performance-evidence-warning" role="alert">
                                Latest post-production outcome is temporarily unavailable. The detected workflow remains available.
                              </small>
                            )}
                          {item.kind === 'integration-test' &&
                            integrationEvidenceFailures.includes(item.repositoryId) && (
                              <small className="performance-evidence-warning" role="alert">
                                Latest integration outcome is temporarily unavailable. The detected workflow remains available.
                              </small>
                            )}
                          {item.evidence.length > 0 && (
                            item.kind === 'test-plan' ? (
                              <small
                                className="test-plan-identity"
                                aria-label={`Evidence identity ${item.id}`}
                              >
                                Evidence ID <code>{item.evidence[0]}</code>
                              </small>
                            ) : (
                              <small>{item.evidence[0]}</small>
                            )
                          )}
                          {['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(item.kind) &&
                            item.execution?.trigger === 'workflow_dispatch' &&
                            !item.execution.requiredInputs?.length &&
                            analyzedRevision && (
                              <div className="row-actions">
                                <button
                                  className="secondary-button"
                                  disabled={dispatchingArtifact === item.id}
                                  onClick={() => void runTestSuite(item)}
                                >
                                  <Activity size={14} />{' '}
                                  {dispatchingArtifact === item.id
                                    ? 'Dispatching…'
                                    : `Run analyzed revision ${analyzedRevision.slice(0, 12)}`}
                                </button>
                              </div>
                            )}
                          {['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(item.kind) &&
                            item.execution?.requiredInputs?.length ? (
                              <small className="performance-inventory-only">
                                Inventory only · required workflow inputs need
                                repository defaults before controlled dispatch:{' '}
                                {item.execution.requiredInputs.join(', ')}.
                              </small>
                            ) : null}
                          {['load-test', 'stress-test'].includes(item.kind) &&
                            !item.execution && (
                              <small className="performance-inventory-only">
                                Inventory only · a repository-owned
                                workflow_dispatch workflow must declare the
                                reviewed FUZEQUALITY_PERFORMANCE environment
                                marker as load or stress to enable a controlled
                                run.
                              </small>
                            )}
                          {['integration-test', 'post-production-test'].includes(item.kind) &&
                            !item.execution && (
                              <small className="performance-inventory-only">
                                Inventory only · add a repository-owned workflow_dispatch trigger plus explicit FUZEQUALITY_STAGE and FUZEQUALITY_EXECUTION: dispatch markers to enable a controlled run.
                              </small>
                            )}
                          {['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(item.kind) &&
                            item.execution &&
                            !item.execution.requiredInputs?.length &&
                            !analyzedRevision && (
                              <small className="performance-inventory-only">
                                Inventory only · run repository analysis at an
                                exact commit before dispatching this workflow.
                              </small>
                            )}
                          {['load-test', 'stress-test'].includes(item.kind) && item.execution && (
                            <section
                              className="performance-latest-execution"
                              aria-label={`Latest execution for ${item.title}`}
                            >
                              <strong>Latest recorded outcome</strong>
                              {latestExecution ? (
                                <>
                                  <code>{latestExecution.status} · {latestExecution.revision.slice(0, 12)}</code>
                                  <p>{latestExecution.summary ?? 'No execution summary supplied.'}</p>
                                  <ExecutionEvidenceMetadata execution={latestExecution} />
                                  <ExecutionEvidenceCoverage execution={latestExecution} />
                                  <ExecutionLinkageEvidence execution={latestExecution} />
                                  <ExecutionThresholdEvidence execution={latestExecution} />
                                  <ExecutionEvidenceLinks execution={latestExecution} />
                                  <ExecutionSourceLink execution={latestExecution} />
                                </>
                              ) : (
                                <small>No matching execution has been ingested for this workflow yet.</small>
                              )}
                            </section>
                          )}
                          {item.kind === 'post-production-test' && (
                            <section
                              className="performance-latest-execution"
                              aria-label={`Latest execution for ${item.title}`}
                            >
                              <strong>Latest recorded post-production outcome</strong>
                              {latestExecution ? (
                                <>
                                  <code>{latestExecution.status} · {latestExecution.revision.slice(0, 12)}</code>
                                  <p>{latestExecution.summary ?? 'No execution summary supplied.'}</p>
                                  <ExecutionEvidenceMetadata execution={latestExecution} />
                                  <ExecutionEvidenceCoverage execution={latestExecution} />
                                  <ExecutionLinkageEvidence execution={latestExecution} />
                                  <ExecutionEvidenceLinks execution={latestExecution} />
                                  <ExecutionSourceLink execution={latestExecution} />
                                </>
                              ) : (
                                <small>No matching post-production execution has been ingested for this workflow yet.</small>
                              )}
                            </section>
                          )}
                          {item.kind === 'integration-test' && (
                            <section
                              className="performance-latest-execution"
                              aria-label={`Latest execution for ${item.title}`}
                            >
                              <strong>Latest recorded integration outcome</strong>
                              {latestExecution ? (
                                <>
                                  <code>{latestExecution.status} · {latestExecution.revision.slice(0, 12)}</code>
                                  <p>{latestExecution.summary ?? 'No execution summary supplied.'}</p>
                                  <ExecutionEvidenceMetadata execution={latestExecution} />
                                  <ExecutionEvidenceCoverage execution={latestExecution} />
                                  <ExecutionLinkageEvidence execution={latestExecution} />
                                  <ExecutionEvidenceLinks execution={latestExecution} />
                                  <ExecutionSourceLink execution={latestExecution} />
                                </>
                              ) : (
                                <small>No matching integration execution has been ingested for this workflow yet.</small>
                              )}
                            </section>
                          )}
                          {performanceDispatch?.artifactId === item.id && (
                            <p
                              className={
                                performanceDispatch.state === 'error'
                                  ? 'form-error'
                                  : 'performance-dispatch-success'
                              }
                              role={
                                performanceDispatch.state === 'error'
                                  ? 'alert'
                                  : 'status'
                              }
                            >
                              {performanceDispatch.message}
                            </p>
                          )}
                        </div>
                      </article>
                      )
                    })}
                    {items.length === 0 &&
                      !(kind === 'route' &&
                        (!flowResultsAreCurrent ||
                          visibleFlowCandidates.length)) && (
                        <div className="empty-state">
                          <Search />
                          <strong>No evidence indexed yet</strong>
                          <span>
                            Run a repository analysis to populate this
                            inventory.
                          </span>
                        </div>
                      )}
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}
      {!loadingArtifacts && (
        <section className="catalog-panel">
          <header>
            <div>
              <p className="eyebrow">Execution evidence</p>
              <h2>CI and post-production results</h2>
              <p>
                Imported CI, integration, post-production, load, and stress
                evidence retains the source revision and linked policy/gates.
              </p>
            </div>
          </header>
          <div
            className="catalog-filters"
            aria-label="Execution evidence filters"
          >
            <label>
              Repository
              <select
                value={executionRepositoryId}
                onChange={event => setExecutionRepositoryId(event.target.value)}
              >
                <option value="">All repositories</option>
                {data.repositories.map(repository => (
                  <option key={repository.id} value={repository.id}>
                    {repository.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Suite
              <select
                value={executionKind}
                onChange={event =>
                  setExecutionKind(
                    event.target.value as TestExecution['kind'] | ''
                  )
                }
              >
                <option value="">All suites</option>
                {['ci', 'integration', 'post-production', 'load', 'stress'].map(
                  kind => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  )
                )}
              </select>
            </label>
            <label>
              Outcome
              <select
                value={executionStatus}
                onChange={event =>
                  setExecutionStatus(
                    event.target.value as TestExecution['status'] | ''
                  )
                }
              >
                <option value="">All outcomes</option>
                {['passed', 'failed', 'cancelled', 'running'].map(status => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ingestion provider
              <select
                value={executionProvider}
                onChange={event =>
                  setExecutionProvider(
                    event.target.value as TestExecution['provider'] | ''
                  )
                }
              >
                <option value="">All providers</option>
                <option value="github-actions">GitHub Actions</option>
                <option value="external">External ingestion</option>
              </select>
            </label>
            <label>
              Attempt
              <select
                value={executionAttemptScope}
                onChange={event => setExecutionAttemptScope(
                  event.target.value as 'initial' | 'retry' | 'recovered' | ''
                )}
              >
                <option value="">All attempts</option>
                <option value="initial">Initial attempts</option>
                <option value="retry">Retries only</option>
                <option value="recovered">Recovered after failure</option>
              </select>
            </label>
            <label>
              Source revision
              <input
                type="text"
                value={executionRevision}
                maxLength={200}
                placeholder="Exact commit SHA"
                onChange={event => setExecutionRevision(event.target.value)}
              />
            </label>
            <label>
              Workflow file
              <input
                type="text"
                value={executionWorkflowPath}
                maxLength={1000}
                placeholder=".github/workflows/load.yml"
                onChange={event => setExecutionWorkflowPath(event.target.value)}
              />
            </label>
            <label>
              Minimum duration (seconds)
              <input
                type="number"
                min="0"
                step="1"
                value={executionMinimumDurationSeconds}
                placeholder="Any duration"
                onChange={event => setExecutionMinimumDurationSeconds(event.target.value)}
              />
            </label>
            <label>
              Maximum duration (seconds)
              <input
                type="number"
                min="0"
                step="1"
                value={executionMaximumDurationSeconds}
                placeholder="Any duration"
                aria-invalid={invalidExecutionDurationRange}
                onChange={event => setExecutionMaximumDurationSeconds(event.target.value)}
              />
            </label>
            <label>
              From
              <input
                type="datetime-local"
                value={executionFrom}
                onChange={event => setExecutionFrom(event.target.value)}
              />
            </label>
            <label>
              Until
              <input
                type="datetime-local"
                value={executionUntil}
                onChange={event => setExecutionUntil(event.target.value)}
              />
            </label>
            {(executionFrom || executionUntil) && (
              <button
                className="secondary-button execution-filter-reset"
                onClick={() => {
                  setExecutionFrom('')
                  setExecutionUntil('')
                }}
              >
                Clear dates
              </button>
            )}
          </div>
          {invalidExecutionDurationRange && (
            <p className="form-error" role="alert">
              Maximum duration must be greater than or equal to minimum duration.
            </p>
          )}
          {executionTrendFailures.length > 0 && (
            <p className="form-error" role="alert">
              Execution outcome trend is temporarily unavailable for {executionTrendFailures.length}{' '}
              {executionTrendFailures.length === 1 ? 'repository' : 'repositories'}. Loaded execution evidence remains visible.
            </p>
          )}
          <p className="performance-inventory-only">
            Outcome-trend continuation retains the execution lifecycle state captured when this view loaded.
          </p>
          <div className="execution-trend" aria-label="Execution outcome trend">
            {outcomeTrend.map(day => (
              <div key={day.date}>
                <strong>{day.date}</strong>
                <span>{day.passed} passed</span>
                <span>{day.failed} failed</span>
                <span>{day.cancelled} cancelled</span>
                <span>{day.running} running</span>
                <span>
                  {day.durationSampleCount > 0
                    ? `${durationMsLabel(day.averageDurationMs)} average · ${durationMsLabel(day.maximumDurationMs)} slowest · ${day.durationSampleCount} timed`
                    : 'No completed timing samples'}
                </span>
                <span>
                  {day.retryAttemptCount} retries · {day.successfulRetryCount} passed retries · {day.recoveredRunCount} recovered after failure
                </span>
              </div>
            ))}
            {!outcomeTrend.length && (
              <span>No timestamped outcomes for this filter.</span>
            )}
          </div>
          {Object.keys(executionTrendNextCursors).length > 0 && (
            <QualityAction
              intent="quiet"
              onClick={() => void loadMoreExecutionTrend()}
              disabled={loadingMoreExecutionTrend}
            >
              {loadingMoreExecutionTrend ? <RefreshCw className="spin" size={14} /> : <ChevronRight size={14} />}
              Load more outcome trend
            </QualityAction>
          )}
          {executionTrendPaginationError && (
            <p className="form-error" role="alert">{executionTrendPaginationError}</p>
          )}
          {executionHistoryFailures.length > 0 && (
            <p className="form-error" role="alert">
              Execution history is temporarily unavailable for {executionHistoryFailures.length}{' '}
              {executionHistoryFailures.length === 1 ? 'repository' : 'repositories'}. Available trend and policy-gate evidence remains visible.
            </p>
          )}
          <div className="catalog-list">
            {executions.map(execution => (
              <article className="catalog-row" key={execution.id}>
                <div>
                  <strong>{execution.name}</strong>
                  <code>
                    {execution.kind} · {execution.status} ·{' '}
                    {execution.revision.slice(0, 12)}
                  </code>
                  <p>{execution.summary ?? 'No execution summary supplied.'}</p>
                  <small>
                    {execution.policyArtifactIds.length} policies ·{' '}
                    {execution.gateArtifactIds.length} gates
                    {execution.completedAt
                      ? ` · Completed ${new Date(execution.completedAt).toLocaleString()}`
                      : execution.startedAt
                        ? ` · Started ${new Date(execution.startedAt).toLocaleString()}`
                        : ''}
                  </small>
                  <ExecutionEvidenceMetadata execution={execution} />
                  <ExecutionEvidenceCoverage execution={execution} />
                  <ExecutionLinkageEvidence execution={execution} />
                  <ExecutionEvidenceLinks execution={execution} />
                  <ExecutionGateEvidence
                    execution={execution}
                    artifacts={evidenceArtifacts}
                  />
                  <ExecutionThresholdEvidence execution={execution} />
                  <ExecutionSourceLink execution={execution} />
                </div>
              </article>
            ))}
            {!executions.length && (
              <div className="empty-state">
                <TestTube2 />
                <strong>No execution evidence received</strong>
                <span>
                  Connect CI or submit authenticated execution results for an
                  onboarded repository.
                </span>
              </div>
            )}
            {executionNextCursors && Object.keys(executionNextCursors).length > 0 && (
              <QualityAction
                intent="quiet"
                onClick={() => void loadMoreExecutions()}
                disabled={loadingMoreExecutions}
              >
                {loadingMoreExecutions ? <RefreshCw className="spin" size={14} /> : <ChevronRight size={14} />}
                Load more execution evidence
              </QualityAction>
            )}
            {executionPaginationError && (
              <p className="form-error" role="alert">{executionPaginationError}</p>
            )}
          </div>
        </section>
      )}
      {!loadingArtifacts && (
        <section className="catalog-panel">
          <header>
            <div>
              <p className="eyebrow">Policy–gate performance</p>
              <h2>Observed outcomes</h2>
              <p>
                Only explicitly linked execution evidence is included; an absent
                pair is never treated as passing. Continuation pages retain the
                execution state captured when this view loaded.
              </p>
            </div>
          </header>
          <div className="catalog-list">
            {executionPerformanceFailures.length > 0 && (
              <p className="form-error" role="alert">
                Policy-gate performance is temporarily unavailable for {executionPerformanceFailures.length}{' '}
                {executionPerformanceFailures.length === 1 ? 'repository' : 'repositories'}. Available execution evidence remains visible.
              </p>
            )}
            {executionPerformance.map(pair => (
              <article
                className="catalog-row"
                key={`${pair.repositoryId}:${pair.policyArtifactId}:${pair.gateArtifactId}`}
              >
                <div>
                  <small aria-label="Evidence repository">
                    {repositoryLabels.get(pair.repositoryId) ?? pair.repositoryId}
                  </small>
                  <strong>
                    {pair.policyTitle ?? pair.policyArtifactId} →{' '}
                    {pair.gateTitle ?? pair.gateArtifactId}
                  </strong>
                  <code>
                    {pair.passed} passed · {pair.failed} failed ·{' '}
                    {pair.cancelled} cancelled · {pair.running} running
                  </code>
                  <small>
                    {pair.latestCompletedAt
                      ? `Last completed ${new Date(pair.latestCompletedAt).toLocaleString()}`
                      : 'No completed run yet'}
                  </small>
                  {(pair.revisionCount ?? pair.revisions?.length ?? 0) > 0 ? (
                    <small title={pair.revisions?.join(', ') ?? pair.latestRevision}>
                      {(pair.revisionCount ?? pair.revisions?.length) === 1
                        ? `Source revision ${(pair.latestRevision ?? pair.revisions?.[0] ?? '').slice(0, 12)}`
                        : `Observed across ${pair.revisionCount ?? pair.revisions?.length} source revisions`}
                    </small>
                  ) : null}
                  {(pair.policySourcePath || pair.gateSourcePath) && (
                    <small>
                      {pair.policySourcePath ?? pair.policyArtifactId} →{' '}
                      {pair.gateSourcePath ?? pair.gateArtifactId}
                    </small>
                  )}
                </div>
              </article>
            ))}
            {!executionPerformance.length && (
              <div className="empty-state">
                <ShieldCheck />
                <strong>No linked performance yet</strong>
                <span>
                  Execution results will appear after a detected workflow
                  matches a policy-backed gate.
                </span>
              </div>
            )}
            {Object.keys(performanceNextCursors).length > 0 && (
              <QualityAction
                intent="quiet"
                onClick={() => void loadMorePerformance()}
                disabled={loadingMorePerformance}
              >
                {loadingMorePerformance ? <RefreshCw className="spin" size={14} /> : <ChevronRight size={14} />}
                Load more policy-gate performance
              </QualityAction>
            )}
            {performancePaginationError && (
              <p className="form-error" role="alert">{performancePaginationError}</p>
            )}
          </div>
        </section>
      )}
    </>
  )
}

function PageHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string
  title: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <header className="page-header compact">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lede">{detail}</p>
      </div>
      {action}
    </header>
  )
}

export function App({ getToken }: { getToken?: () => string | null } = {}) {
  const [view, setView] = useState<View>('overview')
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState<string>()
  const [organizations, setOrganizations] =
    useState<OrganizationQualitySummary[]>()
  const [loading, setLoading] = useState(true)
  const portalContext = usePortalContextKey()
  const embedded = Boolean(runtimeBridge()?.menu)
  const updateProcessingStatus = useCallback((status: import('@fuzequality/contracts').RepositoryProcessingStatus) => {
    setData(current => current ? {
      ...current,
      repositories: current.repositories.map(repository => applyRepositoryProcessingStatus(repository, status)),
    } : current)
  }, [])
  usePortalMenu(setView)
  const navigateToView = (nextView: View) => {
    navigatePortalView(nextView, embedded)
    setView(nextView)
  }
  // The portal owns the active account vault. A federated remote receives its
  // bearer-token resolver from the host rather than reading portal storage.
  useEffect(() => configurePlatformSecurity(getToken), [getToken])
  async function reload() {
    setLoading(true)
    setData(null)
    setOrganizations(undefined)
    setError(undefined)
    try {
      setData(await api.portfolio())
      setError(undefined)
      try {
        setOrganizations(await api.platformOrganizations())
      } catch {
        setOrganizations(undefined)
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void reload()
  }, [portalContext])
  const visibleNavigation = useMemo(
    () =>
      navigation.filter(item => item.id !== 'administration' || organizations),
    [organizations]
  )
  const active = useMemo(
    () => visibleNavigation.find(item => item.id === view),
    [view, visibleNavigation]
  )
  return (
    <div className={`app-shell${embedded ? ' portal-embedded' : ''}`}>
      {!embedded && <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>FuzeQuality</strong>
            <small>Evidence control</small>
          </div>
        </div>
        <nav>
          {visibleNavigation.map(item => {
            const Icon = item.icon
            const count =
              item.id === 'review'
                ? data?.suggestions.filter(s => s.state === 'proposed').length
                : undefined
            return (
              <button
                key={item.id}
                className={view === item.id ? 'active' : ''}
                onClick={() => navigateToView(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {count ? <b>{count}</b> : null}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <Database size={16} />
          <div>
            <span>Catalog revision</span>
            <strong>{data ? 'live / v1' : 'connecting'}</strong>
          </div>
        </div>
      </aside>}
      <main>
        {!embedded && <div className="topbar">
          <span>{active?.label}</span>
          <div>
            <span className="live-dot" /> default branches{' '}
            <button
              className="icon-button"
              onClick={() => reload()}
              aria-label="Reload"
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>}
        <div className="content">
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle />{' '}
              <div>
                <strong>Catalog API unavailable</strong>
                <span>{error}</span>
              </div>
              <QualityAction intent="secondary" onClick={() => void reload()}>
                Retry
              </QualityAction>
            </div>
          )}
          {!data ? (
            loading ? (
              <div className="loading-screen">
                <RefreshCw className="spin" />
                <span>Loading evidence graph…</span>
              </div>
            ) : null
          ) : (
            <>
              {view === 'overview' && (
                <Overview data={data} onNavigate={navigateToView} />
              )}
              {view === 'repositories' && (
                <Repositories data={data} reload={reload} updateProcessingStatus={updateProcessingStatus} />
              )}
              {view === 'api' && <ApiCatalogPage data={data} />}
              {view === 'frontend' && (
                <CatalogPage type="frontend" data={data} />
              )}
              {view === 'requirements' && <Requirements data={data} />}
              {view === 'intelligence' && (
                <RepositoryIntelligence data={data} />
              )}
              {view === 'review' && <ReviewQueue data={data} reload={reload} />}
              {view === 'operations' && <Operations data={data} />}
              {view === 'organization' && (
                <OrganizationSettings data={data} reload={reload} />
              )}
              {view === 'administration' && organizations && (
                <OrganizationAdministration organizations={organizations} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
