import { createHash } from 'node:crypto'
import type { CatalogFinding, CoverageProjection, Flow, Portfolio, Requirement } from '@fuzequality/contracts'

export const FLOW_COVERAGE_POLICY_VERSION = 'flow-orphans-v1'
export const FLOW_FINDING_SCHEMA_VERSION = '1.0'
export const DEFAULT_PLANNING_GRACE_MS = 48 * 60 * 60 * 1000

const inactiveStatus = /^(done|closed|resolved|cancelled|canceled|rejected)$/i
const analysisFindingTypes = new Set([
  'story-without-flow',
  'flow-without-active-story',
  'uncovered-acceptance-criterion',
  'uncovered-flow-step',
  'implementation-without-story',
  'missing-role-path',
  'missing-failure-path',
  'missing-cancel-path',
  'missing-retry-path',
])

export function isFlowCoverageFinding(type: string) {
  return analysisFindingTypes.has(type)
}

function findingId(type: string, subjectId: string) {
  return `flow-finding:${type}:${createHash('sha256').update(subjectId).digest('hex').slice(0, 16)}`
}

function requirementActive(requirement: Requirement) {
  return !inactiveStatus.test(requirement.status.trim())
}

function revisionFor(requirement?: Requirement) {
  return requirement ? `${requirement.jiraKey}@${requirement.updatedAt}` : undefined
}

function makeFinding(
  type: string,
  subjectId: string,
  severity: CatalogFinding['severity'],
  title: string,
  detail: string,
  generatedAt: string,
  options: Pick<CatalogFinding, 'repositoryId' | 'sourceRevision' | 'evidence'> = {},
): CatalogFinding {
  return {
    id: findingId(type, subjectId),
    subjectId,
    type,
    severity,
    title,
    detail,
    status: 'open',
    policyVersion: FLOW_COVERAGE_POLICY_VERSION,
    schemaVersion: FLOW_FINDING_SCHEMA_VERSION,
    evidenceStrength: 'deterministic',
    generatedAt,
    auditHistory: [{ action: 'calculated', at: generatedAt, detail: FLOW_COVERAGE_POLICY_VERSION }],
    ...options,
  }
}

function confirmedFlows(portfolio: Portfolio) {
  return portfolio.flows.filter(flow => flow.status === 'confirmed')
}

function hasTerm(flow: Flow, pattern: RegExp) {
  return flow.steps.some(step => pattern.test(`${step.action} ${step.expectedOutcome}`))
}

export function buildFlowCoverageProjection(
  portfolio: Portfolio,
  options: { now?: Date; planningGraceMs?: number } = {},
): CoverageProjection {
  const now = options.now ?? new Date()
  const generatedAt = now.toISOString()
  const grace = options.planningGraceMs ?? DEFAULT_PLANNING_GRACE_MS
  const requirements = portfolio.requirements.filter(requirement => requirement.issueType === 'Story')
  const activeRequirements = requirements.filter(requirementActive)
  const activeById = new Map(activeRequirements.map(requirement => [requirement.id, requirement]))
  const flows = confirmedFlows(portfolio)
  const findings: CatalogFinding[] = []

  for (const requirement of activeRequirements) {
    const updated = Date.parse(requirement.updatedAt)
    if (Number.isFinite(updated) && now.getTime() - updated < grace) continue
    const requirementFlows = flows.filter(flow => flow.requirementId === requirement.id)
    if (!requirementFlows.length) {
      findings.push(makeFinding(
        'story-without-flow', requirement.id, 'high',
        `${requirement.jiraKey} has no confirmed user flow`,
        'The active story has passed its planning grace period without an accepted, implementable flow.',
        generatedAt,
        { sourceRevision: revisionFor(requirement), evidence: [requirement.jiraKey, requirement.updatedAt] },
      ))
      continue
    }

    for (const criterion of requirement.acceptanceCriteria ?? []) {
      const target = `criterion:${criterion.fingerprint}`
      if (!requirementFlows.some(flow => flow.steps.some(step => step.targetIds.includes(target)))) {
        findings.push(makeFinding(
          'uncovered-acceptance-criterion', `${requirement.id}:${criterion.fingerprint}`, 'high',
          `${requirement.jiraKey} criterion ${criterion.position} is not represented in its flow`,
          criterion.text,
          generatedAt,
          { sourceRevision: revisionFor(requirement), evidence: [target] },
        ))
      }
    }
  }

  for (const flow of flows) {
    const requirement = activeById.get(flow.requirementId)
    if (!requirement) {
      findings.push(makeFinding(
        'flow-without-active-story', flow.id, 'high', `${flow.title} has no active story`,
        'The confirmed flow is detached from an active Jira story and may describe obsolete or undocumented behavior.',
        generatedAt,
        { evidence: [flow.requirementId] },
      ))
    }
    for (const step of flow.steps.filter(step => step.targetIds.length === 0)) {
      findings.push(makeFinding(
        'uncovered-flow-step', step.id, 'high', `${flow.title}: step ${step.position} has no implementation target`,
        `${step.actor}: ${step.action} -> ${step.expectedOutcome}`,
        generatedAt,
        { sourceRevision: revisionFor(requirement), evidence: [`flow:${flow.id}`, `variant:${step.variant}`] },
      ))
    }
    if (!(flow.authorizationBoundaries?.length || flow.steps.some(step => step.variant !== 'main' && step.actor !== flow.steps[0]?.actor))) {
      findings.push(makeFinding('missing-role-path', flow.id, 'medium', `${flow.title} has no role or authorization path`, 'No confirmed role-denial or authorization boundary is documented.', generatedAt, { sourceRevision: revisionFor(requirement), evidence: [`flow:${flow.id}`] }))
    }
    if (!flow.steps.some(step => step.variant === 'error')) {
      findings.push(makeFinding('missing-failure-path', flow.id, 'medium', `${flow.title} has no failure path`, 'No confirmed error outcome is documented.', generatedAt, { sourceRevision: revisionFor(requirement), evidence: [`flow:${flow.id}`] }))
    }
    if (!hasTerm(flow, /\bcancel(?:led|ed|lation)?\b/i)) {
      findings.push(makeFinding('missing-cancel-path', flow.id, 'low', `${flow.title} has no cancellation path`, 'No confirmed cancellation behavior is documented.', generatedAt, { sourceRevision: revisionFor(requirement), evidence: [`flow:${flow.id}`] }))
    }
    if (!(flow.steps.some(step => step.variant === 'recovery') || hasTerm(flow, /\bretr(?:y|ies|ied)\b/i))) {
      findings.push(makeFinding('missing-retry-path', flow.id, 'low', `${flow.title} has no retry or recovery path`, 'No confirmed retry or recovery behavior is documented.', generatedAt, { sourceRevision: revisionFor(requirement), evidence: [`flow:${flow.id}`] }))
    }
  }

  const referencedTargets = new Set(flows.flatMap(flow => flow.steps.flatMap(step => step.targetIds)))
  for (const subject of [...portfolio.operations, ...portfolio.surfaces]) {
    if (referencedTargets.has(subject.id)) continue
    findings.push(makeFinding(
      'implementation-without-story', subject.id, 'medium',
      `${'method' in subject ? `${subject.method.toUpperCase()} ${subject.path}` : subject.name} is not linked to a confirmed story`,
      'The cataloged implementation is not referenced by any confirmed product flow.',
      generatedAt,
      { repositoryId: subject.repositoryId, sourceRevision: portfolio.repositories.find(item => item.id === subject.repositoryId)?.lastScanRevision, evidence: [subject.id] },
    ))
  }

  const byType: Record<string, number> = {}
  const bySeverity: CoverageProjection['metrics']['bySeverity'] = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findings) {
    byType[finding.type] = (byType[finding.type] ?? 0) + 1
    bySeverity[finding.severity]++
  }
  return { policyVersion: FLOW_COVERAGE_POLICY_VERSION, schemaVersion: FLOW_FINDING_SCHEMA_VERSION, generatedAt, findings, metrics: { total: findings.length, byType, bySeverity } }
}
