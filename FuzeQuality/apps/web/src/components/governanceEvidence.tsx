import type { PolicyGateEvaluation, QualityArtifact } from '@fuzequality/contracts'

const evidenceSignalLabels = {
  policy: 'Policy statement',
  gate: 'Gate statement',
  obligation: 'Requires',
  prohibition: 'Prohibits',
  ambiguous: 'Ambiguous',
} as const

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
    ...(evaluation.policyArtifactIds ?? []),
    ...(evaluation.gateArtifactIds ?? []),
  ]
  // Evaluations created before the evidence-context migration do not have
  // confidence or scope. Keep those records reviewable instead of allowing a
  // single legacy row to crash the entire intelligence workspace.
  const confidence = Number.isFinite(evaluation.confidence)
    ? `${Math.round(evaluation.confidence * 100)}%`
    : 'Unknown'
  const scope = evaluation.scope ?? { sourcePaths: [], subjects: [] }
  const passages = evaluation.evidencePassages ?? []

  return (
    <section
      className="governance-evidence"
      aria-label={`${evaluation.title} evidence`}
    >
      <dl>
        <div>
          <dt>Detector confidence</dt>
          <dd>{confidence}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{evaluation.revision}</dd>
        </div>
      </dl>
      <div className="governance-scope">
        <strong>Repository scope</strong>
        {scope.sourcePaths.length > 0 ? (
          <ul>
            {scope.sourcePaths.map(path => (
              <li key={path}><code>{path}</code></li>
            ))}
          </ul>
        ) : (
          <small>Repository scope was not recorded for this legacy evaluation.</small>
        )}
        {scope.subjects.length > 0 && (
          <small>Matched subjects: {scope.subjects.join(', ')}</small>
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
      {passages.length > 0 && (
        <div className="governance-passages" aria-label="Decisive policy passages">
          <strong>Decisive passages</strong>
          <ul>
            {passages.map((passage, index) => {
              const artifact = artifactsById.get(passage.artifactId)
              return (
                <li key={`${passage.artifactId}:${passage.signal}:${index}`}>
                  <span className={`status-pill governance-signal-${passage.signal}`}>
                    {evidenceSignalLabels[passage.signal]}
                  </span>
                  <q>{passage.text}</q>
                  <div className="governance-passage-source">
                    <strong>{artifact?.title ?? passage.artifactId}</strong>
                    <code>{passage.sourcePath}</code>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
