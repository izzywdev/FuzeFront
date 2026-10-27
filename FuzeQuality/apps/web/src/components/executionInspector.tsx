import type { ReactNode } from 'react'
import type { QualityArtifact, TestExecution } from '@fuzequality/contracts'
import { AlertTriangle, TestTube2, X } from 'lucide-react'
import {
  ExecutionEvidenceCoverage,
  ExecutionEvidenceLinks,
  ExecutionEvidenceMetadata,
  ExecutionGateEvidence,
  ExecutionLinkageEvidence,
  ExecutionSourceLink,
  ExecutionThresholdEvidence,
} from './executionEvidence'
import { QualityDetailModal, QualityIconAction } from './primitives'

export function ExecutionInspector({
  open,
  execution,
  repositoryLabel,
  artifacts,
  loading = false,
  error,
  evidenceError,
  refreshing = false,
  children,
  onRefresh,
  onClose,
}: {
  open: boolean
  execution?: TestExecution
  repositoryLabel?: string
  artifacts: QualityArtifact[]
  loading?: boolean
  error?: string
  evidenceError?: string
  refreshing?: boolean
  children?: ReactNode
  onRefresh?: () => void
  onClose: () => void
}) {
  return (
    <QualityDetailModal
      open={open}
      onClose={onClose}
      title={execution?.name ?? 'Execution evidence inspector'}
    >
      <div className="flow-inspector-toolbar">
        <QualityIconAction label="Close execution evidence inspector" onClick={onClose}>
          <X size={15} />
        </QualityIconAction>
      </div>
      {loading ? (
        <div className="flow-inspector-state" role="status">
          Loading tenant-scoped execution evidence…
        </div>
      ) : error ? (
        <div className="flow-inspector-state form-error" role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : execution ? (
        <div className="flow-inspector execution-inspector">
          <header className="flow-inspector-summary">
            <div>
              <span className={`status-pill status-${execution.status}`}>
                {execution.status}
              </span>
              <strong>{repositoryLabel ?? execution.repositoryId}</strong>
              <code>{execution.revision}</code>
              <code title="Stable execution evidence identity">{execution.id}</code>
            </div>
            <div>
              <TestTube2 size={15} />
              <span className="status-pill">{execution.kind}</span>
              <strong>{execution.provider}</strong>
            </div>
          </header>
          {execution.summary && (
            <section className="flow-inspector-section" aria-label="Execution summary">
              <div className="flow-inspector-heading">
                <TestTube2 size={15} />
                <div>
                  <strong>Retained execution result</strong>
                  <small>Immutable provider evidence for this exact repository revision and attempt.</small>
                </div>
              </div>
              <p>{execution.summary}</p>
            </section>
          )}
          {evidenceError && (
            <div className="flow-inspector-state form-error" role="alert">
              <AlertTriangle size={16} /> {evidenceError}
            </div>
          )}
          <ExecutionEvidenceMetadata execution={execution} />
          <ExecutionEvidenceCoverage
            execution={execution}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
          <ExecutionLinkageEvidence execution={execution} />
          <ExecutionEvidenceLinks execution={execution} />
          <ExecutionGateEvidence execution={execution} artifacts={artifacts} />
          <ExecutionThresholdEvidence execution={execution} />
          <ExecutionSourceLink execution={execution} />
          {children}
        </div>
      ) : null}
    </QualityDetailModal>
  )
}
