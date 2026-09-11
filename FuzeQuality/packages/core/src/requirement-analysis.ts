import { createHash } from 'node:crypto'
import type { CatalogFinding, CoverageProjection, Flow, Portfolio, Requirement, Suggestion } from '@fuzequality/contracts'

export const REQUIREMENT_REVIEW_POLICY_VERSION = 'requirement-review-v1'
export const REQUIREMENT_FINDING_SCHEMA_VERSION = '1.0'

const inactiveStatus = /^(done|closed|resolved|cancelled|canceled|rejected)$/i
const negation = /\b(?:no|not|never|cannot|can't|mustn't|must\s+not|shouldn't|should\s+not|without)\b/i
const requirementFindingTypes = new Set([
  'missing-acceptance-criteria',
  'incomplete-requirement-criteria',
  'conflicting-requirement-outcome',
])

export function isRequirementReviewFinding(type: string) {
  return requirementFindingTypes.has(type)
}

function active(requirement: Requirement) {
  return !inactiveStatus.test(requirement.status.trim())
}

function stableId(type: string, subject: string) {
  return `requirement-finding:${type}:${createHash('sha256').update(subject).digest('hex').slice(0, 16)}`
}

function signature(value: string) {
  return value
    .toLowerCase()
    .replace(negation, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 2 && !['the', 'and', 'that', 'with', 'from', 'then', 'when', 'shall', 'can'].includes(token))
    .sort()
    .join(' ')
}

function opposite(left: string, right: string) {
  const leftSignature = signature(left)
  return leftSignature.length >= 12 && leftSignature === signature(right) && negation.test(left) !== negation.test(right)
}

function flowsFor(requirement: Requirement, flows: Flow[]) {
  return flows.filter(flow => flow.requirementId === requirement.id && flow.status === 'confirmed')
}

function targetsFor(flows: Flow[]) {
  return [...new Set(flows.flatMap(flow => flow.steps.flatMap(step => step.targetIds)))]
}

function baseFinding(
  type: string,
  subject: string,
  requirement: Requirement,
  generatedAt: string,
  details: Pick<CatalogFinding, 'severity' | 'title' | 'detail' | 'evidenceStrength'> & Partial<CatalogFinding>,
): CatalogFinding {
  return {
    id: stableId(type, subject),
    subjectId: requirement.id,
    type,
    status: 'open',
    policyVersion: REQUIREMENT_REVIEW_POLICY_VERSION,
    schemaVersion: REQUIREMENT_FINDING_SCHEMA_VERSION,
    sourceRevision: `${requirement.jiraKey}@${requirement.updatedAt}`,
    generatedAt,
    auditHistory: [{ action: 'calculated', at: generatedAt, detail: REQUIREMENT_REVIEW_POLICY_VERSION }],
    ...details,
  }
}

function missingCriteriaFinding(requirement: Requirement, flows: Flow[], generatedAt: string) {
  const linkedFlows = flowsFor(requirement, flows)
  return baseFinding('missing-acceptance-criteria', requirement.id, requirement, generatedAt, {
    severity: 'high',
    title: `${requirement.jiraKey} has no acceptance criteria`,
    detail: 'The active story does not define independently reviewable outcomes before test planning.',
    evidenceStrength: 'deterministic',
    evidence: [requirement.jiraKey],
    sourcePassages: [requirement.summary, requirement.description].filter(Boolean),
    affectedFlowIds: linkedFlows.map(flow => flow.id),
    affectedTargetIds: targetsFor(linkedFlows),
    remediation: 'Clarify the expected outcomes in Jira, then resync requirements. FuzeQuality remains read-only.',
    remediationOptions: ['Add measurable acceptance criteria in Jira', 'Link an existing confirmed flow', 'Mark the story intentionally non-testable with an owner and expiry'],
  })
}

function semanticFinding(requirement: Requirement, suggestion: Suggestion, flows: Flow[], generatedAt: string) {
  const linkedFlows = flowsFor(requirement, flows)
  return baseFinding('incomplete-requirement-criteria', `${requirement.id}:${suggestion.id}`, requirement, generatedAt, {
    severity: suggestion.confidence >= 0.8 ? 'high' : 'medium',
    title: suggestion.title,
    detail: 'Requirement intelligence identified a behavior that is not expressed as an acceptance criterion.',
    evidenceStrength: 'semantic',
    confidence: suggestion.confidence,
    evidence: suggestion.evidence,
    sourcePassages: suggestion.evidence,
    affectedFlowIds: linkedFlows.map(flow => flow.id),
    affectedTargetIds: targetsFor(linkedFlows),
    remediation: 'Review the proposed criterion and update Jira manually if accepted.',
    remediationOptions: ['Accept as a planning finding', 'Reject the inference', 'Edit the Jira story and resync'],
  })
}

export function buildRequirementReviewProjection(
  portfolio: Portfolio,
  options: { now?: Date } = {},
): CoverageProjection {
  const generatedAt = (options.now ?? new Date()).toISOString()
  const findings: CatalogFinding[] = []
  const requirements = portfolio.requirements.filter(item => item.issueType === 'Story' && active(item))

  for (const requirement of requirements) {
    const criteria = requirement.acceptanceCriteria ?? []
    if (!criteria.length) findings.push(missingCriteriaFinding(requirement, portfolio.flows, generatedAt))

    for (let left = 0; left < criteria.length; left++) {
      for (let right = left + 1; right < criteria.length; right++) {
        if (!opposite(criteria[left].text, criteria[right].text)) continue
        const linkedFlows = flowsFor(requirement, portfolio.flows)
        findings.push(baseFinding(
          'conflicting-requirement-outcome',
          `${requirement.id}:${criteria[left].fingerprint}:${criteria[right].fingerprint}`,
          requirement,
          generatedAt,
          {
            severity: 'high',
            title: `${requirement.jiraKey} contains conflicting outcomes`,
            detail: `Acceptance criteria ${criteria[left].position} and ${criteria[right].position} express opposite results for the same behavior.`,
            evidenceStrength: 'deterministic',
            evidence: [`criterion:${criteria[left].fingerprint}`, `criterion:${criteria[right].fingerprint}`],
            sourcePassages: [criteria[left].text, criteria[right].text],
            affectedFlowIds: linkedFlows.map(flow => flow.id),
            affectedTargetIds: targetsFor(linkedFlows),
            remediation: 'Resolve the contradiction in Jira and resync before approving test cases.',
            remediationOptions: [`Keep criterion ${criteria[left].position}`, `Keep criterion ${criteria[right].position}`, 'Rewrite both criteria in Jira'],
          },
        ))
      }
    }
  }

  for (const suggestion of portfolio.suggestions.filter(item => item.type === 'missing-criteria' && item.state === 'proposed')) {
    const requirement = requirements.find(item => item.id === suggestion.requirementId)
    if (requirement) findings.push(semanticFinding(requirement, suggestion, portfolio.flows, generatedAt))
  }

  const byType: Record<string, number> = {}
  const bySeverity: CoverageProjection['metrics']['bySeverity'] = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findings) {
    byType[finding.type] = (byType[finding.type] ?? 0) + 1
    bySeverity[finding.severity]++
  }
  return {
    policyVersion: REQUIREMENT_REVIEW_POLICY_VERSION,
    schemaVersion: REQUIREMENT_FINDING_SCHEMA_VERSION,
    generatedAt,
    findings,
    metrics: { total: findings.length, byType, bySeverity },
  }
}
