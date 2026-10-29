import type { SyncCursor } from '@fuzequality/contracts'
import { Database, RefreshCw } from 'lucide-react'
import { QualityAction } from './primitives'

const failureMessage: Record<NonNullable<SyncCursor['failureCode']>, string> = {
  JIRA_UNAVAILABLE: 'Jira requirements are temporarily unavailable.',
  REQUIREMENT_QUEUE_UNAVAILABLE: 'Requirement analysis could not be queued. Retry when event delivery is available.',
  INTELLIGENCE_UNAVAILABLE: 'FuzeInfra LiteLLM analysis is temporarily unavailable.',
  INTELLIGENCE_TIMEOUT: 'FuzeInfra LiteLLM analysis timed out and will be retried.',
  INTELLIGENCE_INVALID_RESPONSE: 'FuzeInfra LiteLLM returned an invalid analysis response.',
  SEMANTIC_INDEX_UNAVAILABLE: 'FuzeInfra semantic retrieval is temporarily unavailable.',
}

export function RequirementFreshnessStatus({ sync, onRetry, retrying = false, retryError }: { sync: SyncCursor; onRetry?: () => void; retrying?: boolean; retryError?: string }) {
  const failure = sync.freshnessStatus === 'failed'
    ? sync.failureCode
      ? failureMessage[sync.failureCode]
      : 'Requirement analysis is temporarily unavailable.'
    : undefined

  return (
    <div
      className={`header-badge freshness-${sync.freshnessStatus}`}
      aria-label="Requirement analysis freshness"
      title={failure}
    >
      <Database /> Jira {sync.freshnessStatus}
      {failure && <small>{failure}</small>}
      {retryError && <small role="alert">{retryError}</small>}
      {sync.freshnessStatus === 'failed' && onRetry && (
        <QualityAction intent="quiet" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? 'spin' : undefined} size={13} />
          {retrying ? 'Requeueing…' : 'Retry requirement analysis'}
        </QualityAction>
      )}
    </div>
  )
}
