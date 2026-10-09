import { createHash } from 'node:crypto'
import type { PolicyGateEvaluation, QualityArtifact, Repository } from '@fuzequality/contracts'

const keyTerms = (artifact: QualityArtifact) => new Set(
  `${artifact.title}\n${artifact.summary}\n${artifact.evidence.join('\n')}`
    .toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter(word => !new Set(['policy', 'gate', 'must', 'with', 'that', 'this', 'from', 'every', 'should', 'required', 'check', 'release']).has(word)) ?? [],
)

const sharedTerms = (left: QualityArtifact, right: QualityArtifact) =>
  [...keyTerms(left)].filter(term => keyTerms(right).has(term))

/** Links execution evidence only when a workflow name shares a specific subject with a gate. */
export function linkExecutionArtifacts(workflowName: string, artifacts: QualityArtifact[]) {
  const workflow = new Set(workflowName.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter(word => !new Set(['workflow', 'test', 'tests', 'check', 'suite', 'post', 'production']).has(word)) ?? [])
  const gates = artifacts.filter(item => item.kind === 'gate' && [...keyTerms(item)].some(term => workflow.has(term)))
  const gateTerms = new Set(gates.flatMap(item => [...keyTerms(item)]))
  const policies = artifacts.filter(item => item.kind === 'policy' && [...keyTerms(item)].some(term => gateTerms.has(term)))
  return { policyArtifactIds: policies.map(item => item.id), gateArtifactIds: gates.map(item => item.id) }
}

const id = (repositoryId: string, revision: string, kind: string, title: string) =>
  `pge_${createHash('sha256').update(`${repositoryId}:${revision}:${kind}:${title}`).digest('hex').slice(0, 24)}`

const scope = (artifacts: QualityArtifact[], subjects?: string[]): PolicyGateEvaluation['scope'] => ({
  sourcePaths: [...new Set(artifacts.map(item => item.sourcePath))],
  subjects: [...new Set(subjects ?? artifacts.flatMap(item => [...keyTerms(item)]))].slice(0, 12),
})

type EvidenceSignal = NonNullable<PolicyGateEvaluation['evidencePassages']>[number]['signal']

const policyPassages = (artifact: QualityArtifact) => [
  ...artifact.evidence,
  artifact.summary,
  artifact.title,
].map(text => text.trim()).filter(Boolean)

const prohibitionPattern = /\b(?:must not|shall not|may not|cannot|can't|prohibit(?:ed|s)?|forbid(?:den|s)?|never)\b/i
const obligationPattern = /\b(?:must|required|shall|always)\b/i
const ambiguousPattern = /\b(?:should|appropriate|reasonable|where possible|as needed|when practical)\b/i

function passageWithSignal(artifact: QualityArtifact, signal: EvidenceSignal) {
  const pattern = signal === 'prohibition'
    ? prohibitionPattern
    : signal === 'obligation'
      ? obligationPattern
      : signal === 'ambiguous'
        ? ambiguousPattern
        : undefined
  const passages = policyPassages(artifact)
  const text = pattern
    ? passages.find(candidate => pattern.test(
        signal === 'obligation' ? candidate.replace(prohibitionPattern, '') : candidate
      ))
    : passages[0]
  return text ? { artifactId: artifact.id, sourcePath: artifact.sourcePath, text, signal } : undefined
}

function policyPolarity(artifact: QualityArtifact): 'obligation' | 'prohibition' | undefined {
  const text = policyPassages(artifact).join(' ')
  if (prohibitionPattern.test(text)) return 'prohibition'
  return obligationPattern.test(text) ? 'obligation' : undefined
}

/** Conservative deterministic detector; recommendations are never applied automatically. */
export function evaluatePolicyGates(repository: Repository, revision: string, artifacts: QualityArtifact[], createdAt = new Date().toISOString()): PolicyGateEvaluation[] {
  const policies = artifacts.filter(item => item.kind === 'policy')
  const gates = artifacts.filter(item => item.kind === 'gate')
  const tenantId = repository.tenantId ?? 'legacy'
  const result: PolicyGateEvaluation[] = []
  for (const policy of policies) {
    const policyText = `${policy.title} ${policy.summary} ${policy.evidence.join(' ')}`.toLowerCase()
    if (/\b(should|appropriate|reasonable|where possible|as needed|when practical)\b/.test(policyText)) {
      const title = `Ambiguous policy needs measurable criteria: ${policy.title}`
      result.push({ id: id(repository.id, revision, 'ambiguous-policy', title), repositoryId: repository.id, tenantId, revision, kind: 'ambiguous-policy', severity: 'medium', title, detail: `${policy.sourcePath} uses discretionary language that a CI or post-production gate cannot evaluate deterministically.`, policyArtifactIds: [policy.id], gateArtifactIds: [], confidence: 0.9, scope: scope([policy]), evidencePassages: [passageWithSignal(policy, 'ambiguous')].filter(item => item !== undefined), recommendation: 'Replace discretionary wording with an owner, scope, measurable threshold, and explicit exception path before creating or changing a gate.', reviewStatus: 'proposed', createdAt })
    }
    const matching = gates.filter(gate => sharedTerms(policy, gate).length > 0)
    if (!matching.length) {
      const title = `Policy has no detected gate: ${policy.title}`
      result.push({ id: id(repository.id, revision, 'unguarded-policy', title), repositoryId: repository.id, tenantId, revision, kind: 'unguarded-policy', severity: 'high', title, detail: `No gate evidence shares an enforceable subject with ${policy.sourcePath}.`, policyArtifactIds: [policy.id], gateArtifactIds: [], confidence: 0.75, scope: scope([policy]), evidencePassages: [passageWithSignal(policy, policyPolarity(policy) ?? 'policy')].filter(item => item !== undefined), recommendation: 'Define a named CI or post-production gate that verifies this policy and cite the policy in its configuration.', reviewStatus: 'proposed', createdAt })
    }
  }
  for (const gate of gates) {
    const matching = policies.filter(policy => sharedTerms(policy, gate).length > 0)
    if (!matching.length) {
      const title = `Gate has no detected policy: ${gate.title}`
      result.push({ id: id(repository.id, revision, 'guard-without-policy', title), repositoryId: repository.id, tenantId, revision, kind: 'guard-without-policy', severity: 'medium', title, detail: `No repository policy explains what ${gate.sourcePath} is meant to guard.`, policyArtifactIds: [], gateArtifactIds: [gate.id], confidence: 0.75, scope: scope([gate]), evidencePassages: [passageWithSignal(gate, 'gate')].filter(item => item !== undefined), recommendation: 'Write an explicit policy statement with owner, scope, and pass/fail criteria, then link it from the gate.', reviewStatus: 'proposed', createdAt })
    }
  }
  for (let index = 0; index < policies.length; index++) for (let other = index + 1; other < policies.length; other++) {
    const left = policies[index], right = policies[other]
    const subject = sharedTerms(left, right)
    const leftPolarity = policyPolarity(left), rightPolarity = policyPolarity(right)
    if (subject.length && leftPolarity && rightPolarity && leftPolarity !== rightPolarity) {
      const title = `Potentially contradictory policies: ${left.title} / ${right.title}`
      result.push({ id: id(repository.id, revision, 'contradictory-policy', title), repositoryId: repository.id, tenantId, revision, kind: 'contradictory-policy', severity: 'high', title, detail: `The policies share ${subject.slice(0, 3).join(', ')} while containing opposing obligation and prohibition language.`, policyArtifactIds: [left.id, right.id], gateArtifactIds: [], confidence: Math.min(0.95, 0.8 + subject.length * 0.05), scope: scope([left, right], subject), evidencePassages: [passageWithSignal(left, leftPolarity), passageWithSignal(right, rightPolarity)].filter(item => item !== undefined), recommendation: 'Clarify precedence, scope, and exceptions in one authoritative policy before changing gates.', reviewStatus: 'proposed', createdAt })
    }
  }
  return result
}
