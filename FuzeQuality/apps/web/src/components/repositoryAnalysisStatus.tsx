import type { Repository } from '@fuzequality/contracts'
import { RefreshCw } from 'lucide-react'
import { QualityAction } from './primitives'

export function RepositoryAnalysisStatus({ analysis, onRetry, retrying = false }: { analysis: Repository['lastAnalysis']; onRetry?: () => void; retrying?: boolean }) {
  if (!analysis) return <span className="scan-status scan-never">analysis not run</span>
  const counts = analysis.counts
  const failure = analysis.status === 'failed' && !analysis.startedAt
    ? 'Reviewed analysis could not start after bounded retries; deterministic evidence remains available.'
    : analysis.errorCode === 'INTELLIGENCE_TIMEOUT'
    ? 'FuzeInfra LiteLLM timed out; deterministic evidence remains available.'
    : analysis.errorCode === 'INTELLIGENCE_INVALID_RESPONSE'
      ? 'FuzeInfra LiteLLM returned an invalid provider envelope or analysis that failed the reviewed schema; no unreviewed proposal was stored and deterministic evidence remains available.'
    : analysis.errorCode
      ? 'Reviewed analysis unavailable; deterministic evidence remains available.'
      : undefined
  return (
    <div className="repository-analysis-status" aria-label="Repository analysis status">
      <span className={`scan-status scan-${analysis.status}`}>analysis {analysis.status}</span>
      <small title={analysis.revision}>revision {analysis.revision.slice(0, 12)}</small>
      {counts && <small>{counts.deterministic} detected · {counts.proposed} AI proposals · {counts.evaluations} policy checks</small>}
      {failure && <small>{failure}</small>}
      {analysis.status === 'failed' && onRetry && (
        <QualityAction intent="quiet" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? 'spin' : undefined} size={13} />
          {retrying ? 'Requeueing…' : 'Retry reviewed analysis'}
        </QualityAction>
      )}
    </div>
  )
}
