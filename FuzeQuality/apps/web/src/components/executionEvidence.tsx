import type { QualityArtifact, TestExecution } from '@fuzequality/contracts'
import { artifactWorkflowExecutionKind } from '@fuzequality/contracts/workflow-execution'
import { ExternalLink } from 'lucide-react'
import { QualityAction } from './primitives'

const THRESHOLD_OPERATOR_LABELS = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
} as const

/** Defensive boundary for legacy rows written before the HTTPS ingestion contract. */
export function safeExecutionHref(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function evidenceLinkAction(link: TestExecution['evidenceLinks'][number]) {
  const href = safeExecutionHref(link.url)
  if (href && /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+\/artifacts\/\d+$/i.test(href)) {
    return 'Download '
  }
  return link.kind === 'video' ? 'Watch ' : 'Open '
}

export function ExecutionSourceLink({ execution }: { execution: TestExecution }) {
  const href = safeExecutionHref(execution.sourceUrl)
  if (!href) return null
  return (
    <a className="execution-source" href={href} target="_blank" rel="noreferrer">
      Open CI run <ExternalLink size={13} />
    </a>
  )
}

/** Finds the newest ingested run matching one scanner-verified performance definition. */
export function latestPerformanceExecution(
  artifact: QualityArtifact,
  executions: TestExecution[],
  branch?: string,
  headRepository?: string,
): TestExecution | undefined {
  const executionKind = artifactWorkflowExecutionKind(artifact)
  if (executionKind !== 'load' && executionKind !== 'stress') return undefined
  return executions
    .filter(execution =>
      execution.repositoryId === artifact.repositoryId &&
      (!branch || execution.branch === branch) &&
      (!headRepository || execution.provider !== 'github-actions' || execution.headRepository?.toLowerCase() === headRepository.toLowerCase()) &&
      execution.kind === executionKind &&
      execution.workflowPath === artifact.sourcePath
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.completedAt ?? left.startedAt ?? '')
      const rightTime = Date.parse(right.completedAt ?? right.startedAt ?? '')
      const comparableLeft = Number.isFinite(leftTime) ? leftTime : -Infinity
      const comparableRight = Number.isFinite(rightTime) ? rightTime : -Infinity
      return comparableRight - comparableLeft || right.attempt - left.attempt
    })[0]
}

/** Finds the newest ingested run for one scanner-detected post-production workflow. */
export function latestPostProductionExecution(
  artifact: QualityArtifact,
  executions: TestExecution[],
  branch?: string,
  headRepository?: string,
): TestExecution | undefined {
  if (artifact.kind !== 'post-production-test') return undefined
  return executions
    .filter(execution =>
      execution.repositoryId === artifact.repositoryId &&
      (!branch || execution.branch === branch) &&
      (!headRepository || execution.provider !== 'github-actions' || execution.headRepository?.toLowerCase() === headRepository.toLowerCase()) &&
      execution.kind === 'post-production' &&
      execution.workflowPath === artifact.sourcePath
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.completedAt ?? left.startedAt ?? '')
      const rightTime = Date.parse(right.completedAt ?? right.startedAt ?? '')
      const comparableLeft = Number.isFinite(leftTime) ? leftTime : -Infinity
      const comparableRight = Number.isFinite(rightTime) ? rightTime : -Infinity
      return comparableRight - comparableLeft || right.attempt - left.attempt
    })[0]
}

/** Finds the newest ingested run for one scanner-detected integration workflow. */
export function latestIntegrationExecution(
  artifact: QualityArtifact,
  executions: TestExecution[],
  branch?: string,
  headRepository?: string,
): TestExecution | undefined {
  if (artifact.kind !== 'integration-test') return undefined
  return executions
    .filter(execution =>
      execution.repositoryId === artifact.repositoryId &&
      (!branch || execution.branch === branch) &&
      (!headRepository || execution.provider !== 'github-actions' || execution.headRepository?.toLowerCase() === headRepository.toLowerCase()) &&
      execution.kind === 'integration' &&
      execution.workflowPath === artifact.sourcePath
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.completedAt ?? left.startedAt ?? '')
      const rightTime = Date.parse(right.completedAt ?? right.startedAt ?? '')
      const comparableLeft = Number.isFinite(leftTime) ? leftTime : -Infinity
      const comparableRight = Number.isFinite(rightTime) ? rightTime : -Infinity
      return comparableRight - comparableLeft || right.attempt - left.attempt
    })[0]
}
export function executionDurationLabel(
  startedAt?: string,
  completedAt?: string
): string | undefined {
  if (!startedAt || !completedAt) return undefined
  const started = Date.parse(startedAt)
  const completed = Date.parse(completedAt)
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(completed) ||
    completed < started
  )
    return undefined

  return durationMsLabel(completed - started)
}

export function durationMsLabel(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined
  const totalSeconds = Math.round(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** App-specific execution provenance composed from semantic HTML primitives. */
export function ExecutionEvidenceMetadata({
  execution,
}: {
  execution: TestExecution
}) {
  const duration = executionDurationLabel(
    execution.startedAt,
    execution.completedAt
  )
  if (
    execution.externalRunId === undefined &&
    execution.attempt === undefined &&
    execution.branch === undefined &&
    execution.headRepository === undefined &&
    execution.workflowPath === undefined &&
    !duration
  )
    return null

  return (
    <dl className="execution-metadata" aria-label="Execution provider metadata">
      <div data-field="suite-kind">
        <dt>Suite classification</dt>
        <dd>{execution.kind}</dd>
      </div>
      {execution.externalRunId !== undefined && (
        <div data-field="provider-run-id">
          <dt>Provider run ID</dt>
          <dd>
            {execution.provider} · {execution.externalRunId}
          </dd>
        </div>
      )}
      {execution.attempt !== undefined && (
        <div data-field="attempt">
          <dt>Attempt</dt>
          <dd>{execution.attempt}</dd>
        </div>
      )}
      {execution.branch !== undefined && (
        <div data-field="source-branch">
          <dt>Source branch</dt>
          <dd><code>{execution.branch}</code></dd>
        </div>
      )}
      {execution.headRepository !== undefined && (
        <div data-field="head-repository">
          <dt>Source repository</dt>
          <dd><code>{execution.headRepository}</code></dd>
        </div>
      )}
      {execution.workflowPath !== undefined && (
        <div data-field="workflow-path">
          <dt>Workflow file</dt>
          <dd><code>{execution.workflowPath}</code></dd>
        </div>
      )}
      {duration && (
        <div data-field="duration">
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </div>
      )}
    </dl>
  )
}

/** Reviewed performance assertions, with the API-derived outcome kept visible. */
export function ExecutionThresholdEvidence({
  execution,
}: {
  execution: TestExecution
}) {
  const thresholds = execution.thresholds ?? []
  if (!thresholds.length) return null

  return (
    <section
      className="execution-thresholds"
      aria-label="Execution threshold evidence"
    >
      <strong>Threshold evidence</strong>
      <ul>
        {thresholds.map((threshold, index) => (
          <li key={`${threshold.metric}-${index}`}>
            <span className="execution-threshold-metric">{threshold.metric}</span>
            <code>
              {threshold.observed}
              {threshold.unit ? ` ${threshold.unit}` : ''}{' '}
              {THRESHOLD_OPERATOR_LABELS[threshold.operator]} {threshold.target}
              {threshold.unit ? ` ${threshold.unit}` : ''}
            </code>
            <span
              className={`status-pill ${threshold.passed ? 'status-passed' : 'status-failed'}`}
            >
              {threshold.passed ? 'Passed' : 'Failed'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Per-pair gate results captured by the producer or an unambiguous workflow link. */
export function ExecutionGateEvidence({
  execution,
  artifacts = [],
}: {
  execution: TestExecution
  artifacts?: QualityArtifact[]
}) {
  const gateEvaluations = execution.gateEvaluations ?? []
  if (!gateEvaluations.length) return null
  const artifactById = new Map(artifacts.flatMap(artifact => [
    [artifact.id, artifact] as const,
    ...(artifact.logicalId ? [[artifact.logicalId, artifact] as const] : []),
  ]))

  return (
    <section className="execution-gates" aria-label="Policy gate evidence">
      <strong>Policy–gate evidence</strong>
      <span className="execution-evidence-count">
        {gateEvaluations.length} evaluated {gateEvaluations.length === 1 ? 'pair' : 'pairs'}
      </span>
      <ul>
        {gateEvaluations.map(evaluation => {
          const policy = artifactById.get(evaluation.policyArtifactId)
          const gate = artifactById.get(evaluation.gateArtifactId)
          return (
            <li key={`${evaluation.policyArtifactId}:${evaluation.gateArtifactId}`}>
              <div className="execution-gate-pair">
                <span>
                  <strong>{policy?.title ?? evaluation.policyArtifactId}</strong>
                  <span aria-hidden="true"> → </span>
                  <strong>{gate?.title ?? evaluation.gateArtifactId}</strong>
                </span>
                {(policy || gate) && (
                  <code>
                    {[policy?.sourcePath, gate?.sourcePath]
                      .filter(Boolean)
                      .join(' → ')}
                  </code>
                )}
              </div>
              {evaluation.detail && <span>{evaluation.detail}</span>}
              <span className={`status-pill status-${evaluation.status}`}>
                {evaluation.status}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Watchable/downloadable run artifacts, tied to the provider attempt above. */
export function ExecutionEvidenceLinks({
  execution,
}: {
  execution: TestExecution
}) {
  const evidenceLinks = [...new Map(
    (execution.evidenceLinks ?? [])
      .filter(link => safeExecutionHref(link.url))
      .map(link => [`${link.kind}:${link.url}`, link])
  ).values()].sort((left, right) => {
    const priority = { video: 0, report: 1, trace: 2, screenshot: 3, log: 4, other: 5 }
    return priority[left.kind] - priority[right.kind] || left.name.localeCompare(right.name)
  })
  if (!evidenceLinks.length) return null

  return (
    <section className="execution-evidence-links" aria-label="Run evidence">
      <strong>Run evidence</strong>
      <ul>
        {evidenceLinks.map(link => (
          <li key={`${link.kind}:${link.url}`}>
            <span className="status-pill">{link.kind}</span>
            <a href={link.url} target="_blank" rel="noreferrer">
              {evidenceLinkAction(link)}{link.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Makes sparse provider lifecycle events distinguishable from detailed test evidence. */
export function ExecutionEvidenceCoverage({
  execution,
  onRefresh,
  refreshing = false,
}: {
  execution: TestExecution
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const thresholds = execution.thresholds?.length ?? 0
  const links = (execution.evidenceLinks ?? []).filter(link => !(execution.provider === 'github-actions' && link.kind === 'report' && link.name === 'GitHub Actions artifacts' && link.url.endsWith('#artifacts'))).length
  const hasVideo = (execution.evidenceLinks ?? []).some(link => link.kind === 'video')
  const gatePairs = execution.gateEvaluations?.length ?? 0
  const missingThresholds = ['load', 'stress'].includes(execution.kind) && !thresholds
  const collection = execution.evidenceCollection
  const collectionFailure = collection?.status === 'unavailable'
    ? collection.errorCode === 'PROVIDER_TIMEOUT'
      ? 'Provider artifact lookup timed out'
      : collection.errorCode === 'PROVIDER_RESPONSE_INVALID'
        ? 'Provider returned an invalid artifact response'
        : 'Provider artifact lookup was unavailable'
    : undefined
  const collectionPartial = collection?.status === 'partial'
  const canRefresh = execution.provider === 'github-actions' &&
    execution.status !== 'running' &&
    Boolean(onRefresh)
  const refreshLabel = collection?.status === 'complete'
    ? 'Reconcile provider evidence'
    : 'Refresh provider evidence'

  return (
    <section className="execution-evidence-coverage" aria-label="Execution evidence coverage">
      <strong>Evidence coverage</strong>
      <small>{thresholds} thresholds · {links} artifacts · {gatePairs} policy–gate outcomes</small>
      {collection && (
        <small>
          Provider evidence checked{' '}
          <time dateTime={collection.checkedAt}>{new Date(collection.checkedAt).toLocaleString()}</time>
        </small>
      )}
      {!collection && (
        <span className="status-pill status-running">
          Provider artifact discovery has not run; zero artifacts is not a verified result
        </span>
      )}
      {collectionFailure && (
        <span className="status-pill status-failed">
          {collectionFailure}; zero artifacts is not a verified result
        </span>
      )}
      {collectionPartial && (
        <span className="status-pill status-running">
          Provider result limit reached; showing prioritized evidence, including videos first
        </span>
      )}
      {collection?.status === 'complete' && !links && execution.kind !== 'post-production' && (
        <span className="status-pill status-passed">
          Provider checked; no durable artifacts reported
        </span>
      )}
      {execution.kind === 'post-production' && collection?.status === 'complete' && !hasVideo && (
        <span className="status-pill status-failed">
          Required post-production video evidence is missing
        </span>
      )}
      {canRefresh && (
        <QualityAction intent="quiet" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing provider evidence…' : refreshLabel}
        </QualityAction>
      )}
      {missingThresholds && (
        <span className="status-pill status-running">
          No performance threshold observations ingested
        </span>
      )}
    </section>
  )
}

/** Distinguishes evaluated policy/gate pairs from inventory-only associations. */
export function ExecutionLinkageEvidence({
  execution,
}: {
  execution: TestExecution
}) {
  const gatePairs = execution.gateEvaluations?.length ?? 0
  const policies = execution.policyArtifactIds?.length ?? 0
  const gates = execution.gateArtifactIds?.length ?? 0

  let label: string
  let detail: string
  let state: 'passed' | 'running' | 'failed'
  if (gatePairs) {
    label = 'Explicit outcome linkage'
    detail = `${gatePairs} policy–gate ${gatePairs === 1 ? 'pair' : 'pairs'} evaluated for this run`
    state = 'passed'
  } else if (policies === 1 && gates === 1) {
    label = 'Legacy one-to-one linkage'
    detail = 'Outcome is derived from this execution status; no explicit pair result was ingested'
    state = 'running'
  } else if (policies || gates) {
    label = 'Inventory linkage only'
    detail = `${policies} ${policies === 1 ? 'policy' : 'policies'} and ${gates} ${gates === 1 ? 'gate' : 'gates'} are associated, but no unambiguous pair outcome exists`
    state = 'running'
  } else {
    label = 'No policy–gate linkage'
    detail = 'This execution has no exact-revision policy or gate evidence'
    state = 'failed'
  }

  return (
    <section className="execution-linkage-evidence" aria-label="Policy gate linkage quality">
      <strong>Linkage quality</strong>
      <span className={`status-pill status-${state}`}>{label}</span>
      <small>{detail}</small>
    </section>
  )
}
