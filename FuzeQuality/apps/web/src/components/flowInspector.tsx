import type { QualityArtifact, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { AlertTriangle, Network, Sparkles, X } from 'lucide-react'
import { QualityDetailModal, QualityIconAction } from './primitives'

export function FlowInspector({
  open,
  flow,
  repositoryLabel,
  artifacts,
  loading = false,
  error,
  onClose,
}: {
  open: boolean
  flow?: RepositoryFlowCandidate
  repositoryLabel?: string
  artifacts: QualityArtifact[]
  loading?: boolean
  error?: string
  onClose: () => void
}) {
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]))
  const evidenceIds = flow
    ? [...new Set([
        ...flow.evidence,
        ...flow.steps.flatMap(step => step.targetIds),
        ...flow.wireframe.nodes.flatMap(node => node.targetIds),
      ])]
    : []

  return (
    <QualityDetailModal
      open={open}
      onClose={onClose}
      title={flow?.title ?? 'UX flow inspector'}
    >
      <div className="flow-inspector-toolbar">
        <QualityIconAction label="Close flow inspector" onClick={onClose}>
          <X size={15} />
        </QualityIconAction>
      </div>
      {loading ? (
        <div className="flow-inspector-state" role="status">
          Loading tenant-scoped flow evidence…
        </div>
      ) : error ? (
        <div className="flow-inspector-state form-error" role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : flow ? (
        <div className="flow-inspector">
          <header className="flow-inspector-summary">
            <div>
              <span className={`flow-origin-badge flow-origin-${flow.source}`}>
                {flow.source === 'litellm'
                  ? 'Reviewable FuzeInfra LiteLLM proposal'
                  : 'Deterministic repository evidence'}
              </span>
              <strong>{repositoryLabel ?? flow.repositoryId}</strong>
              <code>{flow.revision}</code>
              <code title="Stable grounded-candidate identity">{flow.id}</code>
            </div>
            <div>
              <span className={`status-pill status-${flow.status}`}>{flow.status}</span>
              <strong>{Math.round(flow.confidence * 100)}% confidence</strong>
            </div>
          </header>

          <section className="flow-inspector-section" aria-label="Flow wireframe">
            <div className="flow-inspector-heading">
              <Network size={15} />
              <div>
                <strong>Wireframe sequence</strong>
                <small>Repository-derived interaction states in execution order.</small>
              </div>
            </div>
            <ol className="flow-inspector-wireframe">
              {flow.wireframe.nodes.map((node, index) => (
                <li key={`${node.label}:${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{node.label}</strong>
                  {node.targetIds.length > 0 && (
                    <small>
                      {node.targetIds.map(targetId => {
                        const artifact = artifactsById.get(targetId)
                        return artifact?.title ?? targetId
                      }).join(' · ')}
                    </small>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section className="flow-inspector-section" aria-label="Flow steps">
            <div className="flow-inspector-heading">
              <Network size={15} />
              <div>
                <strong>Expected interaction</strong>
                <small>Actor action, expected outcome, and implementation targets.</small>
              </div>
            </div>
            <ol className="flow-inspector-steps">
              {flow.steps.map((step, index) => (
                <li key={`${step.action}:${index}`}>
                  <b>{index + 1}</b>
                  <div>
                    <strong>{step.actor}</strong>
                    <span>{step.action}</span>
                    <small>Expected: {step.expectedOutcome}</small>
                    {step.targetIds.map(targetId => {
                      const artifact = artifactsById.get(targetId)
                      return (
                        <code key={targetId}>
                          {artifact
                            ? `${artifact.kind} · ${artifact.sourcePath} · ${artifact.title}`
                            : targetId}
                        </code>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="flow-inspector-section" aria-label="Flow provenance">
            <div className="flow-inspector-heading">
              <Sparkles size={15} />
              <div>
                <strong>Analysis provenance</strong>
                <small>Unreviewed model output never becomes authoritative automatically.</small>
              </div>
            </div>
            {flow.analysis ? (
              <dl className="flow-analysis-provenance">
                <div><dt>Provider</dt><dd>{flow.analysis.provider}</dd></div>
                <div><dt>Model</dt><dd>{flow.analysis.model}</dd></div>
                <div><dt>Prompt</dt><dd>{flow.analysis.promptVersion}</dd></div>
                <div><dt>Schema</dt><dd>{flow.analysis.schemaVersion}</dd></div>
                {flow.analysis.inputArtifactCount !== undefined &&
                  flow.analysis.promptArtifactCount !== undefined && (
                    <div>
                      <dt>Prompt evidence</dt>
                      <dd>
                        {flow.analysis.promptArtifactCount} of {flow.analysis.inputArtifactCount} artifacts
                        {flow.analysis.promptTruncated ? ' · bounded' : ' · complete'}
                      </dd>
                    </div>
                  )}
              </dl>
            ) : (
              <small>Deterministic analysis; no model invocation.</small>
            )}
            <ul className="flow-inspector-evidence">
              {evidenceIds.map(evidenceId => {
                const artifact = artifactsById.get(evidenceId)
                return (
                  <li key={evidenceId}>
                    <code>{artifact?.sourcePath ?? evidenceId}</code>
                    <span>{artifact?.title ?? 'Evidence reference unavailable in this catalog snapshot'}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {flow.reviewedAt && (
            <section className="flow-current-review" aria-label="Current UX flow review">
              <strong>{flow.status}</strong>
              <span>
                Reviewed {new Date(flow.reviewedAt).toLocaleString()}
                {flow.reviewedBy ? ` by ${flow.reviewedBy}` : ''}
              </span>
              {flow.reviewReason && <p>{flow.reviewReason}</p>}
            </section>
          )}
        </div>
      ) : null}
    </QualityDetailModal>
  )
}
