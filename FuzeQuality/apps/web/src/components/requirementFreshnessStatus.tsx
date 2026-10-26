import type { SyncCursor } from '@fuzequality/contracts'
import { Database } from 'lucide-react'

const failureMessage: Record<NonNullable<SyncCursor['failureCode']>, string> = {
  JIRA_UNAVAILABLE: 'Jira requirements are temporarily unavailable.',
  INTELLIGENCE_UNAVAILABLE: 'FuzeInfra LiteLLM analysis is temporarily unavailable.',
  SEMANTIC_INDEX_UNAVAILABLE: 'FuzeInfra semantic retrieval is temporarily unavailable.',
}

export function RequirementFreshnessStatus({ sync }: { sync: SyncCursor }) {
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
    </div>
  )
}
