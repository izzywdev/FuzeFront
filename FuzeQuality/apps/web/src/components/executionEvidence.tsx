import type { TestExecution } from '@fuzequality/contracts'

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
      {duration && (
        <div data-field="duration">
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </div>
      )}
    </dl>
  )
}
