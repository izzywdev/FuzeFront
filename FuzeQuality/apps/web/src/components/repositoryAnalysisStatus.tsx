import type { Repository } from '@fuzequality/contracts'

export function RepositoryAnalysisStatus({ analysis }: { analysis: Repository['lastAnalysis'] }) {
  if (!analysis) return <span className="scan-status scan-never">analysis not run</span>
  const counts = analysis.counts
  return (
    <div className="repository-analysis-status" aria-label="Repository analysis status">
      <span className={`scan-status scan-${analysis.status}`}>analysis {analysis.status}</span>
      <small title={analysis.revision}>revision {analysis.revision.slice(0, 12)}</small>
      {counts && <small>{counts.deterministic} detected · {counts.proposed} AI proposals · {counts.evaluations} policy checks</small>}
      {analysis.errorCode && <small>Reviewed analysis unavailable; deterministic evidence remains available.</small>}
    </div>
  )
}
