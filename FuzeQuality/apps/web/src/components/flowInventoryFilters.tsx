import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

export type FlowRevisionScope = 'all' | 'current'

export function FlowInventoryFilters({
  repositories,
  repositoryId,
  source,
  status,
  revisionScope,
  model,
  promptVersion,
  schemaVersion,
  onRepositoryIdChange,
  onSourceChange,
  onStatusChange,
  onRevisionScopeChange,
  onModelChange,
  onPromptVersionChange,
  onSchemaVersionChange,
}: {
  repositories: Repository[]
  repositoryId: string
  source: RepositoryFlowCandidate['source'] | ''
  status: RepositoryFlowCandidate['status'] | ''
  revisionScope: FlowRevisionScope
  model: string
  promptVersion: string
  schemaVersion: string
  onRepositoryIdChange: (value: string) => void
  onSourceChange: (value: RepositoryFlowCandidate['source'] | '') => void
  onStatusChange: (value: RepositoryFlowCandidate['status'] | '') => void
  onRevisionScopeChange: (value: FlowRevisionScope) => void
  onModelChange: (value: string) => void
  onPromptVersionChange: (value: string) => void
  onSchemaVersionChange: (value: string) => void
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
      <label>
        Analysis model
        <input value={model} placeholder="All models" onChange={event => onModelChange(event.target.value)} />
      </label>
      <label>
        Prompt version
        <input value={promptVersion} placeholder="All prompt versions" onChange={event => onPromptVersionChange(event.target.value)} />
      </label>
      <label>
        Schema version
        <input value={schemaVersion} placeholder="All schema versions" onChange={event => onSchemaVersionChange(event.target.value)} />
      </label>
    </div>
  )
}
