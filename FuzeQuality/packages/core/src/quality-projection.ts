import type { CatalogFinding, CoverageProjection, PolicyGateEvaluation, Portfolio } from '@fuzequality/contracts'
import { buildFlowCoverageProjection, isFlowCoverageFinding } from './orphan-analysis'
import { buildRequirementReviewProjection, isRequirementReviewFinding } from './requirement-analysis'

export const QUALITY_INTELLIGENCE_POLICY_VERSION = 'quality-intelligence-v1'
export const QUALITY_INTELLIGENCE_SCHEMA_VERSION = '1.0'

export function isQualityIntelligenceFinding(type: string) {
  return isFlowCoverageFinding(type) || isRequirementReviewFinding(type) || type.startsWith('policy-gate-')
}

export function policyGateFindings(evaluations: PolicyGateEvaluation[]): CatalogFinding[] {
  return evaluations.map(item => ({ id: `finding:${item.id}`, repositoryId: item.repositoryId, subjectId: item.policyArtifactIds[0] ?? item.gateArtifactIds[0], type: `policy-gate-${item.kind}`, severity: item.severity, title: item.title, detail: item.detail, remediation: item.recommendation, status: 'open' as const, sourceRevision: item.revision, policyVersion: QUALITY_INTELLIGENCE_POLICY_VERSION, schemaVersion: QUALITY_INTELLIGENCE_SCHEMA_VERSION, evidence: [...item.policyArtifactIds, ...item.gateArtifactIds], generatedAt: item.createdAt, auditHistory: [{ action: 'calculated', at: item.createdAt, detail: item.kind }] }))
}

export function buildQualityIntelligenceProjection(
  portfolio: Portfolio,
  options: { now?: Date; planningGraceMs?: number; policyGateEvaluations?: PolicyGateEvaluation[] } = {},
): CoverageProjection {
  const flow = buildFlowCoverageProjection(portfolio, options)
  const requirement = buildRequirementReviewProjection(portfolio, options)
  const findings = [...flow.findings, ...requirement.findings, ...policyGateFindings(options.policyGateEvaluations ?? [])]
  const byType: Record<string, number> = {}
  const bySeverity: Record<CatalogFinding['severity'], number> = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findings) {
    byType[finding.type] = (byType[finding.type] ?? 0) + 1
    bySeverity[finding.severity]++
  }
  return {
    policyVersion: QUALITY_INTELLIGENCE_POLICY_VERSION,
    schemaVersion: QUALITY_INTELLIGENCE_SCHEMA_VERSION,
    generatedAt: flow.generatedAt,
    findings,
    metrics: { total: findings.length, byType, bySeverity },
  }
}
