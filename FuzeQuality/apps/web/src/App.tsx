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
  TestSuiteDispatch,
  TestImplementationRequest,
} from '@fuzequality/contracts'
import {
  artifactWorkflowExecutionKind,
  executableWorkflowTarget,
  isPreferredWorkflowExecutionArtifact,
  preferredWorkflowExecutionKind,
} from '@fuzequality/contracts/workflow-execution'
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
import { QualityAction, QualityIconAction, QualityInput } from './components/primitives'
import {
  ExecutionEvidenceMetadata,
  ExecutionEvidenceLinks,
  ExecutionEvidenceCoverage,
  ExecutionLinkageEvidence,
  ExecutionGateEvidence,
  ExecutionThresholdEvidence,
  ExecutionSourceLink,
  canonicalWorkflowPath,
  durationMsLabel,
  latestIntegrationExecution,
  latestPerformanceExecution,
  latestPostProductionExecution,
} from './components/executionEvidence'
import { PolicyGateEvidence, policyGateArtifactReferenceProblems } from './components/governanceEvidence'
import { GovernanceInspector } from './components/governanceInspector'
import { ExecutionInspector } from './components/executionInspector'
import { FlowInventoryFilters, type FlowAnalysisRisk, type FlowRevisionScope } from './components/flowInventoryFilters'
import { FlowInspector, flowArtifactTargetIds, promptEvidenceLabel, unavailableFlowArtifactTargetIds } from './components/flowInspector'
import { RepositoryAnalysisStatus } from './components/repositoryAnalysisStatus'
import { RequirementFreshnessStatus } from './components/requirementFreshnessStatus'
import { MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS, historicalFlowEvidenceSelection } from './flowEvidence'
import { governanceEvidenceSelection } from './governanceEvidence'
import { applyRepositoryProcessingStatus, repositoryNeedsProcessingPoll, repositoryProcessingTransitionCompleted } from './repositoryProcessing'

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
      total: 0,
      passed: 0,
      failed: 0,
      cancelled: 0,
      running: 0,
      passRate: 0,
      durationSampleCount: 0,
      averageDurationMs: 0,
      maximumDurationMs: 0,
      retryAttemptCount: 0,
      successfulRetryCount: 0,
      recoveredRunCount: 0,
      evidenceCompleteCount: 0,
      evidencePartialCount: 0,
      evidenceUnavailableCount: 0,
      evidenceNotCollectedCount: 0,
      evidenceCollectionFailureCount: 0,
      invalidEvidenceUrlCount: 0,
      githubRunProvenanceMissingCount: 0,
      attemptProvenanceUnverifiedCount: 0,
      providerResultLimitedCount: 0,
      headRepositoryUnverifiedCount: 0,
      postProductionVideoMissingCount: 0,
      terminalTimingMissingCount: 0,
      gateEvaluationCount: 0,
      gatePassedCount: 0,
      gateFailedCount: 0,
      gateCancelledCount: 0,
      gateRunningCount: 0,
      gateUnevaluatedExecutionCount: 0,
      thresholdEvaluationCount: 0,
      thresholdPassedCount: 0,
      thresholdFailedCount: 0,
      performanceExecutionWithoutThresholdCount: 0,
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
    current.total += item.total ?? (item.passed + item.failed + item.cancelled + item.running)
    const terminalOutcomes = current.passed + current.failed + current.cancelled
    current.passRate = terminalOutcomes ? current.passed / terminalOutcomes : 0
    current.durationSampleCount += itemDurationSampleCount
    current.averageDurationMs = current.durationSampleCount
      ? Math.round(combinedDurationMs / current.durationSampleCount)
      : 0
    current.maximumDurationMs = Math.max(current.maximumDurationMs, item.maximumDurationMs ?? 0)
    current.retryAttemptCount += item.retryAttemptCount ?? 0
    current.successfulRetryCount += item.successfulRetryCount ?? 0
    current.recoveredRunCount += item.recoveredRunCount ?? 0
    current.evidenceCompleteCount = (current.evidenceCompleteCount ?? 0) + (item.evidenceCompleteCount ?? 0)
    current.evidencePartialCount = (current.evidencePartialCount ?? 0) + (item.evidencePartialCount ?? 0)
    current.evidenceUnavailableCount = (current.evidenceUnavailableCount ?? 0) + (item.evidenceUnavailableCount ?? 0)
    current.evidenceNotCollectedCount = (current.evidenceNotCollectedCount ?? 0) + (item.evidenceNotCollectedCount ?? 0)
    current.evidenceCollectionFailureCount = (current.evidenceCollectionFailureCount ?? 0) + (item.evidenceCollectionFailureCount ?? 0)
    current.invalidEvidenceUrlCount = (current.invalidEvidenceUrlCount ?? 0) + (item.invalidEvidenceUrlCount ?? 0)
    current.githubRunProvenanceMissingCount = (current.githubRunProvenanceMissingCount ?? 0) + (item.githubRunProvenanceMissingCount ?? 0)
    current.attemptProvenanceUnverifiedCount = (current.attemptProvenanceUnverifiedCount ?? 0) + (item.attemptProvenanceUnverifiedCount ?? 0)
    current.providerResultLimitedCount = (current.providerResultLimitedCount ?? 0) + (item.providerResultLimitedCount ?? 0)
    current.headRepositoryUnverifiedCount = (current.headRepositoryUnverifiedCount ?? 0) + (item.headRepositoryUnverifiedCount ?? 0)
    current.postProductionVideoMissingCount = (current.postProductionVideoMissingCount ?? 0) + (item.postProductionVideoMissingCount ?? 0)
    current.terminalTimingMissingCount = (current.terminalTimingMissingCount ?? 0) + (item.terminalTimingMissingCount ?? 0)
    current.gateEvaluationCount = (current.gateEvaluationCount ?? 0) + (item.gateEvaluationCount ?? 0)
    current.gatePassedCount = (current.gatePassedCount ?? 0) + (item.gatePassedCount ?? 0)
    current.gateFailedCount = (current.gateFailedCount ?? 0) + (item.gateFailedCount ?? 0)
    current.gateCancelledCount = (current.gateCancelledCount ?? 0) + (item.gateCancelledCount ?? 0)
    current.gateRunningCount = (current.gateRunningCount ?? 0) + (item.gateRunningCount ?? 0)
    current.gateUnevaluatedExecutionCount = (current.gateUnevaluatedExecutionCount ?? 0) + (item.gateUnevaluatedExecutionCount ?? 0)
    current.thresholdEvaluationCount = (current.thresholdEvaluationCount ?? 0) + (item.thresholdEvaluationCount ?? 0)
    current.thresholdPassedCount = (current.thresholdPassedCount ?? 0) + (item.thresholdPassedCount ?? 0)
    current.thresholdFailedCount = (current.thresholdFailedCount ?? 0) + (item.thresholdFailedCount ?? 0)
    current.performanceExecutionWithoutThresholdCount = (current.performanceExecutionWithoutThresholdCount ?? 0) + (item.performanceExecutionWithoutThresholdCount ?? 0)
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
  const [analysisRetryErrors, setAnalysisRetryErrors] = useState<Record<string, string>>({})
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
  const processingStateKey = data.repositories
    .filter(repositoryNeedsProcessingPoll)
    .map(repository => `${repository.id}:${repository.lastScanStatus}:${repository.lastScanRevision ?? ''}:${repository.lastAnalysis?.status ?? ''}`)
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
        if (results.some(result => {
          if (result.status !== 'fulfilled') return false
          const repository = data.repositories.find(item => item.id === result.value.id)
          return repository ? repositoryProcessingTransitionCompleted(repository, result.value) : false
        })) await reload()
      }
      refreshing = false
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 3_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [processingRepositoryIds, processingStateKey, reload, updateProcessingStatus])
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
    setAnalysisRetryErrors(current => ({ ...current, [id]: '' }))
    try {
      updateProcessingStatus(await api.retryRepositoryAnalysis(id))
    } catch (cause) {
      setAnalysisRetryErrors(current => ({
        ...current,
        [id]: cause instanceof Error ? cause.message : 'Reviewed analysis could not be requeued',
      }))
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
              {analysisRetryErrors[repository.id] && (
                <p className="form-error" role="alert">
                  {analysisRetryErrors[repository.id]}
                </p>
              )}
              {repository.lastScanStatus === 'failed' && repository.lastScanFailure && (
                <p className="form-error" role="alert">
                  {repository.lastScanFailure.message}
                </p>
              )}
              {repository.lastScanDetails?.partial && (
                <p className="scan-partial-warning" role="status">
                  <AlertTriangle size={14} /> This inventory is partial. Reviewed flow and policy analysis may omit repository evidence; narrow the scan scope and rescan for complete results.
                </p>
              )}
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
  const [freshness, setFreshness] = useState<import('@fuzequality/contracts').SyncCursor>({
    sourceType: 'jira',
    sourceKey: 'default',
    freshnessStatus: 'unknown',
  })
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string>()
  useEffect(() => {
    api
      .requirementFreshness()
      .then(setFreshness)
      .catch(() => setFreshness({ sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'failed' }))
  }, [])
  const retry = async () => {
    setRetrying(true)
    setRetryError(undefined)
    try {
      const result = await api.syncRequirements()
      setFreshness(result.sync)
    } catch (error) {
      if (error instanceof CatalogApiError && error.code === 'REQUIREMENT_QUEUE_UNAVAILABLE') {
        setFreshness(current => ({
          ...current,
          freshnessStatus: 'failed',
          failureCode: 'REQUIREMENT_QUEUE_UNAVAILABLE',
        }))
      }
      setRetryError(error instanceof Error ? error.message : 'Requirement analysis could not be queued.')
    } finally {
      setRetrying(false)
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Product intent"
        title="Requirements & inferred flows"
        detail="Jira stays authoritative. AI proposals remain visibly separate until reviewed."
        action={
          <RequirementFreshnessStatus sync={freshness} onRetry={() => void retry()} retrying={retrying} retryError={retryError} />
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
                {repository.lastScanFailure && (
                  <p className="form-error" role="alert">
                    {repository.lastScanFailure.message} ({repository.lastScanFailure.code})
                  </p>
                )}
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
        ownership: team ? { team, contact: contact || undefined } : null,
        jiraBindings: jiraProject
          ? [
              {
                project: jiraProject.toUpperCase(),
                component: jiraComponent || undefined,
              },
            ]
          : [],
        storybookBaseUrl: storybookBaseUrl || null,
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
      setMembers(result)
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
  const initialHistoryLoaded = useRef(false)
  const historyRequest = useRef(0)

  const loadHistory = useCallback(async (cursor?: string) => {
    if (historyRequestInFlight.current) return
    if (!cursor) initialHistoryLoaded.current = true
    const request = ++historyRequest.current
    historyRequestInFlight.current = true
    setLoading(true)
    setError(undefined)
    try {
      const page = normalizeHistoryPage(
        await api.repositoryFlowReviewHistory(flow.repositoryId, flow.id, cursor)
      )
      if (request !== historyRequest.current) return
      setHistory(current => cursor
        ? [...new Map([...current, ...page.items].map(entry => [entry.id, entry])).values()]
        : page.items)
      setNextCursor(page.page.nextCursor)
    } catch (cause) {
      if (request === historyRequest.current) {
        if (!cursor) initialHistoryLoaded.current = false
        setError(
          cause instanceof Error ? cause.message : 'Unable to load review history'
        )
      }
    } finally {
      if (request === historyRequest.current) {
        historyRequestInFlight.current = false
        setLoading(false)
      }
    }
  }, [flow.id, flow.repositoryId])

  useEffect(() => {
    historyRequest.current++
    historyRequestInFlight.current = false
    initialHistoryLoaded.current = false
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
        if (event.currentTarget.open && !initialHistoryLoaded.current && !loading)
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

function DispatchExecutionResult({ dispatch }: { dispatch: TestSuiteDispatch }) {
  if (dispatch.executionResult) {
    const recordedVideo = dispatch.executionResult.evidenceLinks?.find(link => link.kind === 'video')
    const evidenceCollection = dispatch.executionResult.evidenceCollection
    return (
      <p className="performance-inventory-only">
        Observed execution · {dispatch.executionResult.status} · attempt {dispatch.executionResult.attempt}
        {dispatch.executionResult.sourceUrl ? (
          <> · <a href={dispatch.executionResult.sourceUrl} target="_blank" rel="noreferrer">Open CI run</a></>
        ) : null}
        {recordedVideo ? (
          <> · <a href={recordedVideo.url} target="_blank" rel="noreferrer">Open recorded video</a></>
        ) : null}
        {evidenceCollection?.status === 'unavailable' ? (
          <> · Evidence collection unavailable{evidenceCollection.errorCode ? ` · ${evidenceCollection.errorCode}` : ''}</>
        ) : evidenceCollection?.status === 'partial' ? (
          <> · Evidence collection partial</>
        ) : dispatch.artifactKind === 'post-production-test' && evidenceCollection?.status === 'complete' && !recordedVideo ? (
          <> · No recorded video retained</>
        ) : null}
      </p>
    )
  }
  return dispatch.status === 'accepted' ? (
    <p className="performance-inventory-only">Awaiting an onboarded-repository execution started during this dispatch request window for the exact revision and ref.</p>
  ) : null
}

function TestSuiteDispatchHistory({
  repositoryId,
  artifactReference,
  latestDispatch,
}: {
  repositoryId: string
  artifactReference: string
  latestDispatch: TestSuiteDispatch
}) {
  const [history, setHistory] = useState<TestSuiteDispatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const requestRef = useRef(0)
  const requestInFlight = useRef(false)
  const initialHistoryLoaded = useRef(false)

  const loadHistory = useCallback(async (cursor?: string) => {
    if (requestInFlight.current) return
    if (!cursor) initialHistoryLoaded.current = true
    const request = ++requestRef.current
    requestInFlight.current = true
    setLoading(true)
    setError(undefined)
    try {
      const page = await api.testSuiteDispatchHistory(
        repositoryId,
        artifactReference,
        cursor,
      )
      if (request !== requestRef.current) return
      setHistory(current => cursor
        ? [...new Map([...current, ...page.items].map(item => [item.id, item])).values()]
        : page.items)
      setNextCursor(page.page.nextCursor)
    } catch (cause) {
      if (request === requestRef.current) {
        if (!cursor) initialHistoryLoaded.current = false
        setError(cause instanceof Error ? cause.message : 'Unable to load dispatch history')
      }
    } finally {
      if (request === requestRef.current) {
        requestInFlight.current = false
        setLoading(false)
      }
    }
  }, [artifactReference, repositoryId])

  useEffect(() => {
    requestRef.current++
    requestInFlight.current = false
    initialHistoryLoaded.current = false
    setHistory([])
    setNextCursor(null)
    setError(undefined)
    if (detailsRef.current?.open) void loadHistory()
  }, [latestDispatch.id, loadHistory])

  return (
    <details
      ref={detailsRef}
      className="policy-review-history"
      onToggle={event => {
        if (event.currentTarget.open && !initialHistoryLoaded.current && !loading) void loadHistory()
      }}
    >
      <summary>Controlled dispatch history</summary>
      <small>Audit records retain reviewed input names, never their values.</small>
      {loading && !history.length ? (
        <small>Loading dispatches…</small>
      ) : error ? (
        <small className="policy-review-error" role="alert">{error}</small>
      ) : history.length ? (
        <>
          <ol>
            {history.map(dispatch => (
              <li key={dispatch.id}>
                <span className={`status-pill severity-${dispatch.status === 'accepted' ? 'low' : dispatch.status === 'failed' ? 'high' : 'medium'}`}>
                  {dispatch.status}
                </span>
                <strong>{dispatch.sourceRevision.slice(0, 12)}</strong>
                <time dateTime={dispatch.requestedAt}>{new Date(dispatch.requestedAt).toLocaleString()}</time>
                <p>
                  Requested by {dispatch.requestedBy}
                  {dispatch.inputNames.length
                    ? ` · reviewed inputs: ${dispatch.inputNames.join(', ')}`
                    : ' · no workflow inputs'}
                  {dispatch.error ? ` · ${dispatch.error}` : ''}
                </p>
                <DispatchExecutionResult dispatch={dispatch} />
              </li>
            ))}
          </ol>
          {nextCursor && (
            <QualityAction intent="quiet" disabled={loading} onClick={() => void loadHistory(nextCursor)}>
              <ChevronRight size={14} /> Load more controlled dispatches
            </QualityAction>
          )}
        </>
      ) : (
        <small>No controlled dispatches recorded.</small>
      )}
    </details>
  )
}

export function FlowReviewControls({
  flow,
  currentRevision,
  knownArtifactIds = [],
  evidenceVerification,
  onReview,
}: {
  flow: RepositoryFlowCandidate
  currentRevision?: string
  knownArtifactIds?: Iterable<string>
  evidenceVerification?: 'loading' | 'ready' | 'unavailable'
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
  const grounding = flow.analysis?.grounding
  const hasGroundingGaps = Boolean(
    grounding &&
      (grounding.rejectedArtifactCount > 0 || grounding.ungroundedStepCount > 0)
  )
  const hasPromptCoverageGaps = flow.source === 'litellm' && flow.analysis?.promptTruncated === true
  const analysisRationaleMissing = (hasGroundingGaps || hasPromptCoverageGaps) && reason.trim().length < 3
  const analysisProvenanceMissing = flow.source === 'litellm' && !flow.analysis
  const wireframeMissing = flow.wireframe.nodes.length === 0
  const unavailableTargetIds = evidenceVerification !== 'loading' && evidenceVerification !== 'unavailable'
    ? unavailableFlowArtifactTargetIds(flow, knownArtifactIds)
    : []
  const evidenceVerificationBlocked = evidenceVerification === 'loading' || evidenceVerification === 'unavailable'

  useEffect(() => {
    setStale(false)
    setError(undefined)
  }, [flow.id, flow.revision, flow.reviewedAt])

  const submit = async (status: 'confirmed' | 'rejected') => {
    setBusy(true)
    setError(undefined)
    try {
      await onReview(flow, status, reason.trim() || undefined)
      setReason('')
    } catch (cause) {
      if (
        cause instanceof CatalogApiError &&
        ['STALE_FLOW_CANDIDATE', 'STALE_FLOW_REVIEW'].includes(cause.code ?? '')
      ) {
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
      <div className="flow-review-controls">
        {flow.status !== 'proposed' && (
          <p className="performance-inventory-only" role="status">
            This decision can be revised. Every saved decision remains in the
            immutable review history.
          </p>
        )}
        {!isCurrentRevision && (
          <p className="form-error" role="status">
            Historical proposal — review is locked until repository analysis
            produces a candidate for the current revision.
          </p>
        )}
        <label>
          {hasGroundingGaps || hasPromptCoverageGaps
            ? 'Review rationale required for analysis gaps'
            : 'Optional review rationale'}
          <input
            value={reason}
            disabled={!isReviewable || busy}
            onChange={event => setReason(event.target.value)}
            placeholder="Why is this flow accurate or unsuitable?"
          />
        </label>
        {(hasGroundingGaps || hasPromptCoverageGaps) && (
          <p className="performance-inventory-only" role="status">
            {hasGroundingGaps && hasPromptCoverageGaps
              ? 'LiteLLM returned unverified repository references and used bounded prompt evidence.'
              : hasGroundingGaps
                ? 'LiteLLM returned unverified repository references.'
                : 'LiteLLM used bounded prompt evidence because repository artifacts or source content were omitted.'}{' '}
            Confirmation requires a reviewer rationale; rejection remains available.
          </p>
        )}
        {analysisProvenanceMissing && (
          <p className="form-error" role="alert">
            Confirmation is blocked because this FuzeInfra LiteLLM proposal has no stored model, prompt, and schema provenance. Reject it or regenerate repository analysis.
          </p>
        )}
        {wireframeMissing && (
          <p className="form-error" role="alert">
            Confirmation is blocked because this flow has no reviewable wireframe. Reject this proposal or regenerate repository analysis.
          </p>
        )}
        {evidenceVerification === 'loading' && (
          <p className="performance-inventory-only" role="status">
            Verifying UX-flow evidence for this exact repository revision before confirmation.
          </p>
        )}
        {evidenceVerification === 'unavailable' && (
          <p className="form-error" role="alert">
            Confirmation is blocked because exact-revision UX-flow evidence could not be verified. Reject this proposal or retry after repository evidence is available.
          </p>
        )}
        {unavailableTargetIds.length > 0 && (
          <p className="form-error" role="alert">
            Confirmation is blocked because {unavailableTargetIds.length} artifact reference {unavailableTargetIds.length === 1 ? 'is' : 'are'} unavailable in this exact repository revision. Reject this proposal or regenerate repository analysis.
          </p>
        )}
        <div className="row-actions">
          <QualityAction
            intent="secondary"
            disabled={busy || !isReviewable || analysisRationaleMissing || analysisProvenanceMissing || wireframeMissing || evidenceVerificationBlocked || unavailableTargetIds.length > 0}
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
  const historyRequest = useRef(0)

  const loadHistory = useCallback(async (cursor?: string) => {
    if (historyRequestInFlight.current) return
    const request = ++historyRequest.current
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
      if (request !== historyRequest.current) return
      setHistory(current => cursor
        ? [...new Map([...current, ...page.items].map(entry => [entry.id, entry])).values()]
        : page.items)
      setNextCursor(page.page.nextCursor)
    } catch (cause) {
      if (request === historyRequest.current) {
        setError(
          cause instanceof Error ? cause.message : 'Unable to load review history'
        )
      }
    } finally {
      if (request === historyRequest.current) {
        historyRequestInFlight.current = false
        setLoading(false)
      }
    }
  }, [evaluation.id, evaluation.repositoryId])

  useEffect(() => {
    historyRequest.current++
    historyRequestInFlight.current = false
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

export function PolicyGateReviewControls({
  evaluation,
  currentRevision,
  evidenceArtifacts,
  evidenceVerification,
  onReview,
}: {
  evaluation: PolicyGateEvaluation
  currentRevision?: string
  evidenceArtifacts?: QualityArtifact[]
  evidenceVerification?: 'loading' | 'ready' | 'unavailable'
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
  const requiresAcceptanceRationale = evaluation.kind !== 'guarded-policy'
  const acceptanceRationaleMissing =
    requiresAcceptanceRationale && reason.trim().length < 3
  const unavailableEvidenceIds = evidenceVerification !== 'loading' && evidenceVerification !== 'unavailable' && evidenceArtifacts
    ? policyGateArtifactReferenceProblems(evaluation, evidenceArtifacts)
    : []
  const evidenceVerificationBlocked = evidenceVerification === 'loading' || evidenceVerification === 'unavailable'

  useEffect(() => {
    setStale(false)
    setError(undefined)
  }, [evaluation.id, evaluation.revision, evaluation.reviewedAt])

  const submit = async (status: 'accepted' | 'dismissed') => {
    setBusy(true)
    setError(undefined)
    try {
      await onReview(evaluation, status, reason.trim() || undefined)
      setReason('')
    } catch (cause) {
      if (
        cause instanceof CatalogApiError &&
        ['STALE_POLICY_GATE_EVALUATION', 'STALE_POLICY_GATE_REVIEW'].includes(cause.code ?? '')
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
      <div className="flow-review-controls">
          {evaluation.reviewStatus !== 'proposed' && (
            <p className="flow-review-guidance" role="status">
              This governance decision can be revised. Every saved decision remains in the immutable review history.
            </p>
          )}
          {!isCurrentRevision && (
            <p className="form-error" role="status">
              Historical governance finding — review is locked until repository
              analysis produces a finding for the current revision.
            </p>
          )}
          <label>
            {requiresAcceptanceRationale
              ? 'Governance rationale required to accept anomaly'
              : 'Optional governance rationale'}
            <input
              value={reason}
              disabled={!isReviewable || busy}
              onChange={event => setReason(event.target.value)}
              placeholder="Why should this recommendation be accepted or dismissed?"
            />
          </label>
          {requiresAcceptanceRationale && (
            <p className="flow-review-guidance" role="status">
              Accepting this anomaly creates reviewed remediation evidence and requires a rationale. Dismissal remains available.
            </p>
          )}
          {evidenceVerification === 'loading' && (
            <p className="flow-review-guidance" role="status">
              Verifying policy and gate evidence for this exact repository revision before acceptance.
            </p>
          )}
          {evidenceVerification === 'unavailable' && (
            <p className="form-error" role="alert">
              Acceptance is blocked because exact-revision policy and gate evidence could not be verified. Dismiss this recommendation or retry after repository evidence is available.
            </p>
          )}
          {unavailableEvidenceIds.length > 0 && (
            <p className="form-error" role="alert">
              Acceptance is blocked because {unavailableEvidenceIds.length} policy/gate evidence reference {unavailableEvidenceIds.length === 1 ? 'is' : 'are'} unavailable or mismatched in this exact repository revision. Dismiss this recommendation or regenerate repository analysis.
            </p>
          )}
          <div className="row-actions">
            <QualityAction
              intent="secondary"
              disabled={busy || !isReviewable || acceptanceRationaleMissing || evidenceVerificationBlocked || unavailableEvidenceIds.length > 0}
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
      <PolicyGateReviewHistory evaluation={evaluation} />
    </>
  )
}

type FlowInventorySelection = {
  repositoryId: string
  source: RepositoryFlowCandidate['source'] | ''
  status: RepositoryFlowCandidate['status'] | ''
  revisionScope: FlowRevisionScope
  targetId: string
  model: string
  promptVersion: string
  schemaVersion: string
  analysisRisk: FlowAnalysisRisk | ''
  minimumConfidencePercent: string
  maximumConfidencePercent: string
}

type PolicyGateInventorySelection = {
  kind: PolicyGateEvaluation['kind'] | ''
  remediationAction: PolicyGateEvaluation['remediationAction'] | ''
  severity: PolicyGateEvaluation['severity'] | ''
  reviewStatus: PolicyGateEvaluation['reviewStatus'] | ''
  revisionScope: FlowRevisionScope
  subject: string
  sourcePath: string
  policyArtifactId: string
  gateArtifactId: string
  minimumConfidencePercent: string
  maximumConfidencePercent: string
}

type HistoryPage<T> = { items: T[]; page: { nextCursor: string | null; hasMore: boolean } }

/** Keep optional evidence endpoints from taking down the inventory on malformed data. */
export function normalizeItemList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter((item): item is T => item != null)
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { items?: unknown }).items)
  ) {
    return (value as { items: T[] }).items.filter((item): item is T => item != null)
  }
  return []
}

export function normalizeHistoryPage<T>(value: T[] | HistoryPage<T>): HistoryPage<T> {
  return Array.isArray(value)
    ? { items: value, page: { nextCursor: null, hasMore: false } }
    : value
}

/**
 * A dispatch is enabled only after every bounded audit page has been checked.
 * Fail closed on a malformed cursor or an unexpectedly deep repository rather
 * than silently treating an omitted prior dispatch as safe to repeat.
 */
export async function loadLatestTestSuiteDispatches(
  repositoryId: string,
  maximumPages = 100,
): Promise<TestSuiteDispatch[]> {
  const dispatches = new Map<string, TestSuiteDispatch>()
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber++) {
    const result = await api.latestTestSuiteDispatches(repositoryId, cursor)
    const page: HistoryPage<TestSuiteDispatch> = 'page' in result
      ? result
      : { items: result.items, page: { nextCursor: null, hasMore: false } }
    page.items.forEach(dispatch => dispatches.set(dispatch.artifactLogicalId, dispatch))
    if (!page.page.hasMore) return [...dispatches.values()]
    if (!page.page.nextCursor || page.page.nextCursor === cursor) {
      throw new Error('Controlled-dispatch audit returned an invalid continuation cursor')
    }
    cursor = page.page.nextCursor
  }
  throw new Error(`Controlled-dispatch audit exceeds the safe ${maximumPages}-page verification limit`)
}

function hasRetainedFailureBefore(
  execution: TestExecution,
  history: TestExecution[],
) {
  return execution.attempt > 1 && execution.status === 'passed' && history.some(previous =>
    previous.repositoryId === execution.repositoryId &&
    previous.provider === execution.provider &&
    previous.externalRunId === execution.externalRunId &&
    previous.attempt < execution.attempt &&
    previous.status === 'failed'
  )
}

function ExecutionAttemptHistory({ execution }: { execution: TestExecution }) {
  const [attempts, setAttempts] = useState<TestExecution[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const requestInFlight = useRef(false)
  const requestVersion = useRef(0)

  const loadAttempts = useCallback(async (cursor?: string) => {
    if (requestInFlight.current) return
    const request = ++requestVersion.current
    requestInFlight.current = true
    setLoading(true)
    setError(undefined)
    try {
      const page = normalizeHistoryPage(await api.testExecutionAttempts(
        execution.repositoryId,
        execution.provider,
        execution.externalRunId,
        cursor,
      ))
      if (request !== requestVersion.current) return
      setAttempts(current => cursor
        ? [...new Map([...current, ...page.items].map(item => [item.id, item])).values()]
        : page.items)
      setNextCursor(page.page.nextCursor)
    } catch (cause) {
      if (request === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to load attempt history')
      }
    } finally {
      if (request === requestVersion.current) {
        requestInFlight.current = false
        setLoading(false)
      }
    }
  }, [execution.externalRunId, execution.provider, execution.repositoryId])

  useEffect(() => {
    requestVersion.current++
    requestInFlight.current = false
    setAttempts([])
    setNextCursor(null)
    setError(undefined)
  }, [execution.externalRunId, execution.provider, execution.repositoryId])

  return (
    <details
      className="policy-review-history"
      onToggle={event => {
        if (event.currentTarget.open && !attempts.length && !loading) void loadAttempts()
      }}
    >
      <summary>Attempt history</summary>
      <small>{execution.provider} run {execution.externalRunId}</small>
      <small>
        Each attempt retains its first terminal outcome; provider reruns are separate attempts.
      </small>
      {loading && !attempts.length ? (
        <small>Loading attempts…</small>
      ) : error ? (
        <small className="policy-review-error">{error}</small>
      ) : attempts.length ? (
        <>
          <ol>
            {attempts.map(attempt => (
              <li key={attempt.id}>
                <span className={`status-pill status-${attempt.status}`}>
                  {attempt.status}
                </span>
                <strong>Attempt {attempt.attempt}</strong>
                <time dateTime={attempt.completedAt ?? attempt.startedAt}>
                  {attempt.completedAt || attempt.startedAt
                    ? new Date(attempt.completedAt ?? attempt.startedAt ?? '').toLocaleString()
                    : 'Time unavailable'}
                </time>
                {hasRetainedFailureBefore(attempt, attempts) && (
                  <p>Recovered after retained failure evidence.</p>
                )}
              </li>
            ))}
          </ol>
          {nextCursor && (
            <QualityAction
              intent="quiet"
              disabled={loading}
              onClick={() => void loadAttempts(nextCursor)}
            >
              <ChevronRight size={14} /> Load more attempts
            </QualityAction>
          )}
        </>
      ) : (
        <small>No attempt evidence retained for this provider run.</small>
      )}
    </details>
  )
}

export function policyGateEvaluationMatchesInventory(
  evaluation: PolicyGateEvaluation,
  repositories: Repository[],
  selection: PolicyGateInventorySelection
) {
  const normalizedSubject = selection.subject.toLowerCase()
  if (selection.kind && evaluation.kind !== selection.kind) return false
  if (selection.remediationAction && evaluation.remediationAction !== selection.remediationAction) return false
  if (selection.severity && evaluation.severity !== selection.severity)
    return false
  if (
    selection.reviewStatus &&
    evaluation.reviewStatus !== selection.reviewStatus
  )
    return false
  if (
    normalizedSubject &&
    !evaluation.scope.subjects.some(subject =>
      subject.toLowerCase() === normalizedSubject
    )
  )
    return false
  if (selection.sourcePath && !evaluation.scope.sourcePaths.includes(selection.sourcePath)) return false
  if (selection.policyArtifactId && !evaluation.policyArtifactIds.includes(selection.policyArtifactId)) return false
  if (selection.gateArtifactId && !evaluation.gateArtifactIds.includes(selection.gateArtifactId)) return false
  if (selection.minimumConfidencePercent !== '' && evaluation.confidence < Number(selection.minimumConfidencePercent) / 100) return false
  if (selection.maximumConfidencePercent !== '' && evaluation.confidence > Number(selection.maximumConfidencePercent) / 100) return false
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
  if (selection.targetId && !(
    flow.evidence.includes(selection.targetId) ||
    flow.steps.some(step => step.targetIds.includes(selection.targetId)) ||
    flow.wireframe.nodes.some(node => node.targetIds.includes(selection.targetId))
  )) return false
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
  if (selection.analysisRisk === 'grounding-gaps' && !(
    flow.source === 'litellm' && flow.analysis?.grounding && (
      flow.analysis.grounding.rejectedArtifactCount > 0 ||
      flow.analysis.grounding.ungroundedStepCount > 0
    )
  )) return false
  if (selection.analysisRisk === 'prompt-truncated' && !(
    flow.source === 'litellm' && flow.analysis?.promptTruncated === true
  )) return false
  if (selection.analysisRisk === 'artifacts-omitted' && !(
    flow.source === 'litellm' && flow.analysis && (
      (flow.analysis.promptOmittedArtifactCount ?? Math.max(
        (flow.analysis.inputArtifactCount ?? 0) - (flow.analysis.promptArtifactCount ?? 0),
        0,
      )) > 0
    )
  )) return false
  if (selection.analysisRisk === 'content-truncated' && !(
    flow.source === 'litellm' && flow.analysis?.promptContentTruncated === true
  )) return false
  if (selection.analysisRisk === 'provenance-missing' && !(
    flow.source === 'litellm' && !flow.analysis
  )) return false
  if (selection.minimumConfidencePercent !== '' && flow.confidence < Number(selection.minimumConfidencePercent) / 100) return false
  if (selection.maximumConfidencePercent !== '' && flow.confidence > Number(selection.maximumConfidencePercent) / 100) return false
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
  const [governanceEvidenceLoading, setGovernanceEvidenceLoading] = useState(false)
  const [omittedGovernanceEvidenceRevisions, setOmittedGovernanceEvidenceRevisions] = useState(0)
  const [flowEvidenceArtifacts, setFlowEvidenceArtifacts] = useState<QualityArtifact[]>([])
  const [flowEvidenceFailureRepositories, setFlowEvidenceFailureRepositories] = useState<string[]>([])
  const [flowEvidenceLoadingRepositories, setFlowEvidenceLoadingRepositories] = useState<string[]>([])
  const [flowEvidenceReloadKey, setFlowEvidenceReloadKey] = useState(0)
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
  const [flowTargetId, setFlowTargetId] = useState('')
  const [flowModel, setFlowModel] = useState('')
  const [flowPromptVersion, setFlowPromptVersion] = useState('')
  const [flowSchemaVersion, setFlowSchemaVersion] = useState('')
  const [flowAnalysisRisk, setFlowAnalysisRisk] = useState<FlowAnalysisRisk | ''>('')
  const [flowMinimumConfidencePercent, setFlowMinimumConfidencePercent] = useState('')
  const [flowMaximumConfidencePercent, setFlowMaximumConfidencePercent] = useState('')
  const invalidFlowConfidenceRange = Boolean(
    flowMinimumConfidencePercent !== '' &&
    flowMaximumConfidencePercent !== '' &&
    Number(flowMinimumConfidencePercent) > Number(flowMaximumConfidencePercent)
  )
  const [flowInspectorOpen, setFlowInspectorOpen] = useState(false)
  const [inspectedFlow, setInspectedFlow] = useState<RepositoryFlowCandidate>()
  const [flowInspectorArtifacts, setFlowInspectorArtifacts] = useState<QualityArtifact[]>([])
  const [flowInspectorLoading, setFlowInspectorLoading] = useState(false)
  const [flowInspectorError, setFlowInspectorError] = useState<string>()
  const [flowInspectorEvidenceError, setFlowInspectorEvidenceError] = useState<string>()
  const flowInspectorRequest = useRef(0)
  const [policyGateEvaluations, setPolicyGateEvaluations] = useState<
    PolicyGateEvaluation[]
  >([])
  const [policyGateInspectorOpen, setPolicyGateInspectorOpen] = useState(false)
  const [inspectedPolicyGate, setInspectedPolicyGate] = useState<PolicyGateEvaluation>()
  const [policyGateInspectorArtifacts, setPolicyGateInspectorArtifacts] = useState<QualityArtifact[]>([])
  const [policyGateInspectorLoading, setPolicyGateInspectorLoading] = useState(false)
  const [policyGateInspectorError, setPolicyGateInspectorError] = useState<string>()
  const [policyGateInspectorEvidenceError, setPolicyGateInspectorEvidenceError] = useState<string>()
  const policyGateInspectorRequest = useRef(0)
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
  const [refreshingExecutionEvidenceId, setRefreshingExecutionEvidenceId] = useState<string>()
  const [executionEvidenceRefreshError, setExecutionEvidenceRefreshError] = useState<string>()
  const [executionEvidenceRefreshVersion, setExecutionEvidenceRefreshVersion] = useState(0)
  const [executionInspectorOpen, setExecutionInspectorOpen] = useState(false)
  const [inspectedExecution, setInspectedExecution] = useState<import('@fuzequality/contracts').TestExecutionDetail>()
  const [executionInspectorArtifacts, setExecutionInspectorArtifacts] = useState<QualityArtifact[]>([])
  const [executionInspectorLoading, setExecutionInspectorLoading] = useState(false)
  const [executionInspectorError, setExecutionInspectorError] = useState<string>()
  const [executionInspectorEvidenceError, setExecutionInspectorEvidenceError] = useState<string>()
  const executionInspectorRequest = useRef(0)
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
  const [executionEvidenceKind, setExecutionEvidenceKind] = useState<
    TestExecution['evidenceLinks'][number]['kind'] | ''
  >('')
  const [executionEvidenceCollectionStatus, setExecutionEvidenceCollectionStatus] = useState<
    NonNullable<TestExecution['evidenceCollection']>['status'] | 'not-collected' | ''
  >('')
  const [executionEvidenceCollectionErrorCode, setExecutionEvidenceCollectionErrorCode] = useState<
    NonNullable<TestExecution['evidenceCollection']>['errorCode'] | ''
  >('')
  const [executionEvidenceCheckedAfter, setExecutionEvidenceCheckedAfter] = useState('')
  const [executionEvidenceCheckedBefore, setExecutionEvidenceCheckedBefore] = useState('')
  const [executionEvidenceRequirement, setExecutionEvidenceRequirement] = useState<
    'evidence-url-invalid' | 'provider-collection-failure' | 'github-run-provenance-missing' | 'head-repository-unverified' | 'attempt-provenance-unverified' | 'policy-gate-outcome-missing' | 'post-production-video-missing' | 'performance-threshold-missing' | 'terminal-timing-missing' | ''
  >('')
  const [executionThresholdOutcome, setExecutionThresholdOutcome] = useState<
    'passed' | 'failed' | ''
  >('')
  const [executionGateOutcome, setExecutionGateOutcome] = useState<
    TestExecution['status'] | ''
  >('')
  const [executionExternalRunId, setExecutionExternalRunId] = useState('')
  const [executionName, setExecutionName] = useState('')
  const [executionPolicyArtifactId, setExecutionPolicyArtifactId] = useState('')
  const [executionGateArtifactId, setExecutionGateArtifactId] = useState('')
  const [executionAttemptScope, setExecutionAttemptScope] = useState<
    'initial' | 'retry' | 'recovered' | ''
  >('')
  const [executionBranch, setExecutionBranch] = useState('')
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
  const invalidEvidenceCheckedRange = Boolean(
    executionEvidenceCheckedAfter &&
    executionEvidenceCheckedBefore &&
    Date.parse(executionEvidenceCheckedAfter) > Date.parse(executionEvidenceCheckedBefore)
  )
  const [policyGateKind, setPolicyGateKind] = useState<
    PolicyGateEvaluation['kind'] | ''
  >('')
  const [policyGateSeverity, setPolicyGateSeverity] = useState<
    PolicyGateEvaluation['severity'] | ''
  >('')
  const [policyGateRemediationAction, setPolicyGateRemediationAction] = useState<
    PolicyGateEvaluation['remediationAction'] | ''
  >('')
  const [policyGateReviewStatus, setPolicyGateReviewStatus] = useState<
    PolicyGateEvaluation['reviewStatus'] | ''
  >('')
  const [policyGateRevisionScope, setPolicyGateRevisionScope] =
    useState<FlowRevisionScope>('current')
  const [policyGateSubject, setPolicyGateSubject] = useState('')
  const [policyGateSourcePath, setPolicyGateSourcePath] = useState('')
  const [policyGatePolicyArtifactId, setPolicyGatePolicyArtifactId] = useState('')
  const [policyGateGateArtifactId, setPolicyGateGateArtifactId] = useState('')
  const [policyGateMinimumConfidencePercent, setPolicyGateMinimumConfidencePercent] = useState('')
  const [policyGateMaximumConfidencePercent, setPolicyGateMaximumConfidencePercent] = useState('')
  const invalidPolicyGateConfidenceRange = Boolean(
    policyGateMinimumConfidencePercent !== '' &&
    policyGateMaximumConfidencePercent !== '' &&
    Number(policyGateMinimumConfidencePercent) > Number(policyGateMaximumConfidencePercent)
  )
  const policyGateSelection: PolicyGateInventorySelection = {
    kind: policyGateKind,
    remediationAction: policyGateRemediationAction,
    severity: policyGateSeverity,
    reviewStatus: policyGateReviewStatus,
    revisionScope: policyGateRevisionScope,
    subject: policyGateSubject.trim(),
    sourcePath: policyGateSourcePath.trim(),
    policyArtifactId: policyGatePolicyArtifactId.trim(),
    gateArtifactId: policyGateGateArtifactId.trim(),
    minimumConfidencePercent: policyGateMinimumConfidencePercent,
    maximumConfidencePercent: policyGateMaximumConfidencePercent,
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
  const [workflowDispatchInputs, setWorkflowDispatchInputs] = useState<
    Record<string, Record<string, string>>
  >({})
  const [performanceDispatch, setPerformanceDispatch] = useState<{
    artifactId: string
    state: 'success' | 'warning' | 'error'
    message: string
  }>()
  const [testSuiteDispatches, setTestSuiteDispatches] = useState<TestSuiteDispatch[]>([])
  const [testSuiteDispatchAuditStatus, setTestSuiteDispatchAuditStatus] = useState<
    Record<string, 'loading' | 'ready' | 'error'>
  >({})
  const [currentDispatchArtifacts, setCurrentDispatchArtifacts] = useState<QualityArtifact[]>([])
  const [verifiedDispatchRetirementRepositories, setVerifiedDispatchRetirementRepositories] = useState<string[]>([])
  const [dispatchRetirementFailures, setDispatchRetirementFailures] = useState<string[]>([])
  const [loadingArtifacts, setLoadingArtifacts] = useState(true)
  const [loadingFlows, setLoadingFlows] = useState(true)
  const [loadedFlowQuery, setLoadedFlowQuery] = useState('')
  const flowSelection: FlowInventorySelection = {
    repositoryId: flowRepositoryId,
    source: flowSource,
    status: flowStatus,
    revisionScope: flowRevisionScope,
    targetId: flowTargetId.trim(),
    model: flowModel.trim(),
    promptVersion: flowPromptVersion.trim(),
    schemaVersion: flowSchemaVersion.trim(),
    analysisRisk: flowAnalysisRisk,
    minimumConfidencePercent: flowMinimumConfidencePercent,
    maximumConfidencePercent: flowMaximumConfidencePercent,
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
    flowTargetId.trim(),
    flowModel.trim(),
    flowPromptVersion.trim(),
    flowSchemaVersion.trim(),
    flowAnalysisRisk,
    flowMinimumConfidencePercent,
    flowMaximumConfidencePercent,
  ])
  const flowQueryRef = useRef(flowQuery)
  flowQueryRef.current = flowQuery
  const flowResultsAreCurrent =
    !loadingFlows && loadedFlowQuery === flowQuery
  const inspectFlow = async (flow: RepositoryFlowCandidate) => {
    const request = ++flowInspectorRequest.current
    setFlowInspectorOpen(true)
    setInspectedFlow(undefined)
    setFlowInspectorArtifacts([])
    setFlowInspectorError(undefined)
    setFlowInspectorEvidenceError(undefined)
    setFlowInspectorLoading(true)
    try {
      const detail = await api.repositoryFlowCandidate(flow.repositoryId, flow.id)
      if (request !== flowInspectorRequest.current) return
      setInspectedFlow(detail)
      const evidenceIds = flowArtifactTargetIds(detail)
      if (evidenceIds.length) {
        try {
          const evidence = await api.qualityArtifactsByIdsBatched(
            detail.repositoryId,
            evidenceIds,
            detail.revision,
          )
          if (request === flowInspectorRequest.current) {
            setFlowInspectorArtifacts(evidence.items)
          }
        } catch (cause) {
          if (request === flowInspectorRequest.current) {
            setFlowInspectorEvidenceError(
              cause instanceof Error
                ? cause.message
                : 'Unable to load exact UX-flow evidence'
            )
          }
        }
      }
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
    setFlowInspectorArtifacts([])
    setFlowInspectorError(undefined)
    setFlowInspectorEvidenceError(undefined)
    setFlowInspectorLoading(false)
  }
  const inspectPolicyGate = async (evaluation: PolicyGateEvaluation) => {
    const request = ++policyGateInspectorRequest.current
    setPolicyGateInspectorOpen(true)
    setInspectedPolicyGate(undefined)
    setPolicyGateInspectorArtifacts([])
    setPolicyGateInspectorError(undefined)
    setPolicyGateInspectorEvidenceError(undefined)
    setPolicyGateInspectorLoading(true)
    try {
      const detail = await api.policyGateEvaluation(evaluation.repositoryId, evaluation.id)
      if (request !== policyGateInspectorRequest.current) return
      setInspectedPolicyGate(detail)
      const evidenceIds = [...new Set([
        ...detail.policyArtifactIds,
        ...detail.gateArtifactIds,
        ...(detail.evidencePassages ?? []).map(passage => passage.artifactId),
      ])]
      if (evidenceIds.length) {
        try {
          const evidence = await api.qualityArtifactsByIdsBatched(
            detail.repositoryId,
            evidenceIds,
            detail.revision,
          )
          if (request === policyGateInspectorRequest.current) {
            setPolicyGateInspectorArtifacts(evidence.items)
          }
        } catch (cause) {
          if (request === policyGateInspectorRequest.current) {
            setPolicyGateInspectorEvidenceError(
              cause instanceof Error
                ? cause.message
                : 'Unable to resolve governance source artifacts'
            )
          }
        }
      }
    } catch (cause) {
      if (request === policyGateInspectorRequest.current) {
        setPolicyGateInspectorError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load policy and gate evaluation detail'
        )
      }
    } finally {
      if (request === policyGateInspectorRequest.current) {
        setPolicyGateInspectorLoading(false)
      }
    }
  }
  const closePolicyGateInspector = () => {
    policyGateInspectorRequest.current++
    setPolicyGateInspectorOpen(false)
    setInspectedPolicyGate(undefined)
    setPolicyGateInspectorArtifacts([])
    setPolicyGateInspectorError(undefined)
    setPolicyGateInspectorEvidenceError(undefined)
    setPolicyGateInspectorLoading(false)
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
      reason,
      flow.reviewedAt ?? null
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
      reason,
      evaluation.reviewedAt ?? null
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
    setInspectedPolicyGate(current => current?.id === reviewed.id ? reviewed : current)
  }
  useEffect(() => {
    let active = true
    setTestSuiteDispatchAuditStatus(Object.fromEntries(
      data.repositories.map(repository => [repository.id, 'loading' as const])
    ))
    void Promise.allSettled(
      data.repositories.map(repository => loadLatestTestSuiteDispatches(repository.id))
    ).then(results => {
      if (!active) return
      setTestSuiteDispatches(results.flatMap(result =>
        result.status === 'fulfilled' ? result.value : []
      ))
      setTestSuiteDispatchAuditStatus(Object.fromEntries(
        data.repositories.map((repository, index) => [
          repository.id,
          results[index]?.status === 'fulfilled' ? 'ready' : 'error',
        ])
      ))
    })
    return () => { active = false }
  }, [data.repositories])

  const retryTestSuiteDispatchAudit = async (repositoryId: string) => {
    setTestSuiteDispatchAuditStatus(current => ({ ...current, [repositoryId]: 'loading' }))
    try {
      const result = await loadLatestTestSuiteDispatches(repositoryId)
      setTestSuiteDispatches(current => [
        ...current.filter(dispatch => dispatch.repositoryId !== repositoryId),
        ...result,
      ])
      setTestSuiteDispatchAuditStatus(current => ({ ...current, [repositoryId]: 'ready' }))
    } catch {
      setTestSuiteDispatchAuditStatus(current => ({ ...current, [repositoryId]: 'error' }))
    }
  }

  useEffect(() => {
    let active = true
    setCurrentDispatchArtifacts([])
    setVerifiedDispatchRetirementRepositories([])
    setDispatchRetirementFailures([])
    const requests = data.repositories.flatMap(repository => {
      if (testSuiteDispatchAuditStatus[repository.id] !== 'ready') return []
      const artifactIds = [...new Set(testSuiteDispatches
        .filter(dispatch => dispatch.repositoryId === repository.id)
        .map(dispatch => dispatch.artifactLogicalId))]
      if (!artifactIds.length) return []
      return [{ repositoryId: repository.id, revision: repository.lastScanRevision, artifactIds }]
    })
    if (!requests.length) return () => { active = false }
    void Promise.allSettled(requests.map(async request => {
      if (!request.revision) throw new Error('Current repository analysis is unavailable')
      return {
        repositoryId: request.repositoryId,
        response: await api.qualityArtifactsByIdsBatched(
          request.repositoryId,
          request.artifactIds,
          request.revision,
        ),
      }
    })).then(results => {
      if (!active) return
      const successful = results.flatMap(result =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      setCurrentDispatchArtifacts(successful.flatMap(result => result.response.items))
      setVerifiedDispatchRetirementRepositories(successful.map(result => result.repositoryId))
      setDispatchRetirementFailures(results.flatMap((result, index) =>
        result.status === 'rejected' ? [requests[index].repositoryId] : []
      ))
    })
    return () => { active = false }
  }, [data.repositories, testSuiteDispatches, testSuiteDispatchAuditStatus])

  const runTestSuite = async (artifact: QualityArtifact) => {
    const repository = data.repositories.find(
      candidate => candidate.id === artifact.repositoryId
    )
    const sourceRevision = repository
      ? analyzedSourceRevision(repository)
      : undefined
    if (!sourceRevision || !executableWorkflowTarget(artifact)) return
    const requiredInputs = artifact.execution?.requiredInputs ?? []
    const suppliedInputs = Object.fromEntries(
      requiredInputs.map(name => [name, workflowDispatchInputs[artifact.id]?.[name]?.trim() ?? ''])
    )
    if (requiredInputs.some(name => !suppliedInputs[name])) return
    if (
      !window.confirm(
        `Dispatch ${artifact.title} from ${repository?.defaultBranch ?? 'the analyzed branch'} at analyzed commit ${sourceRevision}${requiredInputs.length ? ` with reviewed inputs: ${requiredInputs.join(', ')}` : ''}?`
      )
    )
      return
    setDispatchingArtifact(artifact.id)
    setPerformanceDispatch(undefined)
    try {
      const receipt = requiredInputs.length
        ? await api.runTestSuite(artifact.repositoryId, artifact.id, suppliedInputs)
        : await api.runTestSuite(artifact.repositoryId, artifact.id)
      setPerformanceDispatch({
        artifactId: artifact.id,
        state: receipt.auditPersistence === 'persisted' ? 'success' : 'warning',
        message: receipt.auditPersistence === 'persisted'
          ? `Dispatched ${receipt.workflowPath} from ${receipt.ref} at analyzed commit ${receipt.sourceRevision}. GitHub Actions will report the run as execution evidence.`
          : `GitHub accepted ${receipt.workflowPath} at analyzed commit ${receipt.sourceRevision}, but FuzeQuality could not finalize the audit after retries. Do not dispatch it again; refresh after audit storage recovers.`,
      })
      setTestSuiteDispatches(current => [
        receipt.dispatch,
        ...current.filter(item =>
          item.repositoryId !== receipt.dispatch.repositoryId ||
          item.artifactId !== receipt.dispatch.artifactId
        ),
      ])
    } catch (error) {
      const failureAuditPending =
        error instanceof CatalogApiError && error.auditPersistence === 'pending'
      setPerformanceDispatch({
        artifactId: artifact.id,
        state: failureAuditPending ? 'warning' : 'error',
        message: failureAuditPending
          ? `Dispatch failed: ${error.message}. FuzeQuality could not finalize the failure audit after retries. Verify GitHub Actions before retrying.`
          : error instanceof Error
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
        evidenceKind: executionEvidenceKind,
        evidenceCollectionStatus: executionEvidenceCollectionStatus,
        evidenceCollectionErrorCode: executionEvidenceCollectionErrorCode,
        evidenceCheckedAfter: iso(executionEvidenceCheckedAfter),
        evidenceCheckedBefore: iso(executionEvidenceCheckedBefore),
        evidenceRequirement: executionEvidenceRequirement,
        thresholdOutcome: executionThresholdOutcome,
        gateOutcome: executionGateOutcome,
        externalRunId: executionExternalRunId.trim(),
        name: executionName.trim(),
        policyArtifactId: executionPolicyArtifactId,
        gateArtifactId: executionGateArtifactId,
        attemptScope: executionAttemptScope,
        branch: executionBranch.trim(),
        revision: executionRevision.trim(),
        workflowPath: canonicalWorkflowPath(executionWorkflowPath.trim()),
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
  }, [executionKind, executionStatus, executionProvider, executionEvidenceKind, executionEvidenceCollectionStatus, executionEvidenceCollectionErrorCode, executionEvidenceCheckedAfter, executionEvidenceCheckedBefore, executionEvidenceRequirement, executionThresholdOutcome, executionGateOutcome, executionExternalRunId, executionName, executionPolicyArtifactId, executionGateArtifactId, executionAttemptScope, executionBranch, executionRevision, executionWorkflowPath, executionMinimumDurationSeconds, executionMaximumDurationSeconds, executionFrom, executionUntil])
  const executionTrendQuery = JSON.stringify([
    data.repositories.map(repository => repository.id),
    executionRepositoryId,
    executionFilter,
    invalidExecutionRange,
    invalidExecutionDurationRange,
    invalidEvidenceCheckedRange,
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
          api.qualityArtifacts(repository.id, repository.lastScanRevision),
          invalidPolicyGateConfidenceRange ||
          (policyGateRevisionScope === 'current' && !repository.lastScanRevision)
            ? []
            : api.policyGateEvaluations(
                repository.id,
                Object.fromEntries(
                  Object.entries({
                    kind: policyGateKind,
                    remediationAction: policyGateRemediationAction,
                    severity: policyGateSeverity,
                    reviewStatus: policyGateReviewStatus,
                    revision:
                      policyGateRevisionScope === 'current'
                        ? repository.lastScanRevision ?? ''
                        : '',
                    subject: policyGateSubject.trim(),
                    sourcePath: policyGateSourcePath.trim(),
                    policyArtifactId: policyGatePolicyArtifactId.trim(),
                    gateArtifactId: policyGateGateArtifactId.trim(),
                    minConfidence: policyGateMinimumConfidencePercent === '' ? '' : String(Number(policyGateMinimumConfidencePercent) / 100),
                    maxConfidence: policyGateMaximumConfidencePercent === '' ? '' : String(Number(policyGateMaximumConfidencePercent) / 100),
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
    policyGateRemediationAction,
    policyGateRevisionScope,
    policyGateReviewStatus,
    policyGateSeverity,
    policyGateSubject,
    policyGateSourcePath,
    policyGatePolicyArtifactId,
    policyGateGateArtifactId,
    policyGateMinimumConfidencePercent,
    policyGateMaximumConfidencePercent,
    invalidPolicyGateConfidenceRange,
  ])
  useEffect(() => {
    let active = true
    const selection = governanceEvidenceSelection(
      policyGateEvaluations,
      data.repositories,
      policyGateRevisionScope,
    )
    setOmittedGovernanceEvidenceRevisions(selection.omittedHistoricalRevisions)
    const batches = selection.requests.flatMap(({ repositoryId, revision, artifactIds }) =>
      Array.from({ length: Math.ceil(artifactIds.length / 100) }, (_, index) => ({
        repositoryId,
        revision,
        artifactIds: artifactIds.slice(index * 100, (index + 1) * 100),
      }))
    )
    if (!batches.length) {
      setGovernanceEvidenceArtifacts([])
      setGovernanceEvidenceFailures([])
      setGovernanceEvidenceLoading(false)
      return () => { active = false }
    }
    setGovernanceEvidenceLoading(true)
    void Promise.allSettled(
      batches.map(batch => api.qualityArtifactsByIds(batch.repositoryId, batch.artifactIds, batch.revision))
    ).then(results => {
      if (!active) return
      setGovernanceEvidenceArtifacts(results.flatMap(result =>
        result.status === 'fulfilled' ? result.value.items : []
      ))
      setGovernanceEvidenceFailures([...new Set(results.flatMap((result, index) =>
        result.status === 'rejected' ? [batches[index].repositoryId] : []
      ))])
      setGovernanceEvidenceLoading(false)
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
      const results = await Promise.allSettled(cursors.map(async ([repositoryId, cursor]) => {
        const revision = data.repositories.find(repository => repository.id === repositoryId)?.lastScanRevision
        return {
          repositoryId,
          page: normalizeHistoryPage(await api.qualityArtifacts(repositoryId, revision, cursor)),
        }
      }))
      if (artifactQueryRef.current !== query) return
      const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      setArtifacts(current => [...new Map(
        [...current, ...groups.flatMap(group => group.page.items)].map(item => [item.id, item])
      ).values()])
      setArtifactNextCursors(current => {
        const next = { ...current }
        for (const group of groups) {
          if (group.page.page.nextCursor) next[group.repositoryId] = group.page.page.nextCursor
          else delete next[group.repositoryId]
        }
        return next
      })
      const failed = results.filter(result => result.status === 'rejected').length
      if (failed) {
        setArtifactPaginationError(
          `Unable to load more repository evidence for ${failed} ${failed === 1 ? 'repository' : 'repositories'}. Successful evidence remains visible.`
        )
      }
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
    setLoadingMoreFlows(false)
    setFlowNextCursors({})
    setRepositoryFlowFailures([])
    setHistoryPaginationError(undefined)
    if (invalidFlowConfidenceRange) {
      setFlowCandidates([])
      setLoadedFlowQuery(flowQuery)
      setLoadingFlows(false)
      return () => { active = false }
    }
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
                    targetId: flowTargetId.trim(),
                    model: flowModel.trim(),
                    promptVersion: flowPromptVersion.trim(),
                    schemaVersion: flowSchemaVersion.trim(),
                    analysisRisk: flowAnalysisRisk,
                    minConfidence: flowMinimumConfidencePercent === '' ? '' : String(Number(flowMinimumConfidencePercent) / 100),
                    maxConfidence: flowMaximumConfidencePercent === '' ? '' : String(Number(flowMaximumConfidencePercent) / 100),
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
    flowTargetId,
    flowModel,
    flowPromptVersion,
    flowSchemaVersion,
    flowAnalysisRisk,
    flowMinimumConfidencePercent,
    flowMaximumConfidencePercent,
    invalidFlowConfidenceRange,
  ])
  useEffect(() => {
    let active = true
    if (!flowResultsAreCurrent) {
      setFlowEvidenceArtifacts([])
      setFlowEvidenceFailureRepositories([])
      setFlowEvidenceLoadingRepositories([])
      setOmittedFlowEvidenceRevisions(0)
      return () => { active = false }
    }
    const selection = flowRevisionScope === 'all'
      ? historicalFlowEvidenceSelection(flowCandidates, data.repositories)
      : { selected: [], omitted: 0 }
    setOmittedFlowEvidenceRevisions(selection.omitted)
    setFlowEvidenceArtifacts([])
    setFlowEvidenceFailureRepositories([])
    const currentRevisions = new Map(
      data.repositories.map(repository => [repository.id, repository.lastScanRevision])
    )
    const selectedRevisions = new Set(
      selection.selected.map(({ repositoryId, revision }) => `${repositoryId}\u0000${revision}`)
    )
    const evidenceIds = new Map<string, { repositoryId: string; revision: string; ids: Set<string> }>()
    const loadedArtifactIds = new Set(artifacts.map(artifact => artifact.id))
    flowCandidates.forEach(candidate => {
      const isCurrent = candidate.revision === currentRevisions.get(candidate.repositoryId)
      if (!isCurrent && !selectedRevisions.has(`${candidate.repositoryId}\u0000${candidate.revision}`)) return
      const key = `${candidate.repositoryId}\u0000${candidate.revision}`
      const group = evidenceIds.get(key) ?? {
        repositoryId: candidate.repositoryId,
        revision: candidate.revision,
        ids: new Set<string>(),
      }
      const referencedIds = flowArtifactTargetIds(candidate, loadedArtifactIds)
      referencedIds.forEach(id => group.ids.add(id))
      evidenceIds.set(key, group)
    })
    const requests = [...evidenceIds.values()].flatMap(({ repositoryId, revision, ids }) => {
      const values = [...ids]
      return Array.from({ length: Math.ceil(values.length / 100) }, (_, index) => ({
        repositoryId,
        request: api.qualityArtifactsByIds(repositoryId, values.slice(index * 100, (index + 1) * 100), revision)
          .then(response => response.items.map(artifact => ({
            ...artifact,
            revision: artifact.revision ?? revision,
          }))),
      }))
    })
    setFlowEvidenceLoadingRepositories([...new Set(requests.map(request => request.repositoryId))])
    void Promise.allSettled(requests.map(request => request.request)).then(results => {
      if (!active) return
      setFlowEvidenceArtifacts(results.flatMap(result =>
        result.status === 'fulfilled' ? result.value : []
      ))
      setFlowEvidenceFailureRepositories([...new Set(results.flatMap((result, index) =>
        result.status === 'rejected' ? [requests[index].repositoryId] : []
      ))])
      setFlowEvidenceLoadingRepositories([])
    })
    return () => { active = false }
  }, [artifacts, data.repositories, flowCandidates, flowEvidenceReloadKey, flowResultsAreCurrent, flowRevisionScope])
  useEffect(() => {
    let active = true
    setExecutionNextCursors({})
    setExecutionPaginationError(undefined)
    setLoadingMoreExecutions(false)
    setExecutionTrendNextCursors({})
    setExecutionTrendPaginationError(undefined)
    setLoadingMoreExecutionTrend(false)
    setPerformanceNextCursors({})
    setPerformancePaginationError(undefined)
    setExecutionHistoryFailures([])
    setExecutionTrendFailures([])
    setExecutionPerformanceFailures([])
    const historyFiltersValid = !invalidExecutionRange &&
      !invalidExecutionDurationRange &&
      !invalidEvidenceCheckedRange
    void Promise.all(
      data.repositories.map(async repository => {
        const includeHistory = historyFiltersValid &&
          (!executionRepositoryId || executionRepositoryId === repository.id)
        const emptyHistoryPage = { items: [], page: { nextCursor: null, hasMore: false } }
        const [executionResult, performanceResult, trendResult, performanceExecutionsResult, integrationExecutionsResult, postProductionExecutionsResult] = await Promise.allSettled([
          includeHistory ? api.testExecutions(repository.id, executionFilter) : Promise.resolve(emptyHistoryPage),
          includeHistory ? api.executionPerformance(repository.id, executionFilter) : Promise.resolve(emptyHistoryPage),
          includeHistory ? api.executionTrend(repository.id, executionFilter) : Promise.resolve(emptyHistoryPage),
          // Inventory cards are repository artifacts, not execution-history rows.
          // Their latest outcomes remain loaded for every visible repository even
          // while the history dashboard is filtered to one repository.
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
            ? normalizeItemList<TestExecution>(performanceExecutionsResult.value)
            : [],
          integrationExecutions: integrationExecutionsResult.status === 'fulfilled'
            ? normalizeItemList<TestExecution>(integrationExecutionsResult.value)
            : [],
          postProductionExecutions: postProductionExecutionsResult.status === 'fulfilled'
            ? normalizeItemList<TestExecution>(postProductionExecutionsResult.value)
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
    executionEvidenceRefreshVersion,
    invalidExecutionRange,
    invalidExecutionDurationRange,
    invalidEvidenceCheckedRange,
  ])
  const loadMoreExecutionTrend = async () => {
    const cursors = Object.entries(executionTrendNextCursors)
    if (!cursors.length) return
    const query = executionTrendQueryRef.current
    setLoadingMoreExecutionTrend(true)
    setExecutionTrendPaginationError(undefined)
    try {
      const results = await Promise.allSettled(cursors.map(async ([repositoryId, cursor]) => ({
        repositoryId,
        page: normalizeHistoryPage(await api.executionTrend(repositoryId, {
          ...executionFilter,
          cursor,
        })),
      })))
      if (executionTrendQueryRef.current !== query) return
      const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      const failedRepositoryIds = results.flatMap((result, index) =>
        result.status === 'rejected' ? [cursors[index][0]] : []
      )
      setExecutionTrends(current => [...current, ...groups.map(group => group.page.items)])
      setExecutionTrendNextCursors(current => {
        const next = { ...current }
        groups.forEach(group => {
          if (group.page.page.nextCursor) next[group.repositoryId] = group.page.page.nextCursor
          else delete next[group.repositoryId]
        })
        return next
      })
      if (failedRepositoryIds.length) {
        setExecutionTrendPaginationError(`Unable to load more execution trend history for ${failedRepositoryIds.length} ${failedRepositoryIds.length === 1 ? 'repository' : 'repositories'}. Successful evidence remains visible.`)
      }
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
    const query = executionTrendQueryRef.current
    setLoadingMoreExecutions(true)
    setExecutionPaginationError(undefined)
    try {
      const results = await Promise.allSettled(cursors.map(async ([repositoryId, cursor]) => ({
        repositoryId,
        page: normalizeHistoryPage(await api.testExecutions(repositoryId, {
          ...executionFilter,
          cursor,
        })),
      })))
      if (executionTrendQueryRef.current !== query) return
      const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      const failedRepositoryIds = results.flatMap((result, index) =>
        result.status === 'rejected' ? [cursors[index][0]] : []
      )
      const continuedExecutions = groups.flatMap(group => group.page.items)
      setExecutions(current => [...new Map(
        [...current, ...continuedExecutions].map(item => [item.id, item])
      ).values()])
      setExecutionNextCursors(current => {
        const next = { ...current }
        groups.forEach(group => {
          if (group.page.page.nextCursor) next[group.repositoryId] = group.page.page.nextCursor
          else delete next[group.repositoryId]
        })
        return next
      })
      if (failedRepositoryIds.length) {
        setExecutionPaginationError(`Unable to load more execution evidence for ${failedRepositoryIds.length} ${failedRepositoryIds.length === 1 ? 'repository' : 'repositories'}. Successful evidence remains visible.`)
      }
    } catch (cause) {
      if (executionTrendQueryRef.current === query) {
        setExecutionPaginationError(cause instanceof Error ? cause.message : 'Unable to load more execution evidence.')
      }
    } finally {
      if (executionTrendQueryRef.current === query) setLoadingMoreExecutions(false)
    }
  }
  const inspectExecution = async (execution: TestExecution) => {
    const request = ++executionInspectorRequest.current
    setExecutionInspectorOpen(true)
    setInspectedExecution(undefined)
    setExecutionInspectorArtifacts([])
    setExecutionInspectorError(undefined)
    setExecutionInspectorEvidenceError(undefined)
    setExecutionInspectorLoading(true)
    try {
      const detail = await api.testExecution(execution.repositoryId, execution.id)
      if (request !== executionInspectorRequest.current) return
      setInspectedExecution(detail)
      const evidenceIds = [...new Set([
        ...detail.policyArtifactIds,
        ...detail.gateArtifactIds,
        ...(detail.gateEvaluations ?? []).flatMap(evaluation => [
          evaluation.policyArtifactId,
          evaluation.gateArtifactId,
        ]),
      ])]
      if (evidenceIds.length) {
        if (!detail.catalogRevision) {
          setExecutionInspectorEvidenceError(
            'The analyzed catalog revision for this execution is unavailable. Stored policy and gate identifiers remain visible, but their source artifacts cannot be resolved.'
          )
        } else try {
          const evidence = await api.qualityArtifactsByIdsBatched(
            detail.repositoryId,
            evidenceIds,
            detail.catalogRevision,
          )
          if (request === executionInspectorRequest.current) {
            setExecutionInspectorArtifacts(evidence.items)
          }
        } catch (cause) {
          if (request === executionInspectorRequest.current) {
            setExecutionInspectorEvidenceError(
              cause instanceof Error
                ? cause.message
                : 'Unable to resolve execution policy and gate artifacts'
            )
          }
        }
      }
    } catch (cause) {
      if (request === executionInspectorRequest.current) {
        setExecutionInspectorError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load execution evidence detail'
        )
      }
    } finally {
      if (request === executionInspectorRequest.current) {
        setExecutionInspectorLoading(false)
      }
    }
  }
  const closeExecutionInspector = () => {
    executionInspectorRequest.current++
    setExecutionInspectorOpen(false)
    setInspectedExecution(undefined)
    setExecutionInspectorArtifacts([])
    setExecutionInspectorError(undefined)
    setExecutionInspectorEvidenceError(undefined)
    setExecutionInspectorLoading(false)
  }
  const refreshExecutionEvidence = async (execution: TestExecution) => {
    setRefreshingExecutionEvidenceId(execution.id)
    setExecutionEvidenceRefreshError(undefined)
    try {
      const refreshed = await api.refreshTestExecutionEvidence(execution.repositoryId, {
        provider: execution.provider,
        externalRunId: execution.externalRunId,
        attempt: execution.attempt,
      })
      const replace = (items: TestExecution[]) => items.map(item => item.id === refreshed.id ? refreshed : item)
      setExecutions(replace)
      setPerformanceExecutions(replace)
      setIntegrationExecutions(replace)
      setPostProductionExecutions(replace)
      setInspectedExecution(current => current?.id === refreshed.id ? refreshed : current)
      setExecutionEvidenceRefreshVersion(version => version + 1)
      try {
        const dispatches = await loadLatestTestSuiteDispatches(execution.repositoryId)
        setTestSuiteDispatches(current => [
          ...current.filter(dispatch => dispatch.repositoryId !== execution.repositoryId),
          ...dispatches,
        ])
        setTestSuiteDispatchAuditStatus(current => ({ ...current, [execution.repositoryId]: 'ready' }))
      } catch {
        setTestSuiteDispatchAuditStatus(current => ({ ...current, [execution.repositoryId]: 'error' }))
      }
      if (refreshed.evidenceCollection?.status === 'unavailable') {
        setExecutionEvidenceRefreshError('Provider evidence is still unavailable. The failed lookup remains visible and can be retried.')
      }
    } catch (cause) {
      setExecutionEvidenceRefreshError(cause instanceof Error ? cause.message : 'Unable to refresh provider evidence.')
    } finally {
      setRefreshingExecutionEvidenceId(undefined)
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
    const query = flowQueryRef.current
    setLoadingMoreFlows(true)
    setHistoryPaginationError(undefined)
    try {
      const results = await Promise.allSettled(cursors.map(async ([repositoryId, cursor]) => {
        const repository = data.repositories.find(item => item.id === repositoryId)
        const page = normalizeHistoryPage(await api.repositoryFlowCandidates(
          repositoryId,
          Object.fromEntries(Object.entries({
            source: flowSource,
            status: flowStatus,
            revision: flowRevisionScope === 'current' ? repository?.lastScanRevision ?? '' : '',
            targetId: flowTargetId.trim(),
            model: flowModel.trim(),
            promptVersion: flowPromptVersion.trim(),
            schemaVersion: flowSchemaVersion.trim(),
            analysisRisk: flowAnalysisRisk,
            minConfidence: flowMinimumConfidencePercent === '' ? '' : String(Number(flowMinimumConfidencePercent) / 100),
            maxConfidence: flowMaximumConfidencePercent === '' ? '' : String(Number(flowMaximumConfidencePercent) / 100),
            cursor,
          }).filter(([, value]) => Boolean(value)))
        ))
        return { repositoryId, page }
      }))
      if (flowQueryRef.current !== query) return
      const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      setFlowCandidates(current => [...new Map(
        [...current, ...groups.flatMap(group => group.page.items)].map(item => [item.id, item])
      ).values()])
      setFlowNextCursors(current => {
        const next = { ...current }
        for (const group of groups) {
          if (group.page.page.nextCursor) next[group.repositoryId] = group.page.page.nextCursor
          else delete next[group.repositoryId]
        }
        return next
      })
      const failed = results.filter(result => result.status === 'rejected').length
      if (failed) {
        setHistoryPaginationError(
          `Unable to load more UX-flow history for ${failed} ${failed === 1 ? 'repository' : 'repositories'}. Successful evidence remains visible.`
        )
      }
    } catch (cause) {
      if (flowQueryRef.current === query) {
        setHistoryPaginationError(cause instanceof Error ? cause.message : 'Unable to load more UX-flow history.')
      }
    } finally {
      if (flowQueryRef.current === query) setLoadingMoreFlows(false)
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
      const results = await Promise.allSettled(cursors.map(async ([repositoryId, cursor]) => {
        const repository = data.repositories.find(item => item.id === repositoryId)
        const page = normalizeHistoryPage(await api.policyGateEvaluations(
          repositoryId,
          Object.fromEntries(Object.entries({
            kind: policyGateKind,
            remediationAction: policyGateRemediationAction,
            severity: policyGateSeverity,
            reviewStatus: policyGateReviewStatus,
            revision: policyGateRevisionScope === 'current' ? repository?.lastScanRevision ?? '' : '',
            subject: policyGateSubject.trim(),
            sourcePath: policyGateSourcePath.trim(),
            policyArtifactId: policyGatePolicyArtifactId.trim(),
            gateArtifactId: policyGateGateArtifactId.trim(),
            minConfidence: policyGateMinimumConfidencePercent === '' ? '' : String(Number(policyGateMinimumConfidencePercent) / 100),
            maxConfidence: policyGateMaximumConfidencePercent === '' ? '' : String(Number(policyGateMaximumConfidencePercent) / 100),
            cursor,
          }).filter(([, value]) => Boolean(value)))
        ))
        return { repositoryId, page }
      }))
      if (policyGateHistoryQueryRef.current !== selectionQuery) return
      const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      const continuedEvaluations = groups.flatMap(group => group.page.items)
      setPolicyGateEvaluations(current => mergePolicyGateContinuation(
        current,
        continuedEvaluations,
        visibleAtRequestStart,
      ))
      setPolicyGateNextCursors(current => {
        const next = { ...current }
        for (const group of groups) {
          if (group.page.page.nextCursor) next[group.repositoryId] = group.page.page.nextCursor
          else delete next[group.repositoryId]
        }
        return next
      })
      const failed = results.filter(result => result.status === 'rejected').length
      if (failed) {
        setHistoryPaginationError(
          `Unable to load more policy and gate history for ${failed} ${failed === 1 ? 'repository' : 'repositories'}. Successful evidence remains visible.`
        )
      }
    } catch (cause) {
      if (policyGateHistoryQueryRef.current === selectionQuery) {
        setHistoryPaginationError(cause instanceof Error ? cause.message : 'Unable to load more policy and gate history.')
      }
    } finally {
      if (policyGateHistoryQueryRef.current === selectionQuery) {
        setLoadingMorePolicyGates(false)
      }
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
      [...governanceEvidenceArtifacts, ...flowEvidenceArtifacts, ...artifacts]
        .map(artifact => [artifact.id, artifact])
    ).values()],
    [artifacts, governanceEvidenceArtifacts, flowEvidenceArtifacts]
  )
  const artifactsByRevisionReference = useMemo(() => {
    const currentRevisions = new Map(
      data.repositories.map(repository => [repository.id, repository.lastScanRevision])
    )
    return new Map(evidenceArtifacts.flatMap(artifact => {
      const revision = artifact.revision ?? currentRevisions.get(artifact.repositoryId)
      if (!revision) return []
      const prefix = `${artifact.repositoryId}\u0000${revision}\u0000`
      return [
        [`${prefix}${artifact.id}`, artifact] as const,
        ...(artifact.logicalId ? [[`${prefix}${artifact.logicalId}`, artifact] as const] : []),
      ]
    }))
  }, [data.repositories, evidenceArtifacts])
  const artifactForFlowReference = (flow: RepositoryFlowCandidate, reference: string) =>
    artifactsByRevisionReference.get(`${flow.repositoryId}\u0000${flow.revision}\u0000${reference}`)
  const filteredPolicyGateEvaluations = useMemo(
    () =>
      policyGateEvaluations.filter(
        evaluation => policyGateEvaluationMatchesInventory(
          evaluation,
          data.repositories,
          policyGateSelection,
        )
      ),
    [
      data.repositories,
      policyGateEvaluations,
      policyGateKind,
      policyGateRemediationAction,
      policyGateSeverity,
      policyGateReviewStatus,
      policyGateRevisionScope,
      policyGateSubject,
      policyGateSourcePath,
      policyGatePolicyArtifactId,
      policyGateGateArtifactId,
      policyGateMinimumConfidencePercent,
      policyGateMaximumConfidencePercent,
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
  const currentDispatchLogicalIds = new Set(
    [...artifacts, ...currentDispatchArtifacts]
      .filter(artifact => ['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(artifact.kind))
      .map(artifact => artifact.logicalId ?? artifact.id)
  )
  const verifiedDispatchRetirementRepositoryIds = new Set(
    verifiedDispatchRetirementRepositories
  )
  const retiredTestSuiteDispatches = testSuiteDispatches.filter(dispatch =>
    verifiedDispatchRetirementRepositoryIds.has(dispatch.repositoryId) &&
    !currentDispatchLogicalIds.has(dispatch.artifactLogicalId)
  )
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
        artifacts={[...new Map(
          [...evidenceArtifacts, ...flowInspectorArtifacts]
            .map(artifact => [artifact.id, artifact])
        ).values()]}
        loading={flowInspectorLoading}
        error={flowInspectorError}
        evidenceError={flowInspectorEvidenceError}
        onClose={closeFlowInspector}
      />
      <GovernanceInspector
        open={policyGateInspectorOpen}
        evaluation={inspectedPolicyGate}
        repositoryLabel={inspectedPolicyGate
          ? repositoryLabels.get(inspectedPolicyGate.repositoryId)
          : undefined}
        artifacts={[...new Map(
          [...evidenceArtifacts, ...policyGateInspectorArtifacts]
            .map(artifact => [artifact.id, artifact])
        ).values()]}
        loading={policyGateInspectorLoading}
        error={policyGateInspectorError}
        evidenceError={policyGateInspectorEvidenceError}
        onClose={closePolicyGateInspector}
      >
        {inspectedPolicyGate && (
          <PolicyGateReviewControls
            evaluation={inspectedPolicyGate}
            evidenceArtifacts={policyGateInspectorArtifacts}
            evidenceVerification={policyGateInspectorLoading
              ? 'loading'
              : policyGateInspectorEvidenceError
                ? 'unavailable'
                : 'ready'}
            currentRevision={data.repositories.find(
              repository => repository.id === inspectedPolicyGate.repositoryId
            )?.lastScanRevision}
            onReview={reviewPolicyGate}
          />
        )}
      </GovernanceInspector>
      <ExecutionInspector
        open={executionInspectorOpen}
        execution={inspectedExecution}
        repositoryLabel={inspectedExecution
          ? repositoryLabels.get(inspectedExecution.repositoryId)
          : undefined}
        artifacts={[...new Map(
          executionInspectorArtifacts
            .map(artifact => [artifact.id, artifact])
        ).values()]}
        loading={executionInspectorLoading}
        error={executionInspectorError}
        evidenceError={executionInspectorEvidenceError}
        refreshing={Boolean(
          inspectedExecution && refreshingExecutionEvidenceId === inspectedExecution.id
        )}
        onRefresh={inspectedExecution
          ? () => void refreshExecutionEvidence(inspectedExecution)
          : undefined}
        onClose={closeExecutionInspector}
      >
        {inspectedExecution && <ExecutionAttemptHistory execution={inspectedExecution} />}
      </ExecutionInspector>
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
            targetId={flowTargetId}
            model={flowModel}
            promptVersion={flowPromptVersion}
            schemaVersion={flowSchemaVersion}
            analysisRisk={flowAnalysisRisk}
            minimumConfidencePercent={flowMinimumConfidencePercent}
            maximumConfidencePercent={flowMaximumConfidencePercent}
            invalidConfidenceRange={invalidFlowConfidenceRange}
            onRepositoryIdChange={setFlowRepositoryId}
            onSourceChange={setFlowSource}
            onStatusChange={setFlowStatus}
            onRevisionScopeChange={setFlowRevisionScope}
            onTargetIdChange={setFlowTargetId}
            onModelChange={setFlowModel}
            onPromptVersionChange={setFlowPromptVersion}
            onSchemaVersionChange={setFlowSchemaVersion}
            onAnalysisRiskChange={setFlowAnalysisRisk}
            onMinimumConfidencePercentChange={setFlowMinimumConfidencePercent}
            onMaximumConfidencePercentChange={setFlowMaximumConfidencePercent}
          />
          {invalidFlowConfidenceRange && (
            <p className="form-error" role="alert">
              Maximum confidence must be greater than or equal to minimum confidence.
            </p>
          )}
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
          {flowEvidenceFailureRepositories.length > 0 && (
            <div className="form-error" role="alert">
              Some exact UX flow evidence could not be loaded. Evidence from successful requests remains visible.{' '}
              <QualityAction
                intent="quiet"
                onClick={() => setFlowEvidenceReloadKey(current => current + 1)}
              >
                <RefreshCw size={14} /> Retry exact UX flow evidence
              </QualityAction>
            </div>
          )}
          {dispatchRetirementFailures.length > 0 && (
            <p className="form-error" role="alert">
              Current workflow verification is unavailable for {dispatchRetirementFailures.length}{' '}
              {dispatchRetirementFailures.length === 1 ? 'repository' : 'repositories'}. No dispatch evidence from those repositories is classified as retired.
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
              Proposed remediation
              <select
                value={policyGateRemediationAction}
                onChange={event =>
                  setPolicyGateRemediationAction(
                    event.target.value as PolicyGateEvaluation['remediationAction'] | ''
                  )
                }
              >
                <option value="">All remediation actions</option>
                <option value="build-gate">Build a gate</option>
                <option value="build-policy">Build a policy</option>
                <option value="disambiguate-policy">Disambiguate policy</option>
                <option value="align-policy-gate">Align policy and gate</option>
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
            <label>
              Governance subject
              <input
                value={policyGateSubject}
                maxLength={200}
                placeholder="authentication"
                onChange={event => setPolicyGateSubject(event.target.value)}
              />
            </label>
            <label>
              Governance source path
              <input
                value={policyGateSourcePath}
                maxLength={1000}
                placeholder="governance/deployment.md"
                onChange={event => setPolicyGateSourcePath(event.target.value)}
              />
            </label>
            <label>
              Policy artifact
              <input
                value={policyGatePolicyArtifactId}
                maxLength={500}
                placeholder="policy logical ID"
                onChange={event => setPolicyGatePolicyArtifactId(event.target.value)}
              />
            </label>
            <label>
              Gate artifact
              <input
                value={policyGateGateArtifactId}
                maxLength={500}
                placeholder="gate logical ID"
                onChange={event => setPolicyGateGateArtifactId(event.target.value)}
              />
            </label>
            <label>
              Minimum governance confidence (%)
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={policyGateMinimumConfidencePercent}
                placeholder="Any"
                onChange={event => setPolicyGateMinimumConfidencePercent(event.target.value)}
              />
            </label>
            <label>
              Maximum governance confidence (%)
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={policyGateMaximumConfidencePercent}
                placeholder="Any"
                aria-invalid={invalidPolicyGateConfidenceRange}
                onChange={event => setPolicyGateMaximumConfidencePercent(event.target.value)}
              />
            </label>
          </div>
          {invalidPolicyGateConfidenceRange && (
            <p className="form-error" role="alert">
              Maximum governance confidence must be greater than or equal to minimum governance confidence.
            </p>
          )}
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
            {retiredTestSuiteDispatches.length > 0 && (
              <section className="catalog-panel" aria-label="Retired controlled workflow audits">
                <header>
                  <div>
                    <p className="eyebrow">{retiredTestSuiteDispatches.length} retained</p>
                    <h2>Retired controlled workflows</h2>
                    <p>
                      Immutable dispatch evidence retained after repository analysis no longer finds the workflow.
                    </p>
                  </div>
                </header>
                <div className="catalog-list">
                  {retiredTestSuiteDispatches.map(dispatch => (
                    <article className="catalog-row" key={dispatch.id}>
                      <div>
                        <strong>{dispatch.workflowPath}</strong>
                        <small className="flow-repository-label">
                          Repository {repositoryLabels.get(dispatch.repositoryId) ?? dispatch.repositoryId}
                        </small>
                        <code>{dispatch.artifactKind} · retired from current analysis</code>
                        <p>
                          Latest controlled dispatch · {dispatch.status} ·{' '}
                          {new Date(dispatch.requestedAt).toLocaleString()} · revision{' '}
                          {dispatch.sourceRevision.slice(0, 12)} · requested by {dispatch.requestedBy}
                          {dispatch.inputNames.length
                            ? ` · reviewed inputs: ${dispatch.inputNames.join(', ')}`
                            : ' · no workflow inputs'}
                          {dispatch.error ? ` · ${dispatch.error}` : ''}
                        </p>
                        <DispatchExecutionResult dispatch={dispatch} />
                        <TestSuiteDispatchHistory
                          repositoryId={dispatch.repositoryId}
                          artifactReference={dispatch.artifactLogicalId}
                          latestDispatch={dispatch}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
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
                                {flow.analysis.inputArtifactCount !== undefined &&
                                  flow.analysis.promptArtifactCount !== undefined && (
                                    <div>
                                      <dt>Prompt evidence</dt>
                                      <dd>{promptEvidenceLabel(flow.analysis)}</dd>
                                    </div>
                                  )}
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
                                  const artifact = artifactForFlowReference(flow, evidence)
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
                                              artifactForFlowReference(flow, targetId)
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
                              knownArtifactIds={evidenceArtifacts
                                .filter(artifact =>
                                  artifact.repositoryId === flow.repositoryId &&
                                  (!artifact.revision || artifact.revision === flow.revision)
                                )
                                .flatMap(artifact => [
                                  artifact.id,
                                  ...(artifact.logicalId ? [artifact.logicalId] : []),
                                ])}
                              evidenceVerification={flowEvidenceLoadingRepositories.includes(flow.repositoryId)
                                ? 'loading'
                                : flowEvidenceFailureRepositories.includes(flow.repositoryId)
                                  ? 'unavailable'
                                  : 'ready'}
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
                              <QualityAction
                                intent="quiet"
                                onClick={() => void inspectPolicyGate(evaluation)}
                              >
                                <Eye size={14} /> Inspect governance evidence
                              </QualityAction>
                              {evaluation.reviewedAt && (
                                <small>
                                  Reviewed {new Date(evaluation.reviewedAt).toLocaleString()}
                                  {evaluation.reviewedBy ? ` by ${evaluation.reviewedBy}` : ''}
                                  {evaluation.reviewReason ? ` · ${evaluation.reviewReason}` : ''}
                                </small>
                              )}
                              <PolicyGateEvidence
                                evaluation={evaluation}
                                artifacts={evidenceArtifacts}
                              />
                              <PolicyGateReviewControls
                                evaluation={evaluation}
                                evidenceArtifacts={evidenceArtifacts.filter(artifact =>
                                  artifact.repositoryId === evaluation.repositoryId &&
                                  (!artifact.revision || artifact.revision === evaluation.revision)
                                )}
                                evidenceVerification={governanceEvidenceLoading
                                  ? 'loading'
                                  : governanceEvidenceFailures.includes(evaluation.repositoryId)
                                    ? 'unavailable'
                                    : 'ready'}
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
                      const repository = data.repositories.find(
                        candidate => candidate.id === item.repositoryId
                      )
                      const latestExecution = item.kind === 'integration-test'
                        ? latestIntegrationExecution(item, integrationExecutions, repository?.defaultBranch, repository ? `${repository.owner}/${repository.name}` : undefined, testSuiteDispatches)
                        : item.kind === 'post-production-test'
                          ? latestPostProductionExecution(item, postProductionExecutions, repository?.defaultBranch, repository ? `${repository.owner}/${repository.name}` : undefined, testSuiteDispatches)
                          : latestPerformanceExecution(item, performanceExecutions, repository?.defaultBranch, repository ? `${repository.owner}/${repository.name}` : undefined, testSuiteDispatches)
                      const analyzedRevision = repository
                        ? analyzedSourceRevision(repository)
                        : undefined
                      const workflowTarget = executableWorkflowTarget(item)
                      const sharedWorkflowArtifacts = artifacts.filter(candidate =>
                        candidate.repositoryId === item.repositoryId &&
                        candidate.sourcePath === item.sourcePath &&
                        artifactWorkflowExecutionKind(candidate) !== undefined
                      )
                      const sharedWorkflowKinds = new Set(
                        sharedWorkflowArtifacts.map(candidate => artifactWorkflowExecutionKind(candidate))
                      )
                      const preferredExecutionKind = preferredWorkflowExecutionKind(sharedWorkflowArtifacts)
                      const artifactExecutionKind = artifactWorkflowExecutionKind(item)
                      const lowerPrioritySharedWorkflow = sharedWorkflowKinds.size > 1 &&
                        preferredExecutionKind !== undefined &&
                        !isPreferredWorkflowExecutionArtifact(item, sharedWorkflowArtifacts)
                      const latestDispatch = testSuiteDispatches.find(dispatch =>
                        dispatch.repositoryId === item.repositoryId &&
                        dispatch.artifactLogicalId === (item.logicalId ?? item.id)
                      )
                      const dispatchAuditStatus =
                        testSuiteDispatchAuditStatus[item.repositoryId] ?? 'loading'
                      return (
                      <article className="catalog-row" key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          <code>{item.sourcePath}</code>
                          <p>{item.summary}</p>
                          {lowerPrioritySharedWorkflow && (
                            <small className="performance-inventory-only">
                              Inventory only · this shared workflow is dispatched and recorded as {preferredExecutionKind} evidence before {artifactExecutionKind} evidence.
                            </small>
                          )}
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
                            workflowTarget &&
                            analyzedRevision &&
                            !lowerPrioritySharedWorkflow &&
                            item.execution?.requiredInputs?.length ? (
                              <div className="workflow-dispatch-inputs" aria-label={`Required inputs for ${item.title}`}>
                                <small>
                                  Controlled dispatch requires the analyzed workflow inputs below. Values are sent to GitHub Actions and are not stored by FuzeQuality.
                                </small>
                                {item.execution.requiredInputs.map(inputName => (
                                  <QualityInput
                                    key={inputName}
                                    label={inputName}
                                    value={workflowDispatchInputs[item.id]?.[inputName] ?? ''}
                                    maxLength={256}
                                    autoComplete="off"
                                    disabled={dispatchingArtifact === item.id}
                                    onChange={event => setWorkflowDispatchInputs(current => ({
                                      ...current,
                                      [item.id]: {
                                        ...current[item.id],
                                        [inputName]: event.target.value,
                                      },
                                    }))}
                                  />
                                ))}
                              </div>
                            ) : null}
                          {['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(item.kind) &&
                            workflowTarget &&
                            analyzedRevision &&
                            !lowerPrioritySharedWorkflow && (
                              <div className="row-actions">
                                <button
                                  className="secondary-button"
                                  disabled={
                                    dispatchAuditStatus !== 'ready' ||
                                    dispatchingArtifact === item.id ||
                                    Boolean(item.execution?.requiredInputs?.some(
                                      inputName => !workflowDispatchInputs[item.id]?.[inputName]?.trim()
                                    ))
                                  }
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
                            workflowTarget &&
                            analyzedRevision &&
                            !lowerPrioritySharedWorkflow &&
                            dispatchAuditStatus === 'loading' && (
                              <small className="performance-inventory-only" role="status">
                                Checking controlled-dispatch audit before enabling a new run.
                              </small>
                            )}
                          {['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(item.kind) &&
                            workflowTarget &&
                            analyzedRevision &&
                            !lowerPrioritySharedWorkflow &&
                            dispatchAuditStatus === 'error' && (
                              <div className="performance-evidence-warning" role="alert">
                                <small>
                                  Controlled-dispatch audit is unavailable. New dispatch is blocked to prevent duplicate GitHub Actions runs.
                                </small>
                                <QualityAction
                                  intent="quiet"
                                  onClick={() => void retryTestSuiteDispatchAudit(item.repositoryId)}
                                >
                                  <RefreshCw size={14} /> Retry dispatch audit
                                </QualityAction>
                              </div>
                            )}
                          {latestDispatch && !lowerPrioritySharedWorkflow && (
                            <>
                              <small className="performance-inventory-only" role="status">
                                Latest controlled dispatch · {latestDispatch.status} ·{' '}
                                {new Date(latestDispatch.requestedAt).toLocaleString()} · revision{' '}
                                {latestDispatch.sourceRevision.slice(0, 12)} · requested by {latestDispatch.requestedBy}
                                {latestDispatch.inputNames.length
                                  ? ` · reviewed inputs: ${latestDispatch.inputNames.join(', ')}`
                                  : ' · no workflow inputs'}
                                {latestDispatch.error ? ` · ${latestDispatch.error}` : ''}
                              </small>
                              <DispatchExecutionResult dispatch={latestDispatch} />
                              <TestSuiteDispatchHistory
                                repositoryId={item.repositoryId}
                                artifactReference={item.logicalId ?? item.id}
                                latestDispatch={latestDispatch}
                              />
                            </>
                          )}
                          {['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(item.kind) &&
                            item.execution &&
                            analyzedRevision &&
                            !workflowTarget && (
                              <small className="performance-inventory-only">
                                Inventory only · controlled dispatch requires a scanner-verified workflow that is a direct YAML child of .github/workflows.
                              </small>
                            )}
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
                            !analyzedRevision && (
                              <small className="performance-inventory-only">
                                Inventory only · run repository analysis at an
                                exact commit before dispatching this workflow.
                              </small>
                            )}
                          {['load-test', 'stress-test'].includes(item.kind) && !lowerPrioritySharedWorkflow && (
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
                                  <ExecutionEvidenceCoverage
                                    execution={latestExecution}
                                    onRefresh={() => void refreshExecutionEvidence(latestExecution)}
                                    refreshing={refreshingExecutionEvidenceId === latestExecution.id}
                                  />
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
                          {item.kind === 'post-production-test' && !lowerPrioritySharedWorkflow && (
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
                                  <ExecutionEvidenceCoverage
                                    execution={latestExecution}
                                    onRefresh={() => void refreshExecutionEvidence(latestExecution)}
                                    refreshing={refreshingExecutionEvidenceId === latestExecution.id}
                                  />
                                  <ExecutionLinkageEvidence execution={latestExecution} />
                                  <ExecutionEvidenceLinks execution={latestExecution} />
                                  <ExecutionSourceLink execution={latestExecution} />
                                </>
                              ) : (
                                <small>No matching post-production execution has been ingested for this workflow yet.</small>
                              )}
                            </section>
                          )}
                          {item.kind === 'integration-test' && !lowerPrioritySharedWorkflow && (
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
                                  <ExecutionEvidenceCoverage
                                    execution={latestExecution}
                                    onRefresh={() => void refreshExecutionEvidence(latestExecution)}
                                    refreshing={refreshingExecutionEvidenceId === latestExecution.id}
                                  />
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
                                  : performanceDispatch.state === 'warning'
                                    ? 'performance-dispatch-warning'
                                    : 'performance-dispatch-success'
                              }
                              role={
                                performanceDispatch.state === 'error' || performanceDispatch.state === 'warning'
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
              Evidence attachment
              <select
                value={executionEvidenceKind}
                onChange={event =>
                  setExecutionEvidenceKind(
                    event.target.value as TestExecution['evidenceLinks'][number]['kind'] | ''
                  )
                }
              >
                <option value="">All attachments</option>
                <option value="video">Video</option>
                <option value="report">Report</option>
                <option value="trace">Trace</option>
                <option value="screenshot">Screenshot</option>
                <option value="log">Log</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Evidence collection state
              <select
                value={executionEvidenceCollectionStatus}
                onChange={event =>
                  setExecutionEvidenceCollectionStatus(
                    event.target.value as NonNullable<TestExecution['evidenceCollection']>['status'] | 'not-collected' | ''
                  )
                }
              >
                <option value="">All collection states</option>
                <option value="complete">Complete</option>
                <option value="partial">Partial</option>
                <option value="unavailable">Unavailable</option>
                <option value="not-collected">Not collected</option>
              </select>
            </label>
            <label>
              Required evidence
              <select
                value={executionEvidenceRequirement}
                onChange={event =>
                  setExecutionEvidenceRequirement(
                    event.target.value as 'evidence-url-invalid' | 'provider-collection-failure' | 'github-run-provenance-missing' | 'head-repository-unverified' | 'attempt-provenance-unverified' | 'policy-gate-outcome-missing' | 'post-production-video-missing' | 'performance-threshold-missing' | 'terminal-timing-missing' | ''
                  )
                }
              >
                <option value="">All requirements</option>
                <option value="evidence-url-invalid">Invalid or non-HTTPS artifact URL</option>
                <option value="provider-collection-failure">Provider evidence collection failed</option>
                <option value="github-run-provenance-missing">Missing GitHub run provenance</option>
                <option value="head-repository-unverified">Unverified GitHub head repository</option>
                <option value="attempt-provenance-unverified">Unverified retry-attempt artifacts</option>
                <option value="policy-gate-outcome-missing">Missing policy–gate outcome</option>
                <option value="post-production-video-missing">Missing post-production video</option>
                <option value="performance-threshold-missing">Missing performance thresholds</option>
                <option value="terminal-timing-missing">Missing or invalid terminal timing</option>
              </select>
            </label>
            <label>
              Evidence collection failure
              <select
                value={executionEvidenceCollectionErrorCode}
                onChange={event =>
                  setExecutionEvidenceCollectionErrorCode(
                    event.target.value as NonNullable<TestExecution['evidenceCollection']>['errorCode'] | ''
                  )
                }
              >
                <option value="">All provider outcomes</option>
                <option value="PROVIDER_TIMEOUT">Provider timeout</option>
                <option value="PROVIDER_UNAVAILABLE">Provider service unavailable</option>
                <option value="PROVIDER_RESPONSE_INVALID">Invalid provider response</option>
                <option value="PROVIDER_RESULT_LIMIT_EXCEEDED">Provider result limit exceeded</option>
              </select>
            </label>
            <label>
              Evidence checked after
              <input
                type="datetime-local"
                value={executionEvidenceCheckedAfter}
                onChange={event => setExecutionEvidenceCheckedAfter(event.target.value)}
              />
            </label>
            <label>
              Evidence checked before
              <input
                type="datetime-local"
                value={executionEvidenceCheckedBefore}
                aria-invalid={invalidEvidenceCheckedRange}
                onChange={event => setExecutionEvidenceCheckedBefore(event.target.value)}
              />
            </label>
            {(executionEvidenceCheckedAfter || executionEvidenceCheckedBefore) && (
              <button
                className="secondary-button execution-filter-reset"
                onClick={() => {
                  setExecutionEvidenceCheckedAfter('')
                  setExecutionEvidenceCheckedBefore('')
                }}
              >
                Clear evidence dates
              </button>
            )}
            <label>
              Threshold evidence
              <select
                value={executionThresholdOutcome}
                onChange={event =>
                  setExecutionThresholdOutcome(event.target.value as 'passed' | 'failed' | '')
                }
              >
                <option value="">All threshold states</option>
                <option value="failed">Breached thresholds</option>
                <option value="passed">Satisfied thresholds</option>
              </select>
            </label>
            <label>
              Gate outcome
              <select
                value={executionGateOutcome}
                onChange={event =>
                  setExecutionGateOutcome(event.target.value as TestExecution['status'] | '')
                }
              >
                <option value="">All gate outcomes</option>
                <option value="passed">Passed gates</option>
                <option value="failed">Failed gates</option>
                <option value="cancelled">Cancelled gates</option>
                <option value="running">Running gates</option>
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
              Provider run ID
              <input
                type="text"
                value={executionExternalRunId}
                maxLength={500}
                placeholder="Exact provider run ID"
                onChange={event => setExecutionExternalRunId(event.target.value)}
              />
            </label>
            <label>
              Suite name
              <input
                type="text"
                value={executionName}
                maxLength={500}
                placeholder="Exact suite name"
                onChange={event => setExecutionName(event.target.value)}
              />
            </label>
            <label>
              Source branch
              <input
                type="text"
                value={executionBranch}
                maxLength={500}
                placeholder="main or feature/checkout"
                onChange={event => setExecutionBranch(event.target.value)}
              />
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
                onBlur={() => setExecutionWorkflowPath(
                  canonicalWorkflowPath(executionWorkflowPath.trim())
                )}
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
                aria-invalid={invalidExecutionRange}
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
          {executionPolicyArtifactId && executionGateArtifactId && (
            <div className="performance-inventory-only" role="status">
              Showing execution evidence for policy <code>{executionPolicyArtifactId}</code> and gate{' '}
              <code>{executionGateArtifactId}</code>, including equivalent artifact observations across repository revisions.{' '}
              <QualityAction
                intent="quiet"
                onClick={() => {
                  setExecutionPolicyArtifactId('')
                  setExecutionGateArtifactId('')
                }}
              >
                Clear policy-gate focus
              </QualityAction>
            </div>
          )}
          {invalidExecutionDurationRange && (
            <p className="form-error" role="alert">
              Maximum duration must be greater than or equal to minimum duration.
            </p>
          )}
          {invalidExecutionRange && (
            <p className="form-error" role="alert">
              Until must be greater than or equal to from.
            </p>
          )}
          {invalidEvidenceCheckedRange && (
            <p className="form-error" role="alert">
              Evidence checked before must be greater than or equal to evidence checked after.
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
          <p className="performance-inventory-only">
            GitHub evidence is scoped to each selected source repository; fork runs are excluded even when branch names match.
          </p>
          <div className="execution-trend" aria-label="Execution outcome trend">
            {outcomeTrend.map(day => (
              <div key={day.date}>
                <strong><time dateTime={day.date}>{day.date} UTC</time></strong>
                <span>{day.passed} passed</span>
                <span>{day.failed} failed</span>
                <span>{day.cancelled} cancelled</span>
                <span>{day.running} running</span>
                <span>
                  {day.total} total · {Math.round(day.passRate * 100)}% passed among terminal outcomes
                </span>
                <span>
                  {day.durationSampleCount > 0
                    ? `${durationMsLabel(day.averageDurationMs)} average · ${durationMsLabel(day.maximumDurationMs)} slowest · ${day.durationSampleCount} timed`
                    : 'No completed timing samples'}
                </span>
                <span>
                  {day.retryAttemptCount} retries · {day.successfulRetryCount} passed retries · {day.recoveredRunCount} recovered after failure
                </span>
                <span>
                  Provider evidence: {day.evidenceCompleteCount ?? 0} complete · {day.evidencePartialCount ?? 0} partial · {day.evidenceUnavailableCount ?? 0} unavailable · {day.evidenceNotCollectedCount ?? 0} not collected · {day.evidenceCollectionFailureCount ?? 0} collection failures
                </span>
                <span>
                  Evidence gaps: {day.invalidEvidenceUrlCount ?? 0} invalid URLs · {day.githubRunProvenanceMissingCount ?? 0} GitHub runs missing provenance · {day.headRepositoryUnverifiedCount ?? 0} provider collections with unverified repository ownership · {day.attemptProvenanceUnverifiedCount ?? 0} retry attempts with unverified provenance · {day.providerResultLimitedCount ?? 0} provider result sets truncated · {day.postProductionVideoMissingCount ?? 0} post-production runs missing video · {day.terminalTimingMissingCount ?? 0} terminal runs missing or invalid timing
                </span>
                <span>
                  Policy gates: {day.gatePassedCount ?? 0} passed · {day.gateFailedCount ?? 0} failed · {day.gateCancelledCount ?? 0} cancelled · {day.gateRunningCount ?? 0} running · {day.gateEvaluationCount ?? 0} evaluated · {day.gateUnevaluatedExecutionCount ?? 0} executions without an attributable gate outcome
                </span>
                <span>
                  Performance thresholds: {day.thresholdPassedCount ?? 0} passed · {day.thresholdFailedCount ?? 0} failed · {day.thresholdEvaluationCount ?? 0} evaluated · {day.performanceExecutionWithoutThresholdCount ?? 0} load/stress executions without threshold evidence
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
          {executionEvidenceRefreshError && (
            <p className="form-error" role="alert">{executionEvidenceRefreshError}</p>
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
                  <QualityAction
                    intent="quiet"
                    onClick={() => void inspectExecution(execution)}
                  >
                    <Eye size={14} /> Inspect execution detail
                  </QualityAction>
                  <ExecutionEvidenceMetadata execution={execution} />
                  <ExecutionEvidenceCoverage
                    execution={execution}
                    onRefresh={() => void refreshExecutionEvidence(execution)}
                    refreshing={refreshingExecutionEvidenceId === execution.id}
                  />
                  <ExecutionLinkageEvidence execution={execution} />
                  <ExecutionEvidenceLinks execution={execution} />
                  <ExecutionGateEvidence
                    execution={execution}
                  />
                  <ExecutionThresholdEvidence execution={execution} />
                  <ExecutionSourceLink execution={execution} />
                  <ExecutionAttemptHistory execution={execution} />
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
                    {pair.total} observations · {Math.round(pair.passRate * 100)}% passed among terminal outcomes
                  </small>
                  <small>
                    {pair.latestCompletedAt ? (
                      <>Last completed <time dateTime={pair.latestCompletedAt}>{new Date(pair.latestCompletedAt).toLocaleString()}</time></>
                    ) : 'No completed run yet'}
                  </small>
                  {(pair.revisionCount ?? pair.revisions?.length ?? 0) > 0 ? (
                    <small title={pair.revisions?.join(', ') ?? pair.latestRevision}>
                      {(pair.revisionCount ?? pair.revisions?.length) === 1
                        ? `Source revision ${(pair.latestRevision ?? pair.revisions?.[0] ?? '').slice(0, 12)}`
                        : `Observed across ${pair.revisionCount ?? pair.revisions?.length} source revisions · Latest ${(pair.latestRevision ?? pair.revisions?.[0] ?? '').slice(0, 12)}`}
                    </small>
                  ) : null}
                  {(pair.policySourcePath || pair.gateSourcePath) && (
                    <small>
                      {pair.policySourcePath ?? pair.policyArtifactId} →{' '}
                      {pair.gateSourcePath ?? pair.gateArtifactId}
                    </small>
                  )}
                  <QualityAction
                    intent="quiet"
                    onClick={() => {
                      setExecutionRepositoryId(pair.repositoryId)
                      setExecutionPolicyArtifactId(pair.policyArtifactId)
                      setExecutionGateArtifactId(pair.gateArtifactId)
                    }}
                  >
                    Inspect execution evidence
                  </QualityAction>
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

export function App({
  getToken,
  getTenantId,
  onSignOut,
}: {
  getToken?: () => string | null
  getTenantId?: () => string | null
  onSignOut?: () => void
} = {}) {
  const [view, setView] = useState<View>('overview')
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState<Error>()
  const [organizations, setOrganizations] =
    useState<OrganizationQualitySummary[]>()
  const [loading, setLoading] = useState(true)
  const reloadGeneration = useRef(0)
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
  useEffect(() => configurePlatformSecurity(getToken, getTenantId), [getTenantId, getToken])
  const reload = useCallback(async () => {
    const generation = ++reloadGeneration.current
    setLoading(true)
    setData(null)
    setOrganizations(undefined)
    setError(undefined)
    try {
      const portfolio = await api.portfolio()
      if (generation !== reloadGeneration.current) return
      setData(portfolio)
      setError(undefined)
      try {
        const availableOrganizations = await api.platformOrganizations()
        if (generation === reloadGeneration.current)
          setOrganizations(availableOrganizations)
      } catch {
        if (generation === reloadGeneration.current)
          setOrganizations(undefined)
      }
    } catch (value) {
      if (generation === reloadGeneration.current)
        setError(value instanceof Error ? value : new Error(String(value)))
    } finally {
      if (generation === reloadGeneration.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [portalContext, reload])
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
        {onSignOut && <QualityAction className="sidebar-signout" intent="quiet" onClick={onSignOut}><LogOut size={14} /> Sign out</QualityAction>}
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
                <strong>{
                  error instanceof CatalogApiError && ['TENANT_FORBIDDEN', 'TENANT_UNRESOLVED', 'TENANT_CONTEXT_MISMATCH'].includes(error.code ?? '')
                    ? 'Workspace access unavailable'
                    : 'Catalog API unavailable'
                }</strong>
                <span>{error.message}</span>
              </div>
              {onSignOut && error instanceof CatalogApiError && ['TENANT_FORBIDDEN', 'TENANT_UNRESOLVED', 'TENANT_CONTEXT_MISMATCH'].includes(error.code ?? '') ? (
                <QualityAction intent="secondary" onClick={onSignOut}>
                  Choose another workspace
                </QualityAction>
              ) : (
                <QualityAction intent="secondary" onClick={() => void reload()}>
                  Retry
                </QualityAction>
              )}
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
