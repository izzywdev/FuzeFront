import type { ReactNode } from 'react'
import type { PolicyGateEvaluation, QualityArtifact } from '@fuzequality/contracts'
import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { PolicyGateEvidence } from './governanceEvidence'
import { QualityDetailModal, QualityIconAction } from './primitives'

export function GovernanceInspector({
  open,
  evaluation,
  repositoryLabel,
  artifacts,
  loading = false,
  error,
  evidenceError,
  children,
  onClose,
}: {
  open: boolean
  evaluation?: PolicyGateEvaluation
  repositoryLabel?: string
  artifacts: QualityArtifact[]
  loading?: boolean
  error?: string
  evidenceError?: string
  children?: ReactNode
  onClose: () => void
}) {
  return (
    <QualityDetailModal
      open={open}
      onClose={onClose}
      title={evaluation?.title ?? 'Policy and gate inspector'}
    >
      <div className="flow-inspector-toolbar">
        <QualityIconAction label="Close policy and gate inspector" onClick={onClose}>
          <X size={15} />
        </QualityIconAction>
      </div>
      {loading ? (
        <div className="flow-inspector-state" role="status">
          Loading tenant-scoped governance evidence…
        </div>
      ) : error ? (
        <div className="flow-inspector-state form-error" role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : evaluation ? (
        <div className="flow-inspector governance-inspector">
          <header className="flow-inspector-summary">
            <div>
              <span className={`status-pill severity-${evaluation.severity}`}>
                {evaluation.severity}
              </span>
              <strong>{repositoryLabel ?? evaluation.repositoryId}</strong>
              <code>{evaluation.revision}</code>
              <code title="Stable governance finding identity">{evaluation.id}</code>
            </div>
            <div>
              <ShieldCheck size={15} />
              <span className="status-pill">{evaluation.kind}</span>
              <strong>{evaluation.reviewStatus}</strong>
            </div>
          </header>
          <section className="flow-inspector-section" aria-label="Governance finding">
            <div className="flow-inspector-heading">
              <ShieldCheck size={15} />
              <div>
                <strong>Finding and recommendation</strong>
                <small>Revision-scoped repository analysis awaiting human governance.</small>
              </div>
            </div>
            <p>{evaluation.detail}</p>
          </section>
          {evidenceError && (
            <div className="flow-inspector-state form-error" role="alert">
              <AlertTriangle size={16} /> {evidenceError}
            </div>
          )}
          <PolicyGateEvidence evaluation={evaluation} artifacts={artifacts} />
          {children}
        </div>
      ) : null}
    </QualityDetailModal>
  )
}
