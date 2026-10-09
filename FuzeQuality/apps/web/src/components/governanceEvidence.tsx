import type { PolicyGateEvaluation, QualityArtifact } from '@fuzequality/contracts'

/** App-specific governance evidence composed from semantic HTML primitives. */
export function PolicyGateEvidence({
  evaluation,
  artifacts,
}: {
  evaluation: PolicyGateEvaluation
  artifacts: QualityArtifact[]
}) {
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]))
  const evidenceIds = [
    ...evaluation.policyArtifactIds,
    ...evaluation.gateArtifactIds,
  ]

  return (
    <section
      className="governance-evidence"
      aria-label={`${evaluation.title} evidence`}
    >
      <dl>
        <div>
          <dt>Detector confidence</dt>
          <dd>{Math.round(evaluation.confidence * 100)}%</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{evaluation.revision}</dd>
        </div>
      </dl>
      <div className="governance-scope">
        <strong>Repository scope</strong>
        <ul>
          {evaluation.scope.sourcePaths.map(path => (
            <li key={path}><code>{path}</code></li>
          ))}
        </ul>
        {evaluation.scope.subjects.length > 0 && (
          <small>Matched subjects: {evaluation.scope.subjects.join(', ')}</small>
        )}
      </div>
      <div className="governance-artifacts">
        <strong>Source evidence</strong>
        <ul>
          {evidenceIds.map(id => {
            const artifact = artifactsById.get(id)
            return (
              <li key={id}>
                <span>{artifact?.title ?? id}</span>
                {artifact && <code>{artifact.kind} · {artifact.sourcePath}</code>}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
