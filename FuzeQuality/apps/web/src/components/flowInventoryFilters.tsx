import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

export type FlowRevisionScope = 'all' | 'current'

export function FlowInventoryFilters({
  repositories,
  repositoryId,
  source,
  status,
  revisionScope,
  onRepositoryIdChange,
  onSourceChange,
  onStatusChange,
  onRevisionScopeChange,
}: {
  repositories: Repository[]
  repositoryId: string
  source: RepositoryFlowCandidate['source'] | ''
  status: RepositoryFlowCandidate['status'] | ''
  revisionScope: FlowRevisionScope
  onRepositoryIdChange: (value: string) => void
  onSourceChange: (value: RepositoryFlowCandidate['source'] | '') => void
  onStatusChange: (value: RepositoryFlowCandidate['status'] | '') => void
  onRevisionScopeChange: (value: FlowRevisionScope) => void
}) {
  return (
    <div className="catalog-filters" aria-label="UX flow inventory filters">
      <label>
        Repository
        <select value={repositoryId} onChange={event => onRepositoryIdChange(event.target.value)}>
          <option value="">All repositories</option>
          {repositories.map(repository => (
            <option key={repository.id} value={repository.id}>
              {repository.owner}/{repository.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Origin
        <select value={source} onChange={event => onSourceChange(event.target.value as RepositoryFlowCandidate['source'] | '')}>
          <option value="">All origins</option>
          <option value="deterministic">Deterministic</option>
          <option value="litellm">FuzeInfra LiteLLM</option>
        </select>
      </label>
      <label>
        Review state
        <select value={status} onChange={event => onStatusChange(event.target.value as RepositoryFlowCandidate['status'] | '')}>
          <option value="">All review states</option>
          <option value="proposed">Proposed</option>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>
      <label>
        Analysis revision
        <select value={revisionScope} onChange={event => onRevisionScopeChange(event.target.value as FlowRevisionScope)}>
          <option value="all">All revisions</option>
          <option value="current">Current repository revision</option>
        </select>
      </label>
    </div>
  )
}
