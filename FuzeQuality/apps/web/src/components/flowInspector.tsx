import type { QualityArtifact, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { repositoryFlowHasCompleteAnalysisProvenance } from '@fuzequality/contracts/repository-flow'
import { AlertTriangle, Network, Sparkles, X } from 'lucide-react'
import { QualityDetailModal, QualityIconAction } from './primitives'

export function flowArtifactTargetIds(
  flow: RepositoryFlowCandidate,
  knownArtifactIds: Iterable<string> = [],
): string[] {
  const ids = new Set([
    ...flow.steps.flatMap(step => step.targetIds),
    ...flow.wireframe.nodes.flatMap(node => node.targetIds),
  ])
  const known = new Set(knownArtifactIds)
  flow.evidence.forEach(evidence => {
    if ((flow.source === 'litellm' && flow.analysis) || evidence.startsWith('artifact:') || known.has(evidence)) ids.add(evidence)
  })
  return [...ids]
}

export function unavailableFlowArtifactTargetIds(
  flow: RepositoryFlowCandidate,
  knownArtifactIds: Iterable<string>,
) {
  const known = new Set(knownArtifactIds)
  return [...new Set([
    ...(flow.source === 'litellm' && flow.analysis ? flow.evidence : []),
    ...flow.steps.flatMap(step => step.targetIds),
    ...flow.wireframe.nodes.flatMap(node => node.targetIds),
  ])].filter(targetId => !known.has(targetId))
}

export function promptEvidenceLabel(analysis: NonNullable<RepositoryFlowCandidate['analysis']>) {
  if (analysis.inputArtifactCount === undefined || analysis.promptArtifactCount === undefined) return undefined
  const omitted = analysis.promptOmittedArtifactCount ?? Math.max(
    analysis.inputArtifactCount - analysis.promptArtifactCount,
    0,
  )
  const qualifiers: string[] = []
  if (omitted > 0) qualifiers.push(`${omitted} ${omitted === 1 ? 'artifact' : 'artifacts'} omitted`)
  if (analysis.promptContentTruncated === true) qualifiers.push('source content truncated')
  if (!analysis.promptTruncated) qualifiers.push('complete')
  else if (!qualifiers.length) qualifiers.push('bounded')
  return `${analysis.promptArtifactCount} of ${analysis.inputArtifactCount} repository artifacts supplied · ${qualifiers.join(' · ')}`
}

export function FlowInspector({
  open,
  flow,
  repositoryLabel,
  artifacts,
  loading = false,
  error,
  evidenceError,
  onClose,
}: {
  open: boolean
  flow?: RepositoryFlowCandidate
  repositoryLabel?: string
  artifacts: QualityArtifact[]
  loading?: boolean
  error?: string
  evidenceError?: string
  onClose: () => void
}) {
  const artifactsById = new Map(artifacts.flatMap(artifact => [
    [artifact.id, artifact] as const,
    ...(artifact.logicalId ? [[artifact.logicalId, artifact] as const] : []),
  ]))
  const evidenceIds = flow ? flowArtifactTargetIds(flow, artifactsById.keys()) : []
  const unavailableTargetIds = flow
    ? unavailableFlowArtifactTargetIds(flow, artifactsById.keys())
    : []
  const evidencePassages = flow
    ? flow.evidence.filter(evidence => !evidenceIds.includes(evidence))
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
            {flow.wireframe.nodes.length === 0 && (
              <div className="flow-inspector-state form-error" role="alert">
                <AlertTriangle size={16} /> No reviewable wireframe is stored for this flow. Do not confirm it until repository analysis is regenerated.
              </div>
            )}
            {evidenceError && (
              <div className="flow-inspector-state form-error" role="alert">
                <AlertTriangle size={16} /> Exact revision evidence could not be loaded: {evidenceError}
              </div>
            )}
            {!evidenceError && unavailableTargetIds.length > 0 && (
              <div className="flow-inspector-state form-error" role="alert">
                <AlertTriangle size={16} />
                {unavailableTargetIds.length} artifact reference {unavailableTargetIds.length === 1 ? 'is' : 'are'} unavailable in this exact repository revision. Do not confirm this flow until its evidence is regenerated.
              </div>
            )}
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
            {flow.steps.length === 0 && (
              <div className="flow-inspector-state form-error" role="alert">
                <AlertTriangle size={16} /> No reviewable interaction steps are stored for this flow. Do not confirm it until repository analysis is regenerated.
              </div>
            )}
          </section>

          <section className="flow-inspector-section" aria-label="Flow provenance">
            <div className="flow-inspector-heading">
              <Sparkles size={15} />
              <div>
                <strong>Analysis provenance</strong>
                <small>Unreviewed model output never becomes authoritative automatically.</small>
              </div>
            </div>
            {flow.analysis && repositoryFlowHasCompleteAnalysisProvenance(flow) ? (
              <>
                <dl className="flow-analysis-provenance">
                  <div><dt>Provider</dt><dd>{flow.analysis.provider}</dd></div>
                  <div><dt>Model</dt><dd>{flow.analysis.model}</dd></div>
                  <div><dt>Prompt</dt><dd>{flow.analysis.promptVersion}</dd></div>
                  <div><dt>Schema</dt><dd>{flow.analysis.schemaVersion}</dd></div>
                  {flow.analysis.inputArtifactCount !== undefined &&
                    flow.analysis.promptArtifactCount !== undefined && (
                      <div>
                        <dt>Prompt evidence</dt>
                        <dd>{promptEvidenceLabel(flow.analysis)}</dd>
                      </div>
                    )}
                  {flow.analysis.grounding && (
                    <div>
                      <dt>Model grounding</dt>
                      <dd>
                        {flow.analysis.grounding.groundedArtifactCount} of {flow.analysis.grounding.referencedArtifactCount} artifact references verified
                      </dd>
                    </div>
                  )}
                </dl>
                {flow.analysis.grounding && (
                  flow.analysis.grounding.rejectedArtifactCount > 0 ||
                  flow.analysis.grounding.ungroundedStepCount > 0
                ) && (
                  <div className="flow-inspector-state form-error" role="alert">
                    <AlertTriangle size={16} />
                    Model output included {flow.analysis.grounding.rejectedArtifactCount} unverified artifact reference{flow.analysis.grounding.rejectedArtifactCount === 1 ? '' : 's'} and {flow.analysis.grounding.ungroundedStepCount} step{flow.analysis.grounding.ungroundedStepCount === 1 ? '' : 's'} without grounded targets. Review the remaining evidence before confirming this flow.
                  </div>
                )}
              </>
            ) : flow.source === 'litellm' ? (
              <div className="flow-inspector-state form-error" role="alert">
                <AlertTriangle size={16} />
                This legacy FuzeInfra LiteLLM proposal has no stored model, prompt, and schema provenance. Do not confirm it; regenerate repository analysis or reject the proposal.
              </div>
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
            {evidencePassages.length > 0 && (
              <div className="flow-inspector-passages">
                <strong>Repository evidence passages</strong>
                <ul>
                  {evidencePassages.map(passage => (
                    <li key={passage}><code>{passage}</code></li>
                  ))}
                </ul>
              </div>
            )}
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
