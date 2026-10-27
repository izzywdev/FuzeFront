import type { SyncCursor } from '@fuzequality/contracts'
import { Database, RefreshCw } from 'lucide-react'
import { QualityAction } from './primitives'

const failureMessage: Record<NonNullable<SyncCursor['failureCode']>, string> = {
  JIRA_UNAVAILABLE: 'Jira requirements are temporarily unavailable.',
  INTELLIGENCE_UNAVAILABLE: 'FuzeInfra LiteLLM analysis is temporarily unavailable.',
  INTELLIGENCE_TIMEOUT: 'FuzeInfra LiteLLM analysis timed out and will be retried.',
  INTELLIGENCE_INVALID_RESPONSE: 'FuzeInfra LiteLLM returned an invalid analysis response.',
  SEMANTIC_INDEX_UNAVAILABLE: 'FuzeInfra semantic retrieval is temporarily unavailable.',
}

export function RequirementFreshnessStatus({ sync, onRetry, retrying = false }: { sync: SyncCursor; onRetry?: () => void; retrying?: boolean }) {
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
      {sync.freshnessStatus === 'failed' && onRetry && (
        <QualityAction intent="quiet" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? 'spin' : undefined} size={13} />
          {retrying ? 'Requeueing…' : 'Retry requirement analysis'}
        </QualityAction>
      )}
    </div>
  )
}
