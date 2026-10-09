import type { TestExecution } from '@fuzequality/contracts'

const THRESHOLD_OPERATOR_LABELS = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
} as const

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

  const totalSeconds = Math.round((completed - started) / 1000)
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
    execution.workflowPath === undefined &&
    !duration
  )
    return null

  return (
    <dl className="execution-metadata" aria-label="Execution provider metadata">
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
}: {
  execution: TestExecution
}) {
  const gateEvaluations = execution.gateEvaluations ?? []
  if (!gateEvaluations.length) return null

  return (
    <section className="execution-gates" aria-label="Policy gate evidence">
      <strong>Policy–gate evidence</strong>
      <ul>
        {gateEvaluations.map(evaluation => (
          <li key={`${evaluation.policyArtifactId}:${evaluation.gateArtifactId}`}>
            <code>
              {evaluation.policyArtifactId} → {evaluation.gateArtifactId}
            </code>
            {evaluation.detail && <span>{evaluation.detail}</span>}
            <span
              className={`status-pill status-${evaluation.status}`}
            >
              {evaluation.status}
            </span>
          </li>
        ))}
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
  const evidenceLinks = execution.evidenceLinks ?? []
  if (!evidenceLinks.length) return null

  return (
    <section className="execution-evidence-links" aria-label="Run evidence">
      <strong>Run evidence</strong>
      <ul>
        {evidenceLinks.map(link => (
          <li key={`${link.kind}:${link.url}`}>
            <span className="status-pill">{link.kind}</span>
            <a href={link.url} target="_blank" rel="noreferrer">
              {link.kind === 'video' ? 'Watch ' : 'Open '}{link.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
