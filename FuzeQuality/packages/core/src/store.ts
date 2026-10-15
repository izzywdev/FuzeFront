import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type {
  Flow,
  AdminContextAudit,
  Portfolio,
  Repository,
  RepositoryScanHistoryEntry,
  RepositoryInput,
  ScanResult,
  Suggestion,
  SuggestionDecision,
  Requirement,
  SyncCursor,
  TestImplementationRequest,
  ExpectationExclusionInput,
  CoverageProjection,
  QualityArtifact,
  RepositoryFlowCandidate,
  RepositoryFlowReviewHistoryEntry,
  PolicyGateEvaluation,
  PolicyGateReviewHistoryEntry,
  TestExecution,
  QualityTenant,
  QualityPrincipal,
  QualityMembership,
} from '@fuzequality/contracts'
import { TOPICS } from '@fuzequality/contracts'
import { buildApiExpectations, buildFindings, buildFrontendExpectations } from './coverage'
import { buildQualityIntelligenceProjection, isQualityIntelligenceFinding } from './quality-projection'
import { FLOW_COVERAGE_POLICY_VERSION } from './orphan-analysis'
import { REQUIREMENT_REVIEW_POLICY_VERSION } from './requirement-analysis'
import { executionOutcomeTrend, executionPerformance, filterTestExecutions, type ExecutionOutcomeTrend, type PolicyGatePerformance } from './execution-performance'

export const currentQualityArtifactsSql = `SELECT id, repository_id, kind, title, source_path, summary, evidence, execution_target
       FROM fuzequality.repository_quality_artifacts
       WHERE repository_id=$1
         AND revision=(SELECT last_scan_revision FROM fuzequality.repositories WHERE id=$1)
       ORDER BY kind, source_path, title, id`
export const revisionQualityArtifactsSql = `SELECT id, repository_id, kind, title, source_path, summary, evidence, execution_target
       FROM fuzequality.repository_quality_artifacts
       WHERE repository_id=$1 AND revision=$2
       ORDER BY kind, source_path, title, id`
export type HistoryCursor = { createdAt: string; id: string }
export type ReviewHistoryQuery = { after?: HistoryCursor; limit?: number }
export type RepositoryFlowCandidateQuery = {
  id?: string
  source?: RepositoryFlowCandidate['source']
  status?: RepositoryFlowCandidate['status']
  revision?: string
  model?: string
  promptVersion?: string
  schemaVersion?: string
  minConfidence?: number
  maxConfidence?: number
  after?: HistoryCursor
  limit?: number
}
export type PolicyGateEvaluationQuery = {
  id?: string
  kind?: PolicyGateEvaluation['kind']
  remediationAction?: PolicyGateEvaluation['remediationAction']
  severity?: PolicyGateEvaluation['severity']
  reviewStatus?: PolicyGateEvaluation['reviewStatus']
  revision?: string
  subject?: string
  minConfidence?: number
  maxConfidence?: number
  after?: HistoryCursor
  limit?: number
}
export type TestExecutionQuery = {
  kind?: TestExecution['kind']
  status?: TestExecution['status']
  provider?: TestExecution['provider']
  name?: string
  evidenceKind?: TestExecution['evidenceLinks'][number]['kind']
  thresholdOutcome?: 'passed' | 'failed'
  gateOutcome?: TestExecution['status']
  externalRunId?: string
  policyArtifactId?: string
  gateArtifactId?: string
  branch?: string
  revision?: string
  workflowPath?: string
  attemptScope?: 'initial' | 'retry' | 'recovered'
  minimumDurationMs?: number
  maximumDurationMs?: number
  from?: string
  until?: string
  after?: HistoryCursor
  limit?: number
}
export type ExecutionOutcomeTrendQuery = Omit<TestExecutionQuery, 'after'> & {
  beforeDate?: string
  /** Immutable lifecycle high-water mark shared by every page in one trend snapshot. */
  snapshotAt?: string
}
export type PolicyGatePerformanceCursor = Pick<PolicyGatePerformance, 'failed' | 'passed' | 'gateArtifactId' | 'policyArtifactId'>
export type PolicyGatePerformanceQuery = Omit<TestExecutionQuery, 'after'> & {
  after?: PolicyGatePerformanceCursor
  /** Immutable ingestion high-water mark shared by every page in one snapshot. */
  snapshotAt?: string
}

export function testExecutionOccurredAt(execution: TestExecution) {
  return execution.completedAt ?? execution.startedAt ?? '1970-01-01T00:00:00.000Z'
}

function testExecutionOccurredAtMillis(execution: TestExecution) {
  const occurredAt = Date.parse(testExecutionOccurredAt(execution))
  return Number.isFinite(occurredAt) ? occurredAt : 0
}
export type IdentityLifecycleProjection =
  | { type: 'organization.upsert'; tenant: QualityTenant }
  | { type: 'organization.deleted'; tenantId: string }
  | { type: 'user.upsert'; principal: QualityPrincipal }
  | { type: 'user.deleted'; principalId: string; cascade?: 'soft' | 'hard' }
  | { type: 'membership.changed'; membership: QualityMembership }
export type OutboxEventInput = { topic: string; key?: string; payload: unknown }
export type OutboxEvent = OutboxEventInput & { id: string; attempts: number; createdAt: string }
export type DesignTestLinkProjection = {
  type: 'design-test-link.upsert' | 'design-test-link.removed'
  tenantId: string
  traceLinkId: string
  fuzexProjectId: string
  targetKind: 'flow-step' | 'frame' | 'component'
  targetRef: string
  testCaseId: string
}

/** Merge lifecycle updates without erasing richer evidence for the same run attempt. */
export function mergeTestExecutionEvidence(
  existing: TestExecution,
  incoming: TestExecution
): TestExecution {
  const evidenceLinks = new Map(
    [...existing.evidenceLinks, ...incoming.evidenceLinks].map(link => [
      `${link.kind}:${link.url}`,
      link,
    ])
  )
  const richerSummary = (incoming.summary?.length ?? 0) > (existing.summary?.length ?? 0)
    ? incoming.summary
    : existing.summary
  const gateEvaluations = incoming.gateEvaluations.length
    ? incoming.gateEvaluations
    : incoming.status === 'running'
      ? existing.gateEvaluations
      : existing.gateEvaluations.map(evaluation => evaluation.status === 'running'
        ? { ...evaluation, status: incoming.status }
        : evaluation)
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    branch: incoming.branch ?? existing.branch,
    workflowPath: incoming.workflowPath ?? existing.workflowPath,
    sourceUrl: incoming.sourceUrl ?? existing.sourceUrl,
    startedAt: incoming.startedAt ?? existing.startedAt,
    completedAt: incoming.completedAt ?? existing.completedAt,
    policyArtifactIds: incoming.policyArtifactIds.length
      ? incoming.policyArtifactIds
      : existing.policyArtifactIds,
    gateArtifactIds: incoming.gateArtifactIds.length
      ? incoming.gateArtifactIds
      : existing.gateArtifactIds,
    gateEvaluations,
    thresholds: incoming.thresholds.length
      ? incoming.thresholds
      : existing.thresholds,
    evidenceLinks: [...evidenceLinks.values()],
    summary: richerSummary,
  }
}

export interface CatalogStore {
  checkReadiness(): Promise<void>
  portfolio(tenantId?: string): Promise<Portfolio>
  repository(id: string, tenantId?: string): Promise<Repository | undefined>
  repositoryScanHistory(id: string, tenantId: string, query?: RepositoryScanHistoryQuery): Promise<RepositoryScanHistoryEntry[]>
  catalogRevisionForSource(repositoryId: string, tenantId: string, sourceRevision: string): Promise<string | undefined>
  qualityArtifacts(repositoryId: string, tenantId: string, revision?: string, query?: QualityArtifactQuery): Promise<QualityArtifact[]>
  qualityArtifactsByIds(repositoryId: string, tenantId: string, ids: string[]): Promise<QualityArtifact[]>
  repositoryFlowCandidates(repositoryId: string, tenantId: string, query?: RepositoryFlowCandidateQuery): Promise<RepositoryFlowCandidate[]>
  saveRepositoryFlowCandidates(candidates: RepositoryFlowCandidate[]): Promise<void>
  reviewRepositoryFlowCandidate(id: string, tenantId: string, review: { status: 'confirmed' | 'rejected'; reviewedBy: string; reason?: string }, expectedRevision?: string): Promise<RepositoryFlowCandidate | undefined>
  repositoryFlowReviewHistory(candidateId: string, tenantId: string, query?: ReviewHistoryQuery): Promise<RepositoryFlowReviewHistoryEntry[]>
  policyGateEvaluations(repositoryId: string, tenantId: string, query?: PolicyGateEvaluationQuery): Promise<PolicyGateEvaluation[]>
  savePolicyGateEvaluations(evaluations: PolicyGateEvaluation[]): Promise<void>
  reviewPolicyGateEvaluation(id: string, tenantId: string, review: { status: 'accepted' | 'dismissed'; reviewedBy: string; reason?: string }, expectedRevision?: string): Promise<PolicyGateEvaluation | undefined>
  policyGateReviewHistory(evaluationId: string, tenantId: string, query?: ReviewHistoryQuery): Promise<PolicyGateReviewHistoryEntry[]>
  testExecutions(repositoryId: string, tenantId: string, query?: TestExecutionQuery): Promise<TestExecution[]>
  latestPerformanceExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]): Promise<TestExecution[]>
  latestIntegrationExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]): Promise<TestExecution[]>
  latestPostProductionExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]): Promise<TestExecution[]>
  executionOutcomeTrend(repositoryId: string, tenantId: string, query?: ExecutionOutcomeTrendQuery): Promise<ExecutionOutcomeTrend[]>
  policyGatePerformance(repositoryId: string, tenantId: string, query?: PolicyGatePerformanceQuery): Promise<PolicyGatePerformance[]>
  saveTestExecution(execution: TestExecution): Promise<void>
  addRepository(input: RepositoryInput, tenantId?: string): Promise<Repository>
  updateRepositoryAdministration(
    id: string,
    tenantId: string,
    value: Pick<RepositoryInput, 'ownership' | 'jiraBindings' | 'storybookBaseUrl'>
  ): Promise<Repository | undefined>
  setRepositoryStatus(id: string, status: Repository['lastScanStatus']): Promise<void>
  setRepositoryAnalysis(id: string, analysis: NonNullable<Repository['lastAnalysis']>): Promise<void>
  queueRepositoryAnalysis(id: string, tenantId: string): Promise<Repository | undefined>
  saveScan(result: ScanResult): Promise<void>
  syncCursor(sourceType: SyncCursor['sourceType'], sourceKey: string): Promise<SyncCursor | undefined>
  markSyncFailed(sourceType: SyncCursor['sourceType'], sourceKey: string): Promise<void>
  saveIntelligence(
    results: Array<{ requirement: Requirement; suggestions: Suggestion[] }>,
    sync?: Pick<SyncCursor, 'sourceType' | 'sourceKey' | 'cursor'> & { tenantId?: string }
  ): Promise<void>
  rebuildCoverage(): Promise<CoverageProjection>
  reviewSuggestion(id: string, input: Omit<SuggestionDecision, 'id' | 'suggestionId' | 'originalPayload' | 'decidedAt'>): Promise<Suggestion | undefined>
  approveExpectedTest(id: string, input: Omit<SuggestionDecision, 'id' | 'suggestionId' | 'originalPayload' | 'decidedAt'>): Promise<Suggestion | undefined>
  excludeExpectation(id: string, tenantId: string, input: ExpectationExclusionInput): Promise<boolean>
  suggestionDecisions(id: string, tenantId: string): Promise<SuggestionDecision[]>
  createTestImplementation(request: TestImplementationRequest, idempotencyKey: string): Promise<TestImplementationRequest>
  testImplementation(id: string, tenantId: string): Promise<TestImplementationRequest | undefined>
  updateTestImplementation(id: string, value: Partial<Pick<TestImplementationRequest, 'status' | 'workflowUrl' | 'pullRequestUrl' | 'error'>>): Promise<void>
  recordAdminContext(input: Omit<AdminContextAudit, 'id' | 'createdAt'>): Promise<AdminContextAudit>
  upsertTenant(tenant: QualityTenant): Promise<boolean>
  deactivateTenant(tenantId: string): Promise<boolean>
  upsertPrincipal(principal: QualityPrincipal): Promise<boolean>
  deactivatePrincipal(principalId: string, cascade?: 'soft' | 'hard'): Promise<boolean>
  setOrganizationMembership(membership: QualityMembership): Promise<boolean>
  projectDesignTestLink(projection: DesignTestLinkProjection, outbound: OutboxEventInput): Promise<boolean>
  projectIdentityLifecycle(projection: IdentityLifecycleProjection, outbound: OutboxEventInput): Promise<boolean>
  claimOutboxEvents(limit?: number, leaseMs?: number): Promise<OutboxEvent[]>
  markOutboxPublished(id: string): Promise<void>
  releaseOutboxEvent(id: string, error: string): Promise<void>
}

export type RepositoryScanHistoryQuery = {
  after?: { scannedAt: string | null; id: string }
  limit?: number
}

export type QualityArtifactQuery = {
  afterId?: string
  limit?: number
}

const emptyPortfolio = (): Portfolio => ({
  repositories: [],
  operations: [],
  surfaces: [],
  tests: [],
  expectations: [],
  findings: [],
  diagnostics: [],
  requirements: [],
  flows: [],
  suggestions: [],
})

/** Older rows predate mandatory wireframes; derive a stable review fallback from stored steps. */
function flowWireframe(value: unknown, steps: unknown): RepositoryFlowCandidate['wireframe'] {
  const record = value && typeof value === 'object' ? value as { kind?: unknown; nodes?: unknown } : undefined
  if (record?.kind === 'sequence' && Array.isArray(record.nodes) && record.nodes.length > 0) {
    return { kind: 'sequence', nodes: record.nodes.map(node => {
      const item = node && typeof node === 'object' ? node as { label?: unknown; targetIds?: unknown } : {}
      return { label: typeof item.label === 'string' && item.label.trim() ? item.label : 'Flow step', targetIds: Array.isArray(item.targetIds) ? item.targetIds.filter((id): id is string => typeof id === 'string') : [] }
    }) }
  }
  const nodes = Array.isArray(steps) ? steps.map(step => {
    const item = step && typeof step === 'object' ? step as { action?: unknown; targetIds?: unknown } : {}
    return { label: typeof item.action === 'string' && item.action.trim() ? item.action : 'Flow step', targetIds: Array.isArray(item.targetIds) ? item.targetIds.filter((id): id is string => typeof id === 'string') : [] }
  }) : []
  return { kind: 'sequence', nodes: nodes.length ? nodes : [{ label: 'Flow step', targetIds: [] }] }
}

export class MemoryCatalogStore implements CatalogStore {
  private data = emptyPortfolio()
  private implementations: Array<TestImplementationRequest & { idempotencyKey: string }> = []
  private decisions: SuggestionDecision[] = []
  private adminContextAudits: AdminContextAudit[] = []
  private syncCursors: SyncCursor[] = []
  private scanHistory: Array<{ repositoryId: string; item: RepositoryScanHistoryEntry }> = []
  private sourceCatalogRevisions = new Map<string, string>()
  private exclusions = new Map<string, ExpectationExclusionInput>()
  private artifacts: Array<QualityArtifact & { revision: string }> = []
  private flowCandidates: RepositoryFlowCandidate[] = []
  private flowReviewAudits: RepositoryFlowReviewHistoryEntry[] = []
  private policyGateResults: PolicyGateEvaluation[] = []
  private policyGateReviewAudits: PolicyGateReviewHistoryEntry[] = []
  private executions: TestExecution[] = []
  private executionVersions: Array<{ execution: TestExecution; versionedAt: number }> = []
  private tenants = new Map<string, QualityTenant>()
  private principals = new Map<string, QualityPrincipal>()
  private memberships = new Map<string, QualityMembership>()
  private outboxEvents: Array<OutboxEvent & { publishedAt?: string; lockedUntil?: number; lastError?: string }> = []
  private designTestLinks = new Map<string, DesignTestLinkProjection & { active: boolean }>()

  constructor(seed?: Partial<Portfolio>) {
    this.data = { ...this.data, ...seed }
  }

  async checkReadiness() {}

  async portfolio(tenantId?: string) {
    const result = structuredClone(this.data)
    if (!tenantId) return result
    const repositories = result.repositories.filter(repository => repository.tenantId === tenantId)
    const repositoryIds = new Set(repositories.map(repository => repository.id))
    const operations = result.operations.filter(item => repositoryIds.has(item.repositoryId))
    const surfaces = result.surfaces.filter(item => repositoryIds.has(item.repositoryId))
    const subjectIds = new Set([...operations.map(item => item.id), ...surfaces.map(item => item.id)])
    const requirementIds = new Set(result.requirements.filter(item => item.tenantId === tenantId).map(item => item.id))
    return {
      ...result,
      repositories,
      operations,
      surfaces,
      tests: result.tests.filter(item => repositoryIds.has(item.repositoryId)),
      expectations: result.expectations.filter(item => subjectIds.has(item.subjectId) || (item.subjectType === 'flow-step' && requirementIds.has(item.subjectId.replace(/^requirement:/, '')))).map(item => {
        const exclusion = this.exclusions.get(`${tenantId}:${item.id}`)
        if (!exclusion || new Date(exclusion.expiresAt).getTime() <= Date.now()) return item
        const expiresSoon = new Date(exclusion.expiresAt).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000
        return { ...item, coverage: 'excluded' as const, exclusion: { ...exclusion, expiresSoon } }
      }),
      findings: result.findings.filter(item => !item.repositoryId || repositoryIds.has(item.repositoryId)),
      diagnostics: result.diagnostics.filter(item => repositoryIds.has(item.repositoryId)),
    requirements: result.requirements.filter(item => item.tenantId === tenantId),
    flows: result.flows.filter(item => result.requirements.some(requirement => requirement.tenantId === tenantId && requirement.id === item.requirementId)),
    suggestions: result.suggestions.filter(item => result.requirements.some(requirement => requirement.tenantId === tenantId && requirement.id === item.requirementId)),
    }
  }

  async repository(id: string, tenantId?: string) {
    return this.data.repositories.find(repository => repository.id === id && (!tenantId || repository.tenantId === tenantId))
  }

  async repositoryScanHistory(id: string, tenantId: string, query: RepositoryScanHistoryQuery = {}) {
    if (!await this.repository(id, tenantId)) return []
    let items = this.scanHistory.filter(item => item.repositoryId === id).map(item => item.item)
    if (query.after) {
      const cursorIndex = items.findIndex(item => item.id === query.after!.id && (item.scannedAt ?? null) === query.after!.scannedAt)
      items = cursorIndex >= 0 ? items.slice(cursorIndex + 1) : []
    }
    return items.slice(0, query.limit)
  }

  async catalogRevisionForSource(repositoryId: string, tenantId: string, sourceRevision: string) {
    if (!await this.repository(repositoryId, tenantId)) return undefined
    return this.sourceCatalogRevisions.get(`${repositoryId}:${sourceRevision}`)
  }

  async qualityArtifacts(repositoryId: string, tenantId: string, revision?: string, query?: QualityArtifactQuery) {
    const repository = await this.repository(repositoryId, tenantId)
    if (!repository) return []
    const selectedRevision = revision ?? repository.lastScanRevision
    const items = this.artifacts
      .filter(item => item.repositoryId === repositoryId && (!selectedRevision || item.revision === selectedRevision))
      .sort((left, right) => left.id.localeCompare(right.id))
      .filter(item => !query?.afterId || item.id > query.afterId)
      .map(({ revision: _revision, ...item }) => item)
    return query?.limit === undefined ? items : items.slice(0, query.limit)
  }

  async qualityArtifactsByIds(repositoryId: string, tenantId: string, ids: string[]) {
    if (!ids.length || !await this.repository(repositoryId, tenantId)) return []
    const selected = new Set(ids)
    return this.artifacts
      .filter(item => item.repositoryId === repositoryId && selected.has(item.id))
      .map(({ revision: _revision, ...item }) => item)
  }

  async repositoryFlowCandidates(repositoryId: string, tenantId: string, query: RepositoryFlowCandidateQuery = {}) {
    const items = this.flowCandidates
      .filter(item =>
        item.repositoryId === repositoryId && item.tenantId === tenantId &&
        (!query.id || item.id === query.id) &&
        (!query.source || item.source === query.source) &&
        (!query.status || item.status === query.status) &&
        (!query.revision || item.revision === query.revision) &&
        (!query.model || item.analysis?.model === query.model) &&
        (!query.promptVersion || item.analysis?.promptVersion === query.promptVersion) &&
        (!query.schemaVersion || item.analysis?.schemaVersion === query.schemaVersion) &&
        (query.minConfidence === undefined || item.confidence >= query.minConfidence) &&
        (query.maxConfidence === undefined || item.confidence <= query.maxConfidence)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter(item => !query.after || item.createdAt < query.after.createdAt || (item.createdAt === query.after.createdAt && item.id < query.after.id))
    return query.limit === undefined ? items : items.slice(0, query.limit)
  }

  async saveRepositoryFlowCandidates(candidates: RepositoryFlowCandidate[]) {
    for (const candidate of candidates) {
      const index = this.flowCandidates.findIndex(item => item.repositoryId === candidate.repositoryId && item.revision === candidate.revision && item.title === candidate.title && item.source === candidate.source)
      if (index >= 0) this.flowCandidates[index] = {
        ...candidate,
        id: this.flowCandidates[index].id,
        status: this.flowCandidates[index].status,
        reviewedAt: this.flowCandidates[index].reviewedAt,
        reviewedBy: this.flowCandidates[index].reviewedBy,
        reviewReason: this.flowCandidates[index].reviewReason,
      }
      else this.flowCandidates.push(candidate)
    }
  }

  async reviewRepositoryFlowCandidate(id: string, tenantId: string, review: { status: 'confirmed' | 'rejected'; reviewedBy: string; reason?: string }, expectedRevision?: string) {
    const item = this.flowCandidates.find(candidate => candidate.id === id && candidate.tenantId === tenantId)
    if (!item) return undefined
    const repository = this.data.repositories.find(candidate => candidate.id === item.repositoryId && candidate.tenantId === tenantId)
    if (expectedRevision && (item.revision !== expectedRevision || repository?.lastScanRevision !== expectedRevision)) return undefined
    item.status = review.status
    item.reviewedAt = new Date().toISOString()
    item.reviewedBy = review.reviewedBy
    item.reviewReason = review.reason
    this.flowReviewAudits.unshift({ id: `flow_review_${String(this.flowReviewAudits.length + 1).padStart(12, '0')}_${randomUUID()}`, candidateId: id, tenantId, status: review.status, reviewedBy: review.reviewedBy, reason: review.reason, createdAt: item.reviewedAt })
    return item
  }

  async repositoryFlowReviewHistory(candidateId: string, tenantId: string, query: ReviewHistoryQuery = {}) {
    const items = this.flowReviewAudits
      .filter(item => item.candidateId === candidateId && item.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter(item => !query.after || item.createdAt < query.after.createdAt || (item.createdAt === query.after.createdAt && item.id < query.after.id))
    return query.limit === undefined ? items : items.slice(0, query.limit)
  }

  async policyGateEvaluations(repositoryId: string, tenantId: string, query: PolicyGateEvaluationQuery = {}) {
    const normalizedSubject = query.subject?.toLowerCase()
    const items = this.policyGateResults
      .filter(item =>
        item.repositoryId === repositoryId && item.tenantId === tenantId &&
        (!query.id || item.id === query.id) &&
        (!query.kind || item.kind === query.kind) &&
        (!query.remediationAction || item.remediationAction === query.remediationAction) &&
        (!query.severity || item.severity === query.severity) &&
        (!query.reviewStatus || item.reviewStatus === query.reviewStatus) &&
        (!query.revision || item.revision === query.revision) &&
        (!normalizedSubject || item.scope.subjects.some(subject => subject.toLowerCase() === normalizedSubject)) &&
        (query.minConfidence === undefined || item.confidence >= query.minConfidence) &&
        (query.maxConfidence === undefined || item.confidence <= query.maxConfidence)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter(item => !query.after || item.createdAt < query.after.createdAt || (item.createdAt === query.after.createdAt && item.id < query.after.id))
    return query.limit === undefined ? items : items.slice(0, query.limit)
  }

  async savePolicyGateEvaluations(evaluations: PolicyGateEvaluation[]) {
    for (const evaluation of evaluations) {
      const index = this.policyGateResults.findIndex(item => item.repositoryId === evaluation.repositoryId && item.revision === evaluation.revision && item.kind === evaluation.kind && item.title === evaluation.title)
      if (index >= 0) this.policyGateResults[index] = { ...evaluation, reviewStatus: this.policyGateResults[index].reviewStatus, reviewedAt: this.policyGateResults[index].reviewedAt, reviewedBy: this.policyGateResults[index].reviewedBy, reviewReason: this.policyGateResults[index].reviewReason }
      else this.policyGateResults.push(evaluation)
    }
  }

  async reviewPolicyGateEvaluation(id: string, tenantId: string, review: { status: 'accepted' | 'dismissed'; reviewedBy: string; reason?: string }, expectedRevision?: string) {
    const item = this.policyGateResults.find(evaluation => evaluation.id === id && evaluation.tenantId === tenantId)
    if (!item) return undefined
    const repository = this.data.repositories.find(candidate => candidate.id === item.repositoryId && candidate.tenantId === tenantId)
    if (expectedRevision && (item.revision !== expectedRevision || repository?.lastScanRevision !== expectedRevision)) return undefined
    item.reviewStatus = review.status
    item.reviewedAt = new Date().toISOString()
    item.reviewedBy = review.reviewedBy
    item.reviewReason = review.reason
    this.policyGateReviewAudits.unshift({ id: `policy_gate_review_${String(this.policyGateReviewAudits.length + 1).padStart(12, '0')}_${randomUUID()}`, evaluationId: id, tenantId, status: review.status, reviewedBy: review.reviewedBy, reason: review.reason, createdAt: item.reviewedAt })
    return item
  }

  async policyGateReviewHistory(evaluationId: string, tenantId: string, query: ReviewHistoryQuery = {}) {
    const items = this.policyGateReviewAudits
      .filter(item => item.evaluationId === evaluationId && item.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter(item => !query.after || item.createdAt < query.after.createdAt || (item.createdAt === query.after.createdAt && item.id < query.after.id))
    return query.limit === undefined ? items : items.slice(0, query.limit)
  }

  async testExecutions(repositoryId: string, tenantId: string, query: TestExecutionQuery = {}) {
    const after = query.after ? Date.parse(query.after.createdAt) : undefined
    const snapshot = this.executions
      .filter(item => item.repositoryId === repositoryId && item.tenantId === tenantId)
    const items = filterTestExecutions(snapshot, query, snapshot)
      .sort((left, right) => testExecutionOccurredAtMillis(right) - testExecutionOccurredAtMillis(left) || right.id.localeCompare(left.id))
      .filter(item => !query.after || testExecutionOccurredAtMillis(item) < after! || (testExecutionOccurredAtMillis(item) === after && item.id < query.after.id))
    return query.limit === undefined ? items : items.slice(0, query.limit)
  }

  async latestPerformanceExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]) {
    const allowed = new Set(workflowPaths)
    const latest = new Map<string, TestExecution>()
    for (const execution of this.executions
      .filter(item =>
        item.repositoryId === repositoryId && item.tenantId === tenantId &&
        (item.kind === 'load' || item.kind === 'stress') &&
        Boolean(item.workflowPath && allowed.has(item.workflowPath))
      )
      .sort((left, right) => testExecutionOccurredAtMillis(right) - testExecutionOccurredAtMillis(left) || right.id.localeCompare(left.id))) {
      if (execution.workflowPath && !latest.has(execution.workflowPath)) latest.set(execution.workflowPath, execution)
    }
    return [...latest.values()]
  }

  async latestPostProductionExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]) {
    const allowed = new Set(workflowPaths)
    const latest = new Map<string, TestExecution>()
    for (const execution of this.executions
      .filter(item =>
        item.repositoryId === repositoryId && item.tenantId === tenantId &&
        item.kind === 'post-production' &&
        Boolean(item.workflowPath && allowed.has(item.workflowPath))
      )
      .sort((left, right) => testExecutionOccurredAtMillis(right) - testExecutionOccurredAtMillis(left) || right.id.localeCompare(left.id))) {
      if (execution.workflowPath && !latest.has(execution.workflowPath)) latest.set(execution.workflowPath, execution)
    }
    return [...latest.values()]
  }

  async latestIntegrationExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]) {
    const allowed = new Set(workflowPaths)
    const latest = new Map<string, TestExecution>()
    for (const execution of this.executions
      .filter(item =>
        item.repositoryId === repositoryId && item.tenantId === tenantId &&
        item.kind === 'integration' &&
        Boolean(item.workflowPath && allowed.has(item.workflowPath))
      )
      .sort((left, right) => testExecutionOccurredAtMillis(right) - testExecutionOccurredAtMillis(left) || right.id.localeCompare(left.id))) {
      if (execution.workflowPath && !latest.has(execution.workflowPath)) latest.set(execution.workflowPath, execution)
    }
    return [...latest.values()]
  }

  async executionOutcomeTrend(repositoryId: string, tenantId: string, query: ExecutionOutcomeTrendQuery = {}) {
    const snapshot = this.executionSnapshot(query.snapshotAt)
      .filter(item => item.repositoryId === repositoryId && item.tenantId === tenantId)
    const items = executionOutcomeTrend(filterTestExecutions(snapshot, query, snapshot), snapshot)
      .sort((left, right) => right.date.localeCompare(left.date))
      .filter(item => !query.beforeDate || item.date < query.beforeDate)
    return query.limit === undefined ? items : items.slice(0, query.limit)
  }

  async policyGatePerformance(repositoryId: string, tenantId: string, query: PolicyGatePerformanceQuery = {}) {
    const snapshot = this.executionSnapshot(query.snapshotAt)
      .filter(item => item.repositoryId === repositoryId && item.tenantId === tenantId)
      .sort((left, right) => testExecutionOccurredAtMillis(right) - testExecutionOccurredAtMillis(left) || right.id.localeCompare(left.id))
    const items = executionPerformance(filterTestExecutions(snapshot, query, snapshot), [], query.gateOutcome)
      .map(item => ({
        ...item,
        revisionCount: item.revisions?.length ?? 0,
        latestRevision: item.revisions?.[0],
        revisions: undefined,
      }))
      .filter(item => !query.after ||
        item.failed < query.after.failed ||
        (item.failed === query.after.failed && item.passed < query.after.passed) ||
        (item.failed === query.after.failed && item.passed === query.after.passed && item.gateArtifactId > query.after.gateArtifactId) ||
        (item.failed === query.after.failed && item.passed === query.after.passed && item.gateArtifactId === query.after.gateArtifactId && item.policyArtifactId > query.after.policyArtifactId)
      )
    return query.limit === undefined ? items : items.slice(0, query.limit)
  }

  private executionSnapshot(snapshotAt?: string) {
    if (!snapshotAt) return this.executions
    const cutoff = Date.parse(snapshotAt)
    if (!Number.isFinite(cutoff)) return []
    const versionsByExecution = new Map<string, TestExecution>()
    for (const version of this.executionVersions) {
      if (version.versionedAt > cutoff) continue
      const execution = version.execution
      const key = `${execution.repositoryId}\u0000${execution.provider}\u0000${execution.externalRunId}\u0000${execution.attempt}`
      versionsByExecution.set(key, execution)
    }
    return [...versionsByExecution.values()]
  }

  async saveTestExecution(execution: TestExecution) {
    const index = this.executions.findIndex(item => item.repositoryId === execution.repositoryId && item.provider === execution.provider && item.externalRunId === execution.externalRunId && item.attempt === execution.attempt)
    // GitHub webhook delivery is not ordered. A delayed requested or
    // in-progress event must not erase a terminal result for this attempt.
    if (index >= 0 && this.executions[index].status !== 'running' && execution.status === 'running') return
    if (index >= 0) this.executions[index] = mergeTestExecutionEvidence(this.executions[index], execution)
    else this.executions.push(execution)
    this.executionVersions.push({
      execution: structuredClone(this.executions[index >= 0 ? index : this.executions.length - 1]),
      versionedAt: Date.now(),
    })
  }

  async addRepository(input: RepositoryInput, tenantId = 'legacy') {
    const duplicate = this.data.repositories.find(
      item => item.tenantId === tenantId && item.owner.toLowerCase() === input.owner.toLowerCase() && item.name.toLowerCase() === input.name.toLowerCase()
    )
    if (duplicate) {
      Object.assign(duplicate, input)
      return duplicate
    }
    const repository: Repository = {
      ...input,
      id: randomUUID(),
      tenantId,
      canonicalUrl: `https://github.com/${input.owner}/${input.name}`,
      enabled: true,
      lastScanStatus: 'never',
    }
    this.data.repositories.push(repository)
    return repository
  }

  async updateRepositoryAdministration(
    id: string,
    tenantId: string,
    value: Pick<RepositoryInput, 'ownership' | 'jiraBindings' | 'storybookBaseUrl'>
  ) {
    const repository = await this.repository(id, tenantId)
    if (!repository) return undefined
    Object.assign(repository, value)
    return repository
  }

  async setRepositoryStatus(id: string, status: Repository['lastScanStatus']) {
    const repository = this.data.repositories.find(item => item.id === id)
    if (repository) repository.lastScanStatus = status
  }

  async setRepositoryAnalysis(id: string, analysis: NonNullable<Repository['lastAnalysis']>) {
    const repository = this.data.repositories.find(item => item.id === id)
    if (repository?.lastScanRevision !== analysis.revision) return
    const previousStatus = repository.lastAnalysis?.status
    if (JSON.stringify(repository.lastAnalysis) === JSON.stringify(analysis)) return
    repository.lastAnalysis = analysis
    if (analysis.status === 'complete' && previousStatus !== 'complete') {
      this.outboxEvents.push({
        id: randomUUID(),
        topic: TOPICS.ANALYSIS_COMPLETED,
        key: id,
        payload: { repositoryId: id, revision: analysis.revision },
        attempts: 0,
        createdAt: new Date().toISOString(),
      })
    }
  }

  async queueRepositoryAnalysis(id: string, tenantId: string) {
    const repository = await this.repository(id, tenantId)
    if (!repository?.lastScanRevision || repository.lastAnalysis?.status !== 'failed') return undefined
    repository.lastAnalysis = { revision: repository.lastScanRevision, status: 'queued' }
    this.outboxEvents.push({ id: randomUUID(), topic: TOPICS.REPOSITORY_INVENTORY_CHANGED, key: id,
      payload: { repositoryId: id, revision: repository.lastScanRevision }, attempts: 0, createdAt: new Date().toISOString() })
    return repository
  }

  async saveScan(result: ScanResult) {
    const repository = this.data.repositories.find(item => item.id === result.repository.id)
    if (repository) {
      Object.assign(repository, result.repository, {
        lastScanAt: result.scannedAt,
        lastScanRevision: result.revision,
        lastScanStatus: 'complete',
        lastScanDetails: result.scanDetails,
        lastAnalysis: { revision: result.revision, status: 'queued' },
      })
    }
    if (result.scanDetails.sourceRevision) {
      this.sourceCatalogRevisions.set(
        `${result.repository.id}:${result.scanDetails.sourceRevision}`,
        result.revision,
      )
    }
    const rejectRepo = <T extends { repositoryId: string }>(items: T[]) =>
      items.filter(item => item.repositoryId !== result.repository.id)
    this.data.operations = [...rejectRepo(this.data.operations), ...result.operations]
    this.data.surfaces = [...rejectRepo(this.data.surfaces), ...result.surfaces]
    this.data.tests = [...rejectRepo(this.data.tests), ...result.tests]
    const subjectIds = new Set([
      ...result.operations.map(item => item.id),
      ...result.surfaces.map(item => item.id),
    ])
    this.data.expectations = [
      ...this.data.expectations.filter(item => !subjectIds.has(item.subjectId)),
      ...result.expectations,
    ]
    this.data.findings = [
      ...this.data.findings.filter(item => item.repositoryId !== result.repository.id),
      ...result.findings,
    ]
    this.data.diagnostics = [
      ...this.data.diagnostics.filter(item => item.repositoryId !== result.repository.id),
      ...result.diagnostics.map(item => ({ ...item, repositoryId: result.repository.id, revision: result.revision })),
    ]
    this.artifacts = [
      ...this.artifacts.filter(item =>
        item.repositoryId !== result.repository.id || item.revision !== result.revision
      ),
      ...(result.qualityArtifacts ?? []).map(item => ({ ...item, revision: result.revision })),
    ]
    this.scanHistory.unshift({ repositoryId: result.repository.id, item: { id: randomUUID(), revision: result.revision, branch: result.repository.defaultBranch, status: 'complete', scannedAt: result.scannedAt, trigger: 'manual', counts: { operations: result.operations.length, surfaces: result.surfaces.length, tests: result.tests.length, diagnostics: result.diagnostics.length } } })
    this.outboxEvents.push({ id: randomUUID(), topic: TOPICS.REPOSITORY_INVENTORY_CHANGED, key: result.repository.id,
      payload: { repositoryId: result.repository.id, revision: result.revision }, attempts: 0, createdAt: new Date().toISOString() })
  }

  async reviewSuggestion(id: string, input: Omit<SuggestionDecision, 'id' | 'suggestionId' | 'originalPayload' | 'decidedAt'>) {
    const suggestion = this.data.suggestions.find(item => item.id === id && this.data.requirements.some(requirement => requirement.id === item.requirementId && requirement.tenantId === input.tenantId))
    if (!suggestion || suggestion.state !== 'proposed') return undefined
    const payload = input.editedPayload ?? suggestion.payload
    const action = input.action
    suggestion.state = action === 'confirm' || action === 'merge' ? 'confirmed' : action === 'suppress' ? 'suppressed' : action === 'reject' ? 'rejected' : 'proposed'
    if ((action === 'confirm' || action === 'merge') && suggestion.type === 'flow') {
      const flow = payload as unknown as Flow
      const confirmed = { ...flow, status: 'confirmed' as const, origin: 'confirmed' as const }
      const existing = this.data.flows.findIndex(item => item.id === flow.id)
      if (existing >= 0) this.data.flows[existing] = confirmed
      else this.data.flows.push(confirmed)
    }
    this.decisions.unshift({ id: randomUUID(), suggestionId: id, originalPayload: suggestion.payload, decidedAt: new Date().toISOString(), ...input })
    if (action === 'edit') suggestion.payload = payload
    return suggestion
  }

  async approveExpectedTest(id: string, input: Omit<SuggestionDecision, 'id' | 'suggestionId' | 'originalPayload' | 'decidedAt'>) {
    const suggestion = this.data.suggestions.find(item => item.id === id && item.type === 'expected-test' && this.data.requirements.some(requirement => requirement.id === item.requirementId && requirement.tenantId === input.tenantId))
    if (!suggestion || suggestion.state !== 'proposed') return undefined
    const priority = suggestion.payload.priority === 'required' ? 'required' : 'recommended'
    this.data.expectations.push({ id: `expectation:ai:${id}`, subjectType: 'flow-step', subjectId: `requirement:${suggestion.requirementId}`, kind: 'ai-approved', label: suggestion.title, priority, rule: `ai-reviewed:${id}`, coverage: 'gap', evidenceIds: [] })
    suggestion.state = 'confirmed'
    this.decisions.unshift({ id: randomUUID(), suggestionId: id, originalPayload: suggestion.payload, decidedAt: new Date().toISOString(), ...input, action: 'confirm' })
    return suggestion
  }

  async excludeExpectation(id: string, tenantId: string, input: ExpectationExclusionInput) {
    const visible = (await this.portfolio(tenantId)).expectations.some(item => item.id === id)
    if (!visible) return false
    this.exclusions.set(`${tenantId}:${id}`, input)
    return true
  }

  async suggestionDecisions(id: string, tenantId: string) {
    const visible = this.data.suggestions.some(item => item.id === id && this.data.requirements.some(requirement => requirement.id === item.requirementId && requirement.tenantId === tenantId))
    return visible ? this.decisions.filter(item => item.suggestionId === id && item.tenantId === tenantId) : []
  }

  async rebuildCoverage() {
    const projection = buildQualityIntelligenceProjection(this.data, { policyGateEvaluations: this.policyGateResults })
    this.data.findings = [
      ...this.data.findings.filter(item => !isQualityIntelligenceFinding(item.type)),
      ...projection.findings,
    ]
    return projection
  }

  async syncCursor(sourceType: SyncCursor['sourceType'], sourceKey: string) {
    return this.syncCursors.find(item => item.sourceType === sourceType && item.sourceKey === sourceKey)
  }

  async markSyncFailed(sourceType: SyncCursor['sourceType'], sourceKey: string) {
    const existing = await this.syncCursor(sourceType, sourceKey)
    const value: SyncCursor = {
      sourceType,
      sourceKey,
      cursor: existing?.cursor,
      lastSuccessAt: existing?.lastSuccessAt,
      freshnessStatus: 'failed',
    }
    if (existing) Object.assign(existing, value)
    else this.syncCursors.push(value)
  }

  async saveIntelligence(
    results: Array<{ requirement: Requirement; suggestions: Suggestion[] }>,
    sync?: Pick<SyncCursor, 'sourceType' | 'sourceKey' | 'cursor'> & { tenantId?: string }
  ) {
    for (const result of results) {
      const requirement = { ...result.requirement, tenantId: sync?.tenantId }
      const existing = this.data.requirements.find(item => item.jiraKey === requirement.jiraKey && item.tenantId === requirement.tenantId)
      if (existing) Object.assign(existing, requirement)
      else this.data.requirements.push(requirement)
      this.data.suggestions = [
        ...this.data.suggestions.filter(item => item.requirementId !== requirement.id || item.state !== 'proposed'),
        ...result.suggestions,
      ]
    }
    if (sync) {
      const existing = await this.syncCursor(sync.sourceType, sync.sourceKey)
      const value: SyncCursor = {
        ...sync,
        cursor: sync.cursor,
        lastSuccessAt: new Date().toISOString(),
        freshnessStatus: 'fresh',
      }
      if (existing) Object.assign(existing, value)
      else this.syncCursors.push(value)
    }
  }

  async createTestImplementation(request: TestImplementationRequest, idempotencyKey: string) {
    const existing = this.implementations.find(item => item.tenantId === request.tenantId && item.idempotencyKey === idempotencyKey)
    if (existing) return existing
    this.implementations.push({ ...request, idempotencyKey })
    return request
  }

  async testImplementation(id: string, tenantId: string) {
    return this.implementations.find(item => item.id === id && item.tenantId === tenantId)
  }

  async updateTestImplementation(id: string, value: Partial<Pick<TestImplementationRequest, 'status' | 'workflowUrl' | 'pullRequestUrl' | 'error'>>) {
    const item = this.implementations.find(candidate => candidate.id === id)
    if (item) Object.assign(item, value, { updatedAt: new Date().toISOString() })
  }

  async recordAdminContext(input: Omit<AdminContextAudit, 'id' | 'createdAt'>) {
    const audit = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }
    this.adminContextAudits.push(audit)
    return audit
  }

  async upsertTenant(tenant: QualityTenant) {
    const previous = this.tenants.get(tenant.id)
    const changed = JSON.stringify(previous) !== JSON.stringify(tenant)
    this.tenants.set(tenant.id, structuredClone(tenant))
    return changed
  }

  async deactivateTenant(tenantId: string) {
    const tenant = this.tenants.get(tenantId)
    if (!tenant || !tenant.active) return false
    tenant.active = false
    for (const membership of this.memberships.values()) {
      if (membership.tenantId === tenantId) membership.active = false
    }
    return true
  }

  async upsertPrincipal(principal: QualityPrincipal) {
    const previous = this.principals.get(principal.id)
    const changed = JSON.stringify(previous) !== JSON.stringify(principal)
    this.principals.set(principal.id, structuredClone(principal))
    return changed
  }

  async deactivatePrincipal(principalId: string, cascade: 'soft' | 'hard' = 'soft') {
    const principal = this.principals.get(principalId)
    if (!principal) return false
    const redactedEmail = `deleted+${principalId}@redacted.invalid`
    const changed = principal.active || (
      cascade === 'hard' && (
        principal.email !== redactedEmail ||
        principal.firstName !== undefined ||
        principal.lastName !== undefined
      )
    )
    if (!changed) return false
    Object.assign(principal, {
      active: false,
      ...(cascade === 'hard'
        ? { email: redactedEmail, firstName: undefined, lastName: undefined }
        : {}),
    })
    for (const membership of this.memberships.values()) {
      if (membership.principalId === principalId) membership.active = false
    }
    return true
  }

  async setOrganizationMembership(membership: QualityMembership) {
    const key = `${membership.tenantId}:${membership.principalId}`
    const previous = this.memberships.get(key)
    const changed = JSON.stringify(previous) !== JSON.stringify(membership)
    this.memberships.set(key, structuredClone(membership))
    return changed
  }

  async projectIdentityLifecycle(projection: IdentityLifecycleProjection, outbound: OutboxEventInput) {
    let changed = false
    switch (projection.type) {
      case 'organization.upsert': changed = await this.upsertTenant(projection.tenant); break
      case 'organization.deleted': {
        changed = await this.deactivateTenant(projection.tenantId)
        for (const membership of this.memberships.values()) {
          if (membership.tenantId === projection.tenantId && membership.active) {
            membership.active = false
            changed = true
          }
        }
        break
      }
      case 'user.upsert': changed = await this.upsertPrincipal(projection.principal); break
      case 'user.deleted': {
        changed = await this.deactivatePrincipal(projection.principalId, projection.cascade)
        for (const membership of this.memberships.values()) {
          if (membership.principalId === projection.principalId && membership.active) {
            membership.active = false
            changed = true
          }
        }
        break
      }
      case 'membership.changed': changed = await this.setOrganizationMembership(projection.membership); break
    }
    if (changed) this.outboxEvents.push({ ...structuredClone(outbound), id: randomUUID(), attempts: 0, createdAt: new Date().toISOString() })
    return changed
  }

  async projectDesignTestLink(projection: DesignTestLinkProjection, outbound: OutboxEventInput) {
    const key = `${projection.tenantId}:${projection.traceLinkId}`
    const next = { ...structuredClone(projection), active: projection.type === 'design-test-link.upsert' }
    const previous = this.designTestLinks.get(key)
    const changed = JSON.stringify(previous) !== JSON.stringify(next)
    if (changed) {
      this.designTestLinks.set(key, next)
      this.outboxEvents.push({ ...structuredClone(outbound), id: randomUUID(), attempts: 0, createdAt: new Date().toISOString() })
    }
    return changed
  }

  async claimOutboxEvents(limit = 100, leaseMs = 30_000) {
    const now = Date.now()
    return this.outboxEvents
      .filter(event => !event.publishedAt && (!event.lockedUntil || event.lockedUntil <= now))
      .slice(0, limit)
      .map(event => {
        event.attempts += 1
        event.lockedUntil = now + leaseMs
        return structuredClone({ id: event.id, topic: event.topic, key: event.key, payload: event.payload, attempts: event.attempts, createdAt: event.createdAt })
      })
  }

  async markOutboxPublished(id: string) {
    const event = this.outboxEvents.find(candidate => candidate.id === id)
    if (event) Object.assign(event, { publishedAt: new Date().toISOString(), lockedUntil: undefined, lastError: undefined })
  }

  async releaseOutboxEvent(id: string, error: string) {
    const event = this.outboxEvents.find(candidate => candidate.id === id)
    if (event) Object.assign(event, { lockedUntil: undefined, lastError: error })
  }
}

export class PostgresCatalogStore implements CatalogStore {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }

  async checkReadiness() {
    await this.pool.query('SELECT 1')
  }

  async portfolio(tenantId?: string): Promise<Portfolio> {
    const [repositories, operations, surfaces, tests, expectations, findings, diagnostics, requirements, criteria, flows, steps, suggestions, exclusions] = await Promise.all([
      this.pool.query('SELECT * FROM fuzequality.repositories WHERE enabled = true ORDER BY name'),
      this.pool.query('SELECT * FROM fuzequality.api_operations WHERE active = true ORDER BY path, method'),
      this.pool.query('SELECT * FROM fuzequality.frontend_surfaces WHERE active = true ORDER BY package_name, name'),
      this.pool.query('SELECT * FROM fuzequality.test_cases WHERE active = true ORDER BY source_path, title'),
      this.pool.query('SELECT * FROM fuzequality.test_expectations WHERE active = true ORDER BY subject_id, kind'),
      this.pool.query('SELECT * FROM fuzequality.findings ORDER BY severity, title'),
      this.pool.query('SELECT * FROM fuzequality.scan_diagnostics ORDER BY source_path, code'),
      this.pool.query(`SELECT * FROM fuzequality.requirements WHERE active = true${tenantId ? ' AND tenant_id=$1' : ''} ORDER BY jira_key`, tenantId ? [tenantId] : []),
      this.pool.query('SELECT * FROM fuzequality.acceptance_criteria WHERE active = true ORDER BY requirement_id, position'),
      this.pool.query(`SELECT f.* FROM fuzequality.flows f JOIN fuzequality.requirements r ON r.id=f.requirement_id WHERE f.status <> 'rejected'${tenantId ? ' AND r.tenant_id=$1' : ''} ORDER BY f.updated_at DESC`, tenantId ? [tenantId] : []),
      this.pool.query('SELECT * FROM fuzequality.flow_steps ORDER BY flow_id, position'),
      this.pool.query(`SELECT s.* FROM fuzequality.suggestions s JOIN fuzequality.requirements r ON r.id=s.requirement_id${tenantId ? ' WHERE r.tenant_id=$1' : ''} ORDER BY s.created_at DESC`, tenantId ? [tenantId] : []),
      tenantId ? this.pool.query(`SELECT expectation_id, owner, reason, expires_at FROM fuzequality.expectation_exclusions WHERE tenant_id=$1 AND revoked_at IS NULL AND expires_at > now()`, [tenantId]) : Promise.resolve({ rows: [] }),
    ])
    const result = {
      repositories: repositories.rows.filter(row => !tenantId || row.tenant_id === tenantId).map(row => ({
        id: row.id,
        tenantId: row.tenant_id,
        owner: row.owner,
        name: row.name,
        canonicalUrl: row.canonical_url,
        defaultBranch: row.default_branch,
        kind: row.kind,
        installationId: row.installation_id ?? undefined,
        enabled: row.enabled,
        includeGlobs: row.config?.includeGlobs ?? [],
        excludeGlobs: row.config?.excludeGlobs ?? [],
        jiraProjects: row.config?.jiraProjects ?? [],
        jiraBindings: row.config?.jiraBindings ?? [],
        ownership: row.config?.ownership,
        localPath: row.config?.localPath,
        storybookBaseUrl: row.config?.storybookBaseUrl,
        lastScanAt: row.last_scan_at?.toISOString(),
        lastScanRevision: row.last_scan_revision ?? undefined,
        lastScanStatus: row.last_scan_status,
        lastScanDetails: row.last_scan_details ?? undefined,
        lastAnalysis: row.last_analysis ?? undefined,
      })),
      operations: operations.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, documentPath: row.document_path, operationId: row.operation_id ?? undefined, method: row.method, path: row.path, summary: row.summary, tags: row.tags, security: row.security, parameters: row.parameters, responses: row.responses, ...(row.details ?? {}) })),
      surfaces: surfaces.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, packageName: row.package_name, kind: row.kind, name: row.name, sourcePath: row.source_path, routePath: row.route_path ?? undefined, public: row.is_public, states: row.states, hasStory: row.has_story, stories: row.stories ?? [] })),
      tests: tests.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, framework: row.framework, level: row.test_level, title: row.title, sourcePath: row.source_path, assertionCount: row.assertion_count, targets: row.targets })),
      expectations: expectations.rows.map(row => ({ id: row.id, subjectType: row.subject_type, subjectId: row.subject_id, kind: row.kind, label: row.label, priority: row.priority, rule: row.rule, coverage: row.coverage, evidenceIds: row.evidence_ids })),
      findings: findings.rows.map(row => ({ id: row.id, repositoryId: row.repository_id ?? undefined, subjectId: row.subject_id ?? undefined, type: row.type, severity: row.severity, title: row.title, detail: row.detail, owner: row.owner ?? undefined, remediation: row.remediation ?? undefined, sourceRevision: row.source_revision ?? undefined, policyVersion: row.policy_version ?? undefined, schemaVersion: row.schema_version ?? undefined, evidenceStrength: row.evidence_strength ?? undefined, evidence: row.evidence ?? undefined, confidence: row.confidence === null ? undefined : Number(row.confidence), sourcePassages: row.source_passages ?? undefined, affectedFlowIds: row.affected_flow_ids ?? undefined, affectedTargetIds: row.affected_target_ids ?? undefined, remediationOptions: row.remediation_options ?? undefined, generatedAt: row.generated_at?.toISOString(), auditHistory: row.audit_history ?? undefined, status: row.status })),
      diagnostics: diagnostics.rows.map(row => ({ repositoryId: row.repository_id, revision: row.revision, sourcePath: row.source_path, category: row.category, severity: row.severity, code: row.code, message: row.message })),
      requirements: requirements.rows.map(row => ({ id: row.id, jiraKey: row.jira_key, issueType: row.issue_type, parentKey: row.parent_key ?? undefined, summary: row.summary, description: row.normalized_description, status: row.status, project: row.project, updatedAt: row.source_updated_at.toISOString(), acceptanceCriteria: criteria.rows.filter(item => item.requirement_id === row.id).map(item => ({ fingerprint: item.fingerprint, position: item.position, text: item.normalized_text })) })),
      flows: flows.rows.map(row => ({ id: row.id, requirementId: row.requirement_id, title: row.title, owner: row.owner ?? undefined, origin: row.origin, status: row.status, actors: row.details?.actors ?? [], preconditions: row.details?.preconditions ?? [], trigger: row.details?.trigger, authorizationBoundaries: row.details?.authorizationBoundaries ?? [], tenantBoundaries: row.details?.tenantBoundaries ?? [], steps: steps.rows.filter(step => step.flow_id === row.id).map(step => ({ id: step.id, position: step.position, actor: step.actor, action: step.action, expectedOutcome: step.expected_outcome, variant: step.variant, targetIds: step.target_ids })) })),
      suggestions: suggestions.rows.map(row => ({ id: row.id, requirementId: row.requirement_id, type: row.type, title: row.title, confidence: Number(row.confidence), evidence: row.evidence, payload: row.payload, state: row.state, createdAt: row.created_at.toISOString() })),
    } as Portfolio
    const repositoryIds = new Set(result.repositories.map(repository => repository.id))
    if (!tenantId) return result
    result.operations = result.operations.filter(item => repositoryIds.has(item.repositoryId))
    result.surfaces = result.surfaces.filter(item => repositoryIds.has(item.repositoryId))
    result.tests = result.tests.filter(item => repositoryIds.has(item.repositoryId))
    const subjectIds = new Set([...result.operations.map(item => item.id), ...result.surfaces.map(item => item.id)])
    const requirementIds = new Set(result.requirements.map(item => item.id))
    const exclusionByExpectation = new Map(exclusions.rows.map(row => [row.expectation_id, row]))
    result.expectations = result.expectations.filter(item => subjectIds.has(item.subjectId) || (item.subjectType === 'flow-step' && requirementIds.has(item.subjectId.replace(/^requirement:/, '')))).map(item => {
      const exclusion = exclusionByExpectation.get(item.id)
      if (!exclusion) return item
      const expiresAt = exclusion.expires_at.toISOString()
      return { ...item, coverage: 'excluded' as const, exclusion: { owner: exclusion.owner, reason: exclusion.reason, expiresAt, expiresSoon: exclusion.expires_at.getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000 } }
    })
    result.findings = result.findings.filter(item => !item.repositoryId || repositoryIds.has(item.repositoryId))
    result.diagnostics = result.diagnostics.filter(item => repositoryIds.has(item.repositoryId))
    return result
  }

  async repository(id: string, tenantId?: string) {
    return (await this.portfolio(tenantId)).repositories.find(item => item.id === id)
  }

  async repositoryScanHistory(id: string, tenantId: string, query: RepositoryScanHistoryQuery = {}): Promise<RepositoryScanHistoryEntry[]> {
    if (!await this.repository(id, tenantId)) return []
    const values: unknown[] = [id]
    const after = query.after?.scannedAt
      ? `AND (r.scanned_at < $2::timestamptz OR (r.scanned_at = $2::timestamptz AND r.id < $3::uuid) OR r.scanned_at IS NULL)`
      : query.after
        ? `AND r.scanned_at IS NULL AND r.id < $2::uuid`
        : ''
    if (query.after?.scannedAt) values.push(query.after.scannedAt, query.after.id)
    else if (query.after) values.push(query.after.id)
    values.push(query.limit ?? 25)
    const limitParameter = values.length
    const result = await this.pool.query(
      `SELECT r.id, r.commit_sha, r.branch, r.status AS revision_status, r.scanned_at, s.trigger, s.counts
       FROM fuzequality.repository_revisions r
       LEFT JOIN LATERAL (SELECT * FROM fuzequality.scan_runs WHERE revision_id=r.id ORDER BY started_at DESC LIMIT 1) s ON true
       WHERE r.repository_id=$1 ${after}
       ORDER BY r.scanned_at DESC NULLS LAST, r.id DESC
       LIMIT $${limitParameter}`,
      values,
    )
    return result.rows.map(row => ({ id: row.id, revision: row.commit_sha, branch: row.branch, status: row.revision_status, scannedAt: row.scanned_at?.toISOString(), trigger: row.trigger ?? 'manual', counts: row.counts ?? { operations: 0, surfaces: 0, tests: 0, diagnostics: 0 } }))
  }

  async catalogRevisionForSource(repositoryId: string, tenantId: string, sourceRevision: string) {
    if (!await this.repository(repositoryId, tenantId)) return undefined
    const result = await this.pool.query(
      `SELECT catalog_revision
       FROM fuzequality.repository_revision_sources
       WHERE repository_id=$1 AND source_revision=$2
       ORDER BY scanned_at DESC NULLS LAST
       LIMIT 1`,
      [repositoryId, sourceRevision],
    )
    return result.rows[0]?.catalog_revision
  }

  async qualityArtifacts(repositoryId: string, tenantId: string, revision?: string, query?: QualityArtifactQuery): Promise<QualityArtifact[]> {
    if (!await this.repository(repositoryId, tenantId)) return []
    const result = query
      ? await this.pool.query(
          `SELECT id, repository_id, kind, title, source_path, summary, evidence, execution_target
           FROM fuzequality.repository_quality_artifacts
           WHERE repository_id=$1
             AND revision=${revision ? '$2' : '(SELECT last_scan_revision FROM fuzequality.repositories WHERE id=$1)'}
             AND id > $${revision ? 3 : 2}
           ORDER BY id
           LIMIT $${revision ? 4 : 3}`,
          revision
            ? [repositoryId, revision, query.afterId ?? '', query.limit ?? 100]
            : [repositoryId, query.afterId ?? '', query.limit ?? 100],
        )
      : revision
        ? await this.pool.query(revisionQualityArtifactsSql, [repositoryId, revision])
        : await this.pool.query(currentQualityArtifactsSql, [repositoryId])
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, kind: row.kind, title: row.title, sourcePath: row.source_path, summary: row.summary, evidence: row.evidence, execution: row.execution_target ?? undefined }))
  }

  async qualityArtifactsByIds(repositoryId: string, tenantId: string, ids: string[]): Promise<QualityArtifact[]> {
    if (!ids.length) return []
    const result = await this.pool.query(
      `SELECT artifact.id,artifact.repository_id,artifact.kind,artifact.title,artifact.source_path,artifact.summary,artifact.evidence,artifact.execution_target
       FROM fuzequality.repository_quality_artifacts AS artifact
       JOIN fuzequality.repositories AS repository ON repository.id=artifact.repository_id
       WHERE artifact.repository_id=$1 AND repository.tenant_id=$2 AND artifact.id=ANY($3::text[])
       ORDER BY artifact.id`,
      [repositoryId, tenantId, ids],
    )
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, kind: row.kind, title: row.title, sourcePath: row.source_path, summary: row.summary, evidence: row.evidence, execution: row.execution_target ?? undefined }))
  }

  async repositoryFlowCandidates(repositoryId: string, tenantId: string, query: RepositoryFlowCandidateQuery = {}): Promise<RepositoryFlowCandidate[]> {
    const result = await this.pool.query(
      `SELECT * FROM fuzequality.repository_flow_candidates
       WHERE repository_id=$1 AND tenant_id=$2
         AND ($3::text IS NULL OR id=$3)
         AND ($4::text IS NULL OR source=$4)
         AND ($5::text IS NULL OR status=$5)
         AND ($6::text IS NULL OR revision=$6)
         AND ($7::text IS NULL OR analysis_provenance->>'model'=$7)
         AND ($8::text IS NULL OR analysis_provenance->>'promptVersion'=$8)
         AND ($9::text IS NULL OR analysis_provenance->>'schemaVersion'=$9)
         AND ($10::double precision IS NULL OR confidence >= $10)
         AND ($11::double precision IS NULL OR confidence <= $11)
         AND ($12::timestamptz IS NULL OR (created_at,id) < ($12::timestamptz,$13::text))
       ORDER BY created_at DESC,id DESC
       LIMIT COALESCE($14::integer, 2147483647)`,
      [repositoryId, tenantId, query.id ?? null, query.source ?? null, query.status ?? null, query.revision ?? null, query.model ?? null, query.promptVersion ?? null, query.schemaVersion ?? null, query.minConfidence ?? null, query.maxConfidence ?? null, query.after?.createdAt ?? null, query.after?.id ?? null, query.limit ?? null],
    )
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, revision: row.revision, title: row.title, confidence: Number(row.confidence), evidence: row.evidence, steps: row.steps, wireframe: flowWireframe(row.wireframe, row.steps), status: row.status, reviewedAt: row.reviewed_at?.toISOString(), reviewedBy: row.reviewed_by ?? undefined, reviewReason: row.review_reason ?? undefined, analysis: row.analysis_provenance ?? undefined, source: row.source, createdAt: row.created_at.toISOString() }))
  }

  async saveRepositoryFlowCandidates(candidates: RepositoryFlowCandidate[]): Promise<void> {
    for (const item of candidates) await this.pool.query(
      `INSERT INTO fuzequality.repository_flow_candidates (id,repository_id,tenant_id,revision,title,confidence,evidence,steps,wireframe,status,source,analysis_provenance,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (repository_id,revision,title,source) DO UPDATE SET confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,steps=EXCLUDED.steps,wireframe=EXCLUDED.wireframe,analysis_provenance=EXCLUDED.analysis_provenance,created_at=EXCLUDED.created_at`,
      [item.id,item.repositoryId,item.tenantId,item.revision,item.title,item.confidence,JSON.stringify(item.evidence),JSON.stringify(item.steps),JSON.stringify(item.wireframe ?? { kind: 'sequence', nodes: [] }),item.status,item.source,item.analysis ? JSON.stringify(item.analysis) : null,item.createdAt],
    )
  }

  async reviewRepositoryFlowCandidate(id: string, tenantId: string, review: { status: 'confirmed' | 'rejected'; reviewedBy: string; reason?: string }, expectedRevision?: string) {
    const client = await this.pool.connect()
    let result: pg.QueryResult
    try {
      await client.query('BEGIN')
      result = await client.query(
        `UPDATE fuzequality.repository_flow_candidates AS candidate
         SET status=$3,reviewed_at=now(),reviewed_by=$4,review_reason=$5
         WHERE candidate.id=$1 AND candidate.tenant_id=$2
           AND ($6::text IS NULL OR (
             candidate.revision=$6
             AND EXISTS (
               SELECT 1 FROM fuzequality.repositories AS repository
               WHERE repository.id=candidate.repository_id
                 AND repository.tenant_id=candidate.tenant_id
                 AND repository.last_scan_revision=$6
               FOR UPDATE
             )
           ))
         RETURNING candidate.*`,
        [id, tenantId, review.status, review.reviewedBy, review.reason ?? null, expectedRevision ?? null],
      )
      if (result.rows[0]) await client.query(
        'INSERT INTO fuzequality.repository_flow_review_history (id,candidate_id,tenant_id,status,reviewed_by,reason) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), id, tenantId, review.status, review.reviewedBy, review.reason ?? null],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    const row = result.rows[0]
    return row ? { id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, revision: row.revision, title: row.title, confidence: Number(row.confidence), evidence: row.evidence, steps: row.steps, wireframe: flowWireframe(row.wireframe, row.steps), status: row.status, reviewedAt: row.reviewed_at?.toISOString(), reviewedBy: row.reviewed_by ?? undefined, reviewReason: row.review_reason ?? undefined, analysis: row.analysis_provenance ?? undefined, source: row.source, createdAt: row.created_at.toISOString() } : undefined
  }

  async repositoryFlowReviewHistory(candidateId: string, tenantId: string, query: ReviewHistoryQuery = {}): Promise<RepositoryFlowReviewHistoryEntry[]> {
    const result = await this.pool.query(
      `SELECT id,candidate_id,tenant_id,status,reviewed_by,reason,created_at
       FROM fuzequality.repository_flow_review_history
       WHERE candidate_id=$1 AND tenant_id=$2
         AND ($3::timestamptz IS NULL OR (created_at,id) < ($3::timestamptz,$4::uuid))
       ORDER BY created_at DESC,id DESC
       LIMIT COALESCE($5::integer, 2147483647)`,
      [candidateId, tenantId, query.after?.createdAt ?? null, query.after?.id ?? null, query.limit ?? null],
    )
    return result.rows.map(row => ({ id: row.id, candidateId: row.candidate_id, tenantId: row.tenant_id, status: row.status, reviewedBy: row.reviewed_by, reason: row.reason ?? undefined, createdAt: row.created_at.toISOString() }))
  }

  async policyGateEvaluations(repositoryId: string, tenantId: string, query: PolicyGateEvaluationQuery = {}): Promise<PolicyGateEvaluation[]> {
    const result = await this.pool.query(
      `SELECT * FROM fuzequality.policy_gate_evaluations
       WHERE repository_id=$1 AND tenant_id=$2
         AND ($3::text IS NULL OR id=$3)
         AND ($4::text IS NULL OR kind=$4)
         AND ($5::text IS NULL OR severity=$5)
         AND ($6::text IS NULL OR review_status=$6)
         AND ($7::text IS NULL OR revision=$7)
         AND ($8::double precision IS NULL OR confidence >= $8)
         AND ($9::double precision IS NULL OR confidence <= $9)
         AND ($10::timestamptz IS NULL OR (created_at,id) < ($10::timestamptz,$11::text))
         AND ($13::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(COALESCE(scope->'subjects', '[]'::jsonb)) AS scoped_subject(value)
           WHERE lower(scoped_subject.value)=lower($13)
         ))
         AND ($14::text IS NULL OR remediation_action=$14)
       ORDER BY created_at DESC,id DESC
       LIMIT COALESCE($12::integer, 2147483647)`,
      [repositoryId, tenantId, query.id ?? null, query.kind ?? null, query.severity ?? null, query.reviewStatus ?? null, query.revision ?? null, query.minConfidence ?? null, query.maxConfidence ?? null, query.after?.createdAt ?? null, query.after?.id ?? null, query.limit ?? null, query.subject ?? null, query.remediationAction ?? null],
    )
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, revision: row.revision, kind: row.kind, severity: row.severity, title: row.title, detail: row.detail, policyArtifactIds: row.policy_artifact_ids, gateArtifactIds: row.gate_artifact_ids, confidence: Number(row.confidence), scope: row.scope, evidencePassages: row.evidence_passages ?? [], remediationAction: row.remediation_action, recommendation: row.recommendation, reviewStatus: row.review_status, reviewedAt: row.reviewed_at?.toISOString(), reviewedBy: row.reviewed_by ?? undefined, reviewReason: row.review_reason ?? undefined, createdAt: row.created_at.toISOString() }))
  }

  async savePolicyGateEvaluations(evaluations: PolicyGateEvaluation[]): Promise<void> {
    for (const item of evaluations) await this.pool.query(
      `INSERT INTO fuzequality.policy_gate_evaluations (id,repository_id,tenant_id,revision,kind,severity,title,detail,policy_artifact_ids,gate_artifact_ids,confidence,scope,evidence_passages,remediation_action,recommendation,review_status,reviewed_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (repository_id,revision,kind,title) DO UPDATE SET severity=EXCLUDED.severity,detail=EXCLUDED.detail,policy_artifact_ids=EXCLUDED.policy_artifact_ids,gate_artifact_ids=EXCLUDED.gate_artifact_ids,confidence=EXCLUDED.confidence,scope=EXCLUDED.scope,evidence_passages=EXCLUDED.evidence_passages,remediation_action=EXCLUDED.remediation_action,recommendation=EXCLUDED.recommendation,created_at=EXCLUDED.created_at`,
      [item.id,item.repositoryId,item.tenantId,item.revision,item.kind,item.severity,item.title,item.detail,JSON.stringify(item.policyArtifactIds),JSON.stringify(item.gateArtifactIds),item.confidence,JSON.stringify(item.scope),JSON.stringify(item.evidencePassages ?? []),item.remediationAction,item.recommendation,item.reviewStatus,item.reviewedAt ?? null,item.createdAt],
    )
  }

  async reviewPolicyGateEvaluation(id: string, tenantId: string, review: { status: 'accepted' | 'dismissed'; reviewedBy: string; reason?: string }, expectedRevision?: string) {
    const client = await this.pool.connect()
    let result: pg.QueryResult
    try {
      await client.query('BEGIN')
      result = await client.query(
        `UPDATE fuzequality.policy_gate_evaluations AS evaluation
         SET review_status=$3, reviewed_at=now(), reviewed_by=$4, review_reason=$5
         WHERE evaluation.id=$1 AND evaluation.tenant_id=$2
           AND ($6::text IS NULL OR (
             evaluation.revision=$6
             AND EXISTS (
               SELECT 1 FROM fuzequality.repositories AS repository
               WHERE repository.id=evaluation.repository_id
                 AND repository.tenant_id=evaluation.tenant_id
                 AND repository.last_scan_revision=$6
               FOR UPDATE
             )
           ))
         RETURNING evaluation.*`,
        [id, tenantId, review.status, review.reviewedBy, review.reason ?? null, expectedRevision ?? null],
      )
      if (result.rows[0]) await client.query('INSERT INTO fuzequality.policy_gate_review_history (id,evaluation_id,tenant_id,status,reviewed_by,reason) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, tenantId, review.status, review.reviewedBy, review.reason ?? null])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    const row = result.rows[0]
    return row ? { id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, revision: row.revision, kind: row.kind, severity: row.severity, title: row.title, detail: row.detail, policyArtifactIds: row.policy_artifact_ids, gateArtifactIds: row.gate_artifact_ids, confidence: Number(row.confidence), scope: row.scope, evidencePassages: row.evidence_passages ?? [], remediationAction: row.remediation_action, recommendation: row.recommendation, reviewStatus: row.review_status, reviewedAt: row.reviewed_at?.toISOString(), reviewedBy: row.reviewed_by ?? undefined, reviewReason: row.review_reason ?? undefined, createdAt: row.created_at.toISOString() } : undefined
  }

  async policyGateReviewHistory(evaluationId: string, tenantId: string, query: ReviewHistoryQuery = {}): Promise<PolicyGateReviewHistoryEntry[]> {
    const result = await this.pool.query(
      `SELECT id,evaluation_id,tenant_id,status,reviewed_by,reason,created_at
       FROM fuzequality.policy_gate_review_history
       WHERE evaluation_id=$1 AND tenant_id=$2
         AND ($3::timestamptz IS NULL OR (created_at,id) < ($3::timestamptz,$4::uuid))
       ORDER BY created_at DESC,id DESC
       LIMIT COALESCE($5::integer, 2147483647)`,
      [evaluationId, tenantId, query.after?.createdAt ?? null, query.after?.id ?? null, query.limit ?? null],
    )
    return result.rows.map(row => ({ id: row.id, evaluationId: row.evaluation_id, tenantId: row.tenant_id, status: row.status, reviewedBy: row.reviewed_by, reason: row.reason ?? undefined, createdAt: row.created_at.toISOString() }))
  }

  async testExecutions(repositoryId: string, tenantId: string, query: TestExecutionQuery = {}): Promise<TestExecution[]> {
    const result = await this.pool.query(
      `SELECT executions.* FROM fuzequality.test_executions executions
       WHERE executions.repository_id=$1 AND executions.tenant_id=$2
         AND ($3::text IS NULL OR executions.kind=$3)
         AND ($4::text IS NULL OR executions.status=$4)
         AND ($5::text IS NULL OR executions.provider=$5)
         AND ($6::text IS NULL OR executions.revision=$6)
         AND ($7::text IS NULL OR executions.workflow_path=$7)
         AND ($8::text IS NULL
           OR ($8='initial' AND executions.attempt=1)
           OR ($8='retry' AND executions.attempt>1)
           OR ($8='recovered' AND executions.attempt>1 AND executions.status='passed' AND EXISTS (
             SELECT 1 FROM fuzequality.test_executions previous
             WHERE previous.repository_id=executions.repository_id
               AND previous.tenant_id=executions.tenant_id
               AND previous.provider=executions.provider
               AND previous.external_run_id=executions.external_run_id
               AND previous.attempt<executions.attempt
               AND previous.status='failed'
           )))
         AND ($9::bigint IS NULL OR (
           executions.started_at IS NOT NULL
           AND executions.completed_at IS NOT NULL
           AND executions.completed_at >= executions.started_at
           AND EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 >= $9
         ))
         AND ($10::bigint IS NULL OR (
           executions.started_at IS NOT NULL
           AND executions.completed_at IS NOT NULL
           AND executions.completed_at >= executions.started_at
           AND EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 <= $10
         ))
         AND ($11::timestamptz IS NULL OR COALESCE(executions.completed_at,executions.started_at,'epoch'::timestamptz) >= $11)
         AND ($12::timestamptz IS NULL OR COALESCE(executions.completed_at,executions.started_at,'epoch'::timestamptz) <= $12)
         AND ($13::timestamptz IS NULL OR (COALESCE(executions.completed_at,executions.started_at,'epoch'::timestamptz),executions.id) < ($13::timestamptz,$14::text))
         AND ($16::text IS NULL OR executions.external_run_id=$16)
         AND ($17::text IS NULL OR COALESCE(executions.policy_artifact_ids,'[]'::jsonb) ? $17 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.gate_evaluations,'[]'::jsonb)) AS pair(value)
           WHERE pair.value->>'policyArtifactId'=$17
         ))
         AND ($18::text IS NULL OR COALESCE(executions.gate_artifact_ids,'[]'::jsonb) ? $18 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.gate_evaluations,'[]'::jsonb)) AS pair(value)
           WHERE pair.value->>'gateArtifactId'=$18
         ))
         AND ($17::text IS NULL OR $18::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.gate_evaluations,'[]'::jsonb)) AS pair(value)
           WHERE pair.value->>'policyArtifactId'=$17 AND pair.value->>'gateArtifactId'=$18
         ) OR (
           jsonb_array_length(COALESCE(executions.gate_evaluations,'[]'::jsonb))=0
           AND jsonb_array_length(COALESCE(executions.policy_artifact_ids,'[]'::jsonb))=1
           AND jsonb_array_length(COALESCE(executions.gate_artifact_ids,'[]'::jsonb))=1
           AND executions.policy_artifact_ids->>0=$17
           AND executions.gate_artifact_ids->>0=$18
         ))
         AND ($19::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.evidence_links,'[]'::jsonb)) AS evidence(value)
           WHERE evidence.value->>'kind'=$19
         ))
         AND ($20::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.thresholds,'[]'::jsonb)) AS threshold(value)
           WHERE threshold.value->>'passed'=CASE $20 WHEN 'passed' THEN 'true' ELSE 'false' END
         ))
         AND ($21::text IS NULL OR executions.name=$21)
         AND ($22::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE
               WHEN jsonb_array_length(COALESCE(executions.gate_evaluations,'[]'::jsonb))>0
                 THEN executions.gate_evaluations
               WHEN jsonb_array_length(COALESCE(executions.policy_artifact_ids,'[]'::jsonb))=1
                 AND jsonb_array_length(COALESCE(executions.gate_artifact_ids,'[]'::jsonb))=1
                 THEN jsonb_build_array(jsonb_build_object('status',executions.status))
               ELSE '[]'::jsonb
             END
           ) AS gate_evaluation(value)
           WHERE COALESCE(gate_evaluation.value->>'status',executions.status)=$22
         ))
         AND ($23::text IS NULL OR executions.branch=$23)
       ORDER BY COALESCE(executions.completed_at,executions.started_at,'epoch'::timestamptz) DESC,executions.id DESC
       LIMIT COALESCE($15::integer, 2147483647)`,
      [repositoryId, tenantId, query.kind ?? null, query.status ?? null, query.provider ?? null, query.revision ?? null, query.workflowPath ?? null, query.attemptScope ?? null, query.minimumDurationMs ?? null, query.maximumDurationMs ?? null, query.from ?? null, query.until ?? null, query.after?.createdAt ?? null, query.after?.id ?? null, query.limit ?? null, query.externalRunId ?? null, query.policyArtifactId ?? null, query.gateArtifactId ?? null, query.evidenceKind ?? null, query.thresholdOutcome ?? null, query.name ?? null, query.gateOutcome ?? null, query.branch ?? null],
    )
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, provider: row.provider, externalRunId: row.external_run_id, attempt: row.attempt, revision: row.revision, branch: row.branch ?? undefined, kind: row.kind, status: row.status, name: row.name, workflowPath: row.workflow_path ?? undefined, sourceUrl: row.source_url ?? undefined, startedAt: row.started_at?.toISOString(), completedAt: row.completed_at?.toISOString(), policyArtifactIds: row.policy_artifact_ids, gateArtifactIds: row.gate_artifact_ids, gateEvaluations: row.gate_evaluations ?? [], thresholds: row.thresholds ?? [], evidenceLinks: row.evidence_links ?? [], summary: row.summary ?? undefined }))
  }

  async latestPerformanceExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]): Promise<TestExecution[]> {
    if (!workflowPaths.length) return []
    const result = await this.pool.query(
      `SELECT DISTINCT ON (workflow_path) *
       FROM fuzequality.test_executions
       WHERE repository_id=$1 AND tenant_id=$2
         AND kind IN ('load','stress')
         AND workflow_path=ANY($3::text[])
       ORDER BY workflow_path,COALESCE(completed_at,started_at,'epoch'::timestamptz) DESC,id DESC`,
      [repositoryId, tenantId, workflowPaths],
    )
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, provider: row.provider, externalRunId: row.external_run_id, attempt: row.attempt, revision: row.revision, branch: row.branch ?? undefined, kind: row.kind, status: row.status, name: row.name, workflowPath: row.workflow_path ?? undefined, sourceUrl: row.source_url ?? undefined, startedAt: row.started_at?.toISOString(), completedAt: row.completed_at?.toISOString(), policyArtifactIds: row.policy_artifact_ids, gateArtifactIds: row.gate_artifact_ids, gateEvaluations: row.gate_evaluations ?? [], thresholds: row.thresholds ?? [], evidenceLinks: row.evidence_links ?? [], summary: row.summary ?? undefined }))
  }

  async latestPostProductionExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]): Promise<TestExecution[]> {
    if (!workflowPaths.length) return []
    const result = await this.pool.query(
      `SELECT DISTINCT ON (workflow_path) *
       FROM fuzequality.test_executions
       WHERE repository_id=$1 AND tenant_id=$2
         AND kind='post-production'
         AND workflow_path=ANY($3::text[])
       ORDER BY workflow_path,COALESCE(completed_at,started_at,'epoch'::timestamptz) DESC,id DESC`,
      [repositoryId, tenantId, workflowPaths],
    )
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, provider: row.provider, externalRunId: row.external_run_id, attempt: row.attempt, revision: row.revision, branch: row.branch ?? undefined, kind: row.kind, status: row.status, name: row.name, workflowPath: row.workflow_path ?? undefined, sourceUrl: row.source_url ?? undefined, startedAt: row.started_at?.toISOString(), completedAt: row.completed_at?.toISOString(), policyArtifactIds: row.policy_artifact_ids, gateArtifactIds: row.gate_artifact_ids, gateEvaluations: row.gate_evaluations ?? [], thresholds: row.thresholds ?? [], evidenceLinks: row.evidence_links ?? [], summary: row.summary ?? undefined }))
  }

  async latestIntegrationExecutions(repositoryId: string, tenantId: string, workflowPaths: string[]): Promise<TestExecution[]> {
    if (!workflowPaths.length) return []
    const result = await this.pool.query(
      `SELECT DISTINCT ON (workflow_path) *
       FROM fuzequality.test_executions
       WHERE repository_id=$1 AND tenant_id=$2
         AND kind='integration'
         AND workflow_path=ANY($3::text[])
       ORDER BY workflow_path,COALESCE(completed_at,started_at,'epoch'::timestamptz) DESC,id DESC`,
      [repositoryId, tenantId, workflowPaths],
    )
    return result.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, provider: row.provider, externalRunId: row.external_run_id, attempt: row.attempt, revision: row.revision, branch: row.branch ?? undefined, kind: row.kind, status: row.status, name: row.name, workflowPath: row.workflow_path ?? undefined, sourceUrl: row.source_url ?? undefined, startedAt: row.started_at?.toISOString(), completedAt: row.completed_at?.toISOString(), policyArtifactIds: row.policy_artifact_ids, gateArtifactIds: row.gate_artifact_ids, gateEvaluations: row.gate_evaluations ?? [], thresholds: row.thresholds ?? [], evidenceLinks: row.evidence_links ?? [], summary: row.summary ?? undefined }))
  }

  async executionOutcomeTrend(repositoryId: string, tenantId: string, query: ExecutionOutcomeTrendQuery = {}): Promise<ExecutionOutcomeTrend[]> {
    const result = await this.pool.query(
      `WITH snapshot_executions AS (
         SELECT DISTINCT ON (repository_id,provider,external_run_id,attempt)
                repository_id,provider,external_run_id,attempt,revision,branch,kind,status,name,workflow_path,started_at,completed_at,
                policy_artifact_ids,gate_artifact_ids,gate_evaluations,evidence_links,thresholds
         FROM fuzequality.test_execution_versions
         WHERE repository_id=$1 AND tenant_id=$2
           AND ($14::timestamptz IS NULL OR versioned_at <= $14)
         ORDER BY repository_id,provider,external_run_id,attempt,versioned_at DESC,version_id DESC
       )
       SELECT to_char((COALESCE(completed_at,started_at) AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS date,
              count(*)::integer AS total,
              count(*) FILTER (WHERE status='passed')::integer AS passed,
              count(*) FILTER (WHERE status='failed')::integer AS failed,
              count(*) FILTER (WHERE status='cancelled')::integer AS cancelled,
              count(*) FILTER (WHERE status='running')::integer AS running,
              CASE
                WHEN count(*) FILTER (WHERE status<>'running')=0 THEN 0
                ELSE (count(*) FILTER (WHERE status='passed'))::double precision /
                     (count(*) FILTER (WHERE status<>'running'))
              END AS pass_rate,
              count(*) FILTER (
                WHERE started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= started_at
              )::integer AS duration_sample_count,
              COALESCE(round(avg(EXTRACT(EPOCH FROM (completed_at-started_at))*1000) FILTER (
                WHERE started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= started_at
              )),0)::integer AS average_duration_ms,
              COALESCE(max(EXTRACT(EPOCH FROM (completed_at-started_at))*1000) FILTER (
                WHERE started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= started_at
              ),0)::integer AS maximum_duration_ms,
              count(*) FILTER (WHERE attempt>1)::integer AS retry_attempt_count,
              count(*) FILTER (WHERE executions.attempt>1 AND executions.status='passed')::integer AS successful_retry_count,
              count(*) FILTER (
                WHERE executions.attempt>1 AND executions.status='passed' AND EXISTS (
                  SELECT 1 FROM snapshot_executions previous
                  WHERE previous.provider=executions.provider
                    AND previous.external_run_id=executions.external_run_id
                    AND previous.attempt<executions.attempt
                    AND previous.status='failed'
                )
              )::integer AS recovered_run_count
       FROM snapshot_executions executions
       WHERE COALESCE(executions.completed_at,executions.started_at) IS NOT NULL
         AND ($3::text IS NULL OR executions.kind=$3)
         AND ($4::text IS NULL OR executions.status=$4)
         AND ($5::text IS NULL OR executions.provider=$5)
         AND ($6::text IS NULL OR executions.revision=$6)
         AND ($7::text IS NULL OR executions.workflow_path=$7)
         AND ($8::text IS NULL
           OR ($8='initial' AND executions.attempt=1)
           OR ($8='retry' AND executions.attempt>1)
           OR ($8='recovered' AND executions.attempt>1 AND executions.status='passed' AND EXISTS (
             SELECT 1 FROM snapshot_executions previous
             WHERE previous.provider=executions.provider
               AND previous.external_run_id=executions.external_run_id
               AND previous.attempt<executions.attempt
               AND previous.status='failed'
           )))
         AND ($9::bigint IS NULL OR (
           executions.started_at IS NOT NULL
           AND executions.completed_at IS NOT NULL
           AND executions.completed_at >= executions.started_at
           AND EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 >= $9
         ))
         AND ($10::bigint IS NULL OR (
           executions.started_at IS NOT NULL
           AND executions.completed_at IS NOT NULL
           AND executions.completed_at >= executions.started_at
           AND EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 <= $10
         ))
         AND ($11::timestamptz IS NULL OR COALESCE(executions.completed_at,executions.started_at) >= $11)
         AND ($12::timestamptz IS NULL OR COALESCE(executions.completed_at,executions.started_at) <= $12)
         AND ($13::date IS NULL OR (COALESCE(executions.completed_at,executions.started_at) AT TIME ZONE 'UTC')::date < $13)
         AND ($16::text IS NULL OR executions.external_run_id=$16)
         AND ($17::text IS NULL OR COALESCE(executions.policy_artifact_ids,'[]'::jsonb) ? $17 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.gate_evaluations,'[]'::jsonb)) AS pair(value)
           WHERE pair.value->>'policyArtifactId'=$17
         ))
         AND ($18::text IS NULL OR COALESCE(executions.gate_artifact_ids,'[]'::jsonb) ? $18 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.gate_evaluations,'[]'::jsonb)) AS pair(value)
           WHERE pair.value->>'gateArtifactId'=$18
         ))
         AND ($17::text IS NULL OR $18::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.gate_evaluations,'[]'::jsonb)) AS pair(value)
           WHERE pair.value->>'policyArtifactId'=$17 AND pair.value->>'gateArtifactId'=$18
         ) OR (
           jsonb_array_length(COALESCE(executions.gate_evaluations,'[]'::jsonb))=0
           AND jsonb_array_length(COALESCE(executions.policy_artifact_ids,'[]'::jsonb))=1
           AND jsonb_array_length(COALESCE(executions.gate_artifact_ids,'[]'::jsonb))=1
           AND executions.policy_artifact_ids->>0=$17
           AND executions.gate_artifact_ids->>0=$18
         ))
         AND ($19::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.evidence_links,'[]'::jsonb)) AS evidence(value)
           WHERE evidence.value->>'kind'=$19
         ))
         AND ($20::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(executions.thresholds,'[]'::jsonb)) AS threshold(value)
           WHERE threshold.value->>'passed'=CASE $20 WHEN 'passed' THEN 'true' ELSE 'false' END
         ))
         AND ($21::text IS NULL OR executions.name=$21)
         AND ($22::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE
               WHEN jsonb_array_length(COALESCE(executions.gate_evaluations,'[]'::jsonb))>0
                 THEN executions.gate_evaluations
               WHEN jsonb_array_length(COALESCE(executions.policy_artifact_ids,'[]'::jsonb))=1
                 AND jsonb_array_length(COALESCE(executions.gate_artifact_ids,'[]'::jsonb))=1
                 THEN jsonb_build_array(jsonb_build_object('status',executions.status))
               ELSE '[]'::jsonb
             END
           ) AS gate_evaluation(value)
           WHERE COALESCE(gate_evaluation.value->>'status',executions.status)=$22
         ))
         AND ($23::text IS NULL OR executions.branch=$23)
       GROUP BY (COALESCE(executions.completed_at,executions.started_at) AT TIME ZONE 'UTC')::date
       ORDER BY (COALESCE(executions.completed_at,executions.started_at) AT TIME ZONE 'UTC')::date DESC
       LIMIT COALESCE($15::integer, 2147483647)`,
      [repositoryId, tenantId, query.kind ?? null, query.status ?? null, query.provider ?? null, query.revision ?? null, query.workflowPath ?? null, query.attemptScope ?? null, query.minimumDurationMs ?? null, query.maximumDurationMs ?? null, query.from ?? null, query.until ?? null, query.beforeDate ?? null, query.snapshotAt ?? null, query.limit ?? null, query.externalRunId ?? null, query.policyArtifactId ?? null, query.gateArtifactId ?? null, query.evidenceKind ?? null, query.thresholdOutcome ?? null, query.name ?? null, query.gateOutcome ?? null, query.branch ?? null],
    )
    return result.rows.map(row => ({
      date: row.date,
      total: row.total,
      passed: row.passed,
      failed: row.failed,
      cancelled: row.cancelled,
      running: row.running,
      passRate: row.pass_rate,
      durationSampleCount: row.duration_sample_count,
      averageDurationMs: row.average_duration_ms,
      maximumDurationMs: row.maximum_duration_ms,
      retryAttemptCount: row.retry_attempt_count,
      successfulRetryCount: row.successful_retry_count,
      recoveredRunCount: row.recovered_run_count,
    }))
  }

  async policyGatePerformance(repositoryId: string, tenantId: string, query: PolicyGatePerformanceQuery = {}): Promise<PolicyGatePerformance[]> {
    const result = await this.pool.query(
      `WITH snapshot_executions AS (
         SELECT DISTINCT ON (repository_id,provider,external_run_id,attempt)
                repository_id,provider,external_run_id,attempt,revision,branch,kind,status,name,workflow_path,started_at,completed_at,
                policy_artifact_ids,gate_artifact_ids,gate_evaluations,evidence_links,thresholds
         FROM fuzequality.test_execution_versions
         WHERE repository_id=$1 AND tenant_id=$2
           AND ($13::timestamptz IS NULL OR versioned_at <= $13)
         ORDER BY repository_id,provider,external_run_id,attempt,versioned_at DESC,version_id DESC
       ), filtered_executions AS (
         SELECT repository_id,revision,status,completed_at,
                COALESCE(completed_at,started_at,'epoch'::timestamptz) AS occurred_at,
                gate_evaluations,policy_artifact_ids,gate_artifact_ids
         FROM snapshot_executions executions
         WHERE ($3::text IS NULL OR executions.kind=$3)
           AND ($4::text IS NULL OR executions.status=$4)
           AND ($5::text IS NULL OR executions.provider=$5)
           AND ($6::text IS NULL OR executions.revision=$6)
           AND ($7::text IS NULL OR executions.workflow_path=$7)
           AND ($8::text IS NULL
             OR ($8='initial' AND executions.attempt=1)
             OR ($8='retry' AND executions.attempt>1)
             OR ($8='recovered' AND executions.attempt>1 AND executions.status='passed' AND EXISTS (
               SELECT 1 FROM snapshot_executions previous
               WHERE previous.provider=executions.provider
                 AND previous.external_run_id=executions.external_run_id
                 AND previous.attempt<executions.attempt
                 AND previous.status='failed'
             )))
           AND ($9::bigint IS NULL OR (
             executions.started_at IS NOT NULL
             AND executions.completed_at IS NOT NULL
             AND executions.completed_at >= executions.started_at
             AND EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 >= $9
           ))
           AND ($10::bigint IS NULL OR (
             executions.started_at IS NOT NULL
             AND executions.completed_at IS NOT NULL
             AND executions.completed_at >= executions.started_at
             AND EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 <= $10
           ))
           AND ($11::timestamptz IS NULL OR COALESCE(executions.completed_at,executions.started_at,'epoch'::timestamptz) >= $11)
           AND ($12::timestamptz IS NULL OR COALESCE(executions.completed_at,executions.started_at,'epoch'::timestamptz) <= $12)
           AND ($19::text IS NULL OR executions.external_run_id=$19)
           AND ($22::text IS NULL OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(executions.evidence_links,'[]'::jsonb)) AS evidence(value)
             WHERE evidence.value->>'kind'=$22
           ))
           AND ($23::text IS NULL OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(executions.thresholds,'[]'::jsonb)) AS threshold(value)
             WHERE threshold.value->>'passed'=CASE $23 WHEN 'passed' THEN 'true' ELSE 'false' END
           ))
           AND ($24::text IS NULL OR executions.name=$24)
           AND ($26::text IS NULL OR executions.branch=$26)
       ), explicit_pairs AS (
         SELECT execution.repository_id,execution.revision,execution.completed_at,execution.occurred_at,
                pair.value->>'policyArtifactId' AS policy_artifact_id,
                pair.value->>'gateArtifactId' AS gate_artifact_id,
                COALESCE(pair.value->>'status',execution.status) AS outcome
         FROM filtered_executions AS execution
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE
             WHEN jsonb_array_length(execution.gate_evaluations)>0 THEN execution.gate_evaluations
             WHEN jsonb_array_length(execution.policy_artifact_ids)=1 AND jsonb_array_length(execution.gate_artifact_ids)=1
               THEN jsonb_build_array(jsonb_build_object(
                 'policyArtifactId',execution.policy_artifact_ids->>0,
                 'gateArtifactId',execution.gate_artifact_ids->>0,
                 'status',execution.status
               ))
             ELSE '[]'::jsonb
           END
         ) AS pair(value)
         WHERE pair.value->>'policyArtifactId' IS NOT NULL
           AND pair.value->>'gateArtifactId' IS NOT NULL
           AND ($20::text IS NULL OR pair.value->>'policyArtifactId'=$20)
           AND ($21::text IS NULL OR pair.value->>'gateArtifactId'=$21)
           AND ($25::text IS NULL OR COALESCE(pair.value->>'status',execution.status)=$25)
       ), aggregates AS (
         SELECT repository_id,policy_artifact_id,gate_artifact_id,
                count(*)::integer AS total,
                (count(*) FILTER (WHERE outcome='passed'))::integer AS passed,
                (count(*) FILTER (WHERE outcome='failed'))::integer AS failed,
                (count(*) FILTER (WHERE outcome='cancelled'))::integer AS cancelled,
                (count(*) FILTER (WHERE outcome='running'))::integer AS running,
                CASE
                  WHEN count(*) FILTER (WHERE outcome<>'running')=0 THEN 0
                  ELSE (count(*) FILTER (WHERE outcome='passed'))::double precision /
                       (count(*) FILTER (WHERE outcome<>'running'))
                END AS pass_rate,
                count(DISTINCT revision)::integer AS revision_count,
                (array_agg(revision ORDER BY occurred_at DESC,revision DESC))[1] AS latest_revision,
                max(completed_at) AS latest_completed_at
         FROM explicit_pairs
         WHERE policy_artifact_id IS NOT NULL AND gate_artifact_id IS NOT NULL
         GROUP BY repository_id,policy_artifact_id,gate_artifact_id
       )
       SELECT * FROM aggregates
       WHERE $14::integer IS NULL
          OR failed < $14
          OR (failed=$14 AND passed < $15)
          OR (failed=$14 AND passed=$15 AND gate_artifact_id > $16)
          OR (failed=$14 AND passed=$15 AND gate_artifact_id=$16 AND policy_artifact_id > $17)
       ORDER BY failed DESC,passed DESC,gate_artifact_id,policy_artifact_id
       LIMIT COALESCE($18::integer,2147483647)`,
      [repositoryId, tenantId, query.kind ?? null, query.status ?? null, query.provider ?? null, query.revision ?? null, query.workflowPath ?? null, query.attemptScope ?? null, query.minimumDurationMs ?? null, query.maximumDurationMs ?? null, query.from ?? null, query.until ?? null, query.snapshotAt ?? null, query.after?.failed ?? null, query.after?.passed ?? null, query.after?.gateArtifactId ?? null, query.after?.policyArtifactId ?? null, query.limit ?? null, query.externalRunId ?? null, query.policyArtifactId ?? null, query.gateArtifactId ?? null, query.evidenceKind ?? null, query.thresholdOutcome ?? null, query.name ?? null, query.gateOutcome ?? null, query.branch ?? null],
    )
    return result.rows.map(row => ({
      repositoryId: row.repository_id,
      policyArtifactId: row.policy_artifact_id,
      gateArtifactId: row.gate_artifact_id,
      total: row.total,
      passed: row.passed,
      failed: row.failed,
      cancelled: row.cancelled,
      running: row.running,
      passRate: row.pass_rate,
      revisionCount: row.revision_count,
      latestRevision: row.latest_revision,
      latestCompletedAt: row.latest_completed_at?.toISOString(),
    }))
  }

  async saveTestExecution(item: TestExecution): Promise<void> {
    await this.pool.query(
      `WITH upserted AS (
       INSERT INTO fuzequality.test_executions (id,repository_id,tenant_id,provider,external_run_id,attempt,revision,branch,kind,status,name,workflow_path,source_url,started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,thresholds,evidence_links,summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (repository_id,provider,external_run_id,attempt) DO UPDATE SET revision=EXCLUDED.revision,branch=COALESCE(EXCLUDED.branch,fuzequality.test_executions.branch),kind=EXCLUDED.kind,status=EXCLUDED.status,name=EXCLUDED.name,workflow_path=COALESCE(EXCLUDED.workflow_path,fuzequality.test_executions.workflow_path),source_url=COALESCE(EXCLUDED.source_url,fuzequality.test_executions.source_url),started_at=COALESCE(EXCLUDED.started_at,fuzequality.test_executions.started_at),completed_at=COALESCE(EXCLUDED.completed_at,fuzequality.test_executions.completed_at),policy_artifact_ids=CASE WHEN jsonb_array_length(EXCLUDED.policy_artifact_ids)>0 THEN EXCLUDED.policy_artifact_ids ELSE fuzequality.test_executions.policy_artifact_ids END,gate_artifact_ids=CASE WHEN jsonb_array_length(EXCLUDED.gate_artifact_ids)>0 THEN EXCLUDED.gate_artifact_ids ELSE fuzequality.test_executions.gate_artifact_ids END,gate_evaluations=CASE WHEN jsonb_array_length(EXCLUDED.gate_evaluations)>0 THEN EXCLUDED.gate_evaluations WHEN EXCLUDED.status<>'running' THEN (SELECT COALESCE(jsonb_agg(CASE WHEN evaluation->>'status'='running' THEN jsonb_set(evaluation,'{status}',to_jsonb(EXCLUDED.status)) ELSE evaluation END),'[]'::jsonb) FROM jsonb_array_elements(fuzequality.test_executions.gate_evaluations) AS gate(evaluation)) ELSE fuzequality.test_executions.gate_evaluations END,thresholds=CASE WHEN jsonb_array_length(EXCLUDED.thresholds)>0 THEN EXCLUDED.thresholds ELSE fuzequality.test_executions.thresholds END,evidence_links=(SELECT COALESCE(jsonb_agg(link ORDER BY ordinal),'[]'::jsonb) FROM (SELECT DISTINCT ON (link->>'kind',link->>'url') link,ordinal FROM jsonb_array_elements(fuzequality.test_executions.evidence_links || EXCLUDED.evidence_links) WITH ORDINALITY AS evidence(link,ordinal) ORDER BY link->>'kind',link->>'url',ordinal DESC) AS unique_links),summary=CASE WHEN length(COALESCE(EXCLUDED.summary,''))>length(COALESCE(fuzequality.test_executions.summary,'')) THEN EXCLUDED.summary ELSE fuzequality.test_executions.summary END
       WHERE fuzequality.test_executions.status = 'running' OR EXCLUDED.status <> 'running'
       RETURNING id,repository_id,tenant_id,provider,external_run_id,attempt,revision,branch,kind,status,name,workflow_path,
                 started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,thresholds,evidence_links
       )
       INSERT INTO fuzequality.test_execution_versions
         (execution_id,repository_id,tenant_id,provider,external_run_id,attempt,revision,branch,kind,status,name,workflow_path,
          started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,thresholds,evidence_links)
       SELECT id,repository_id,tenant_id,provider,external_run_id,attempt,revision,branch,kind,status,name,workflow_path,
              started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,thresholds,evidence_links
       FROM upserted`,
      [item.id,item.repositoryId,item.tenantId,item.provider,item.externalRunId,item.attempt,item.revision,item.branch ?? null,item.kind,item.status,item.name,item.workflowPath ?? null,item.sourceUrl ?? null,item.startedAt ?? null,item.completedAt ?? null,JSON.stringify(item.policyArtifactIds),JSON.stringify(item.gateArtifactIds),JSON.stringify(item.gateEvaluations),JSON.stringify(item.thresholds),JSON.stringify(item.evidenceLinks),item.summary ?? null],
    )
  }

  async upsertTenant(tenant: QualityTenant): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO fuzequality.tenants (id,slug,name,tenant_type,owner_id,active,deleted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $6 THEN NULL ELSE now() END,now())
       ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,tenant_type=EXCLUDED.tenant_type,
         owner_id=EXCLUDED.owner_id,active=EXCLUDED.active,deleted_at=CASE WHEN EXCLUDED.active THEN NULL ELSE now() END,
         updated_at=now()
       WHERE (fuzequality.tenants.slug,fuzequality.tenants.name,fuzequality.tenants.tenant_type,
         fuzequality.tenants.owner_id,fuzequality.tenants.active)
         IS DISTINCT FROM (EXCLUDED.slug,EXCLUDED.name,EXCLUDED.tenant_type,EXCLUDED.owner_id,EXCLUDED.active)
       RETURNING id`,
      [tenant.id, tenant.slug, tenant.name, tenant.type, tenant.ownerId ?? null, tenant.active],
    )
    return Boolean(result.rowCount)
  }

  async deactivateTenant(tenantId: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE fuzequality.tenants SET active=false, deleted_at=now(), updated_at=now() WHERE id=$1 AND active=true RETURNING id',
      [tenantId],
    )
    return Boolean(result.rowCount)
  }

  async upsertPrincipal(principal: QualityPrincipal): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO fuzequality.principals (id,email,first_name,last_name,active,deleted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN NULL ELSE now() END,now())
       ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,
         active=EXCLUDED.active,deleted_at=CASE WHEN EXCLUDED.active THEN NULL ELSE now() END,updated_at=now()
       WHERE (fuzequality.principals.email,fuzequality.principals.first_name,fuzequality.principals.last_name,
         fuzequality.principals.active) IS DISTINCT FROM (EXCLUDED.email,EXCLUDED.first_name,EXCLUDED.last_name,EXCLUDED.active)
       RETURNING id`,
      [principal.id, principal.email, principal.firstName ?? null, principal.lastName ?? null, principal.active],
    )
    return Boolean(result.rowCount)
  }

  async deactivatePrincipal(principalId: string, cascade: 'soft' | 'hard' = 'soft'): Promise<boolean> {
    const redactedEmail = `deleted+${principalId}@redacted.invalid`
    const result = cascade === 'hard'
      ? await this.pool.query(
          `UPDATE fuzequality.principals
           SET email=$2,first_name=NULL,last_name=NULL,active=false,deleted_at=COALESCE(deleted_at,now()),updated_at=now()
           WHERE id=$1 AND (active=true OR email IS DISTINCT FROM $2 OR first_name IS NOT NULL OR last_name IS NOT NULL)
           RETURNING id`,
          [principalId, redactedEmail],
        )
      : await this.pool.query(
          'UPDATE fuzequality.principals SET active=false, deleted_at=now(), updated_at=now() WHERE id=$1 AND active=true RETURNING id',
          [principalId],
        )
    return Boolean(result.rowCount)
  }

  async setOrganizationMembership(membership: QualityMembership): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO fuzequality.organization_memberships (tenant_id,principal_id,role,active,updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (tenant_id,principal_id) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active,updated_at=now()
       WHERE (fuzequality.organization_memberships.role,fuzequality.organization_memberships.active)
         IS DISTINCT FROM (EXCLUDED.role,EXCLUDED.active)
       RETURNING tenant_id`,
      [membership.tenantId, membership.principalId, membership.role, membership.active],
    )
    return Boolean(result.rowCount)
  }

  async projectIdentityLifecycle(projection: IdentityLifecycleProjection, outbound: OutboxEventInput): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      let result: pg.QueryResult
      switch (projection.type) {
        case 'organization.upsert': {
          const tenant = projection.tenant
          result = await client.query(
            `INSERT INTO fuzequality.tenants (id,slug,name,type,owner_id,active,deleted_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $6 THEN NULL ELSE now() END,now())
             ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,type=EXCLUDED.type,
               owner_id=EXCLUDED.owner_id,active=EXCLUDED.active,deleted_at=CASE WHEN EXCLUDED.active THEN NULL ELSE now() END,updated_at=now()
             WHERE (fuzequality.tenants.slug,fuzequality.tenants.name,fuzequality.tenants.type,fuzequality.tenants.owner_id,fuzequality.tenants.active)
               IS DISTINCT FROM (EXCLUDED.slug,EXCLUDED.name,EXCLUDED.type,EXCLUDED.owner_id,EXCLUDED.active)
             RETURNING id`,
            [tenant.id, tenant.slug, tenant.name, tenant.type, tenant.ownerId ?? null, tenant.active],
          )
          break
        }
        case 'organization.deleted':
          result = await client.query(
            `WITH deactivated_tenant AS (
               UPDATE fuzequality.tenants SET active=false, deleted_at=now(), updated_at=now()
               WHERE id=$1 AND active=true RETURNING id
             ), deactivated_memberships AS (
               UPDATE fuzequality.organization_memberships SET active=false, updated_at=now()
               WHERE tenant_id=$1 AND active=true RETURNING tenant_id
             )
             SELECT EXISTS (SELECT 1 FROM deactivated_tenant)
                 OR EXISTS (SELECT 1 FROM deactivated_memberships) AS changed`,
            [projection.tenantId],
          )
          break
        case 'user.upsert': {
          const principal = projection.principal
          result = await client.query(
            `INSERT INTO fuzequality.principals (id,email,first_name,last_name,active,deleted_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN NULL ELSE now() END,now())
             ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,
               active=EXCLUDED.active,deleted_at=CASE WHEN EXCLUDED.active THEN NULL ELSE now() END,updated_at=now()
             WHERE (fuzequality.principals.email,fuzequality.principals.first_name,fuzequality.principals.last_name,fuzequality.principals.active)
               IS DISTINCT FROM (EXCLUDED.email,EXCLUDED.first_name,EXCLUDED.last_name,EXCLUDED.active)
             RETURNING id`,
            [principal.id, principal.email, principal.firstName ?? null, principal.lastName ?? null, principal.active],
          )
          break
        }
        case 'user.deleted':
          result = await client.query(
            `WITH deactivated_principal AS (
               UPDATE fuzequality.principals
               SET email=CASE WHEN $2='hard' THEN $3 ELSE email END,
                   first_name=CASE WHEN $2='hard' THEN NULL ELSE first_name END,
                   last_name=CASE WHEN $2='hard' THEN NULL ELSE last_name END,
                   active=false, deleted_at=COALESCE(deleted_at,now()), updated_at=now()
               WHERE id=$1 AND (
                 active=true OR ($2='hard' AND (email IS DISTINCT FROM $3 OR first_name IS NOT NULL OR last_name IS NOT NULL))
               ) RETURNING id
             ), deactivated_memberships AS (
               UPDATE fuzequality.organization_memberships SET active=false, updated_at=now()
               WHERE principal_id=$1 AND active=true RETURNING principal_id
             )
             SELECT EXISTS (SELECT 1 FROM deactivated_principal)
                 OR EXISTS (SELECT 1 FROM deactivated_memberships) AS changed`,
            [projection.principalId, projection.cascade ?? 'soft', `deleted+${projection.principalId}@redacted.invalid`],
          )
          break
        case 'membership.changed': {
          const membership = projection.membership
          result = await client.query(
            `INSERT INTO fuzequality.organization_memberships (tenant_id,principal_id,role,active,updated_at)
             VALUES ($1,$2,$3,$4,now())
             ON CONFLICT (tenant_id,principal_id) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active,updated_at=now()
             WHERE (fuzequality.organization_memberships.role,fuzequality.organization_memberships.active)
               IS DISTINCT FROM (EXCLUDED.role,EXCLUDED.active)
             RETURNING tenant_id`,
            [membership.tenantId, membership.principalId, membership.role, membership.active],
          )
          break
        }
      }
      const changed = projection.type === 'organization.deleted' || projection.type === 'user.deleted'
        ? result.rows[0]?.changed === true
        : Boolean(result.rowCount)
      if (changed) {
        await client.query(
          'INSERT INTO fuzequality.outbox_events (topic,event_key,payload) VALUES ($1,$2,$3::jsonb)',
          [outbound.topic, outbound.key ?? null, JSON.stringify(outbound.payload)],
        )
      }
      await client.query('COMMIT')
      return changed
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async projectDesignTestLink(projection: DesignTestLinkProjection, outbound: OutboxEventInput): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const active = projection.type === 'design-test-link.upsert'
      // The test case is joined through its repository so a FuzeX event can
      // never attach a different organization's QA artifact. Removal is
      // deliberately allowed after a test is retired, but only for the exact
      // tenant/link/test relationship already projected.
      const ownership = active
        ? await client.query(
          `SELECT tc.id FROM fuzequality.test_cases tc
           JOIN fuzequality.repositories r ON r.id=tc.repository_id
           JOIN fuzequality.tenants t ON t.id=r.tenant_id
           WHERE tc.id=$1 AND tc.active=true AND r.tenant_id=$2 AND t.active=true`,
          [projection.testCaseId, projection.tenantId],
        )
        : await client.query(
          `SELECT trace_link_id AS id FROM fuzequality.design_test_links
           WHERE tenant_id=$1 AND trace_link_id=$2 AND test_case_id=$3`,
          [projection.tenantId, projection.traceLinkId, projection.testCaseId],
        )
      if (!ownership.rowCount) throw new Error('Design test link references an unavailable tenant-scoped test case')
      const result = await client.query(
        `INSERT INTO fuzequality.design_test_links
           (tenant_id,trace_link_id,fuzex_project_id,target_kind,target_ref,test_case_id,active,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (tenant_id,trace_link_id) DO UPDATE SET
           fuzex_project_id=EXCLUDED.fuzex_project_id,target_kind=EXCLUDED.target_kind,target_ref=EXCLUDED.target_ref,
           test_case_id=EXCLUDED.test_case_id,active=EXCLUDED.active,updated_at=now()
         WHERE (fuzequality.design_test_links.fuzex_project_id,fuzequality.design_test_links.target_kind,
           fuzequality.design_test_links.target_ref,fuzequality.design_test_links.test_case_id,
           fuzequality.design_test_links.active) IS DISTINCT FROM
           (EXCLUDED.fuzex_project_id,EXCLUDED.target_kind,EXCLUDED.target_ref,EXCLUDED.test_case_id,EXCLUDED.active)
         RETURNING trace_link_id`,
        [projection.tenantId, projection.traceLinkId, projection.fuzexProjectId, projection.targetKind, projection.targetRef, projection.testCaseId, active],
      )
      const changed = Boolean(result.rowCount)
      if (changed) await client.query(
        'INSERT INTO fuzequality.outbox_events (topic,event_key,payload) VALUES ($1,$2,$3::jsonb)',
        [outbound.topic, outbound.key ?? null, JSON.stringify(outbound.payload)],
      )
      await client.query('COMMIT')
      return changed
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async claimOutboxEvents(limit = 100, leaseMs = 30_000): Promise<OutboxEvent[]> {
    const result = await this.pool.query(
      `WITH candidates AS (
         SELECT id FROM fuzequality.outbox_events
         WHERE published_at IS NULL AND (locked_until IS NULL OR locked_until <= now())
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE fuzequality.outbox_events event
       SET attempts=event.attempts+1, locked_until=now() + ($2 * interval '1 millisecond')
       FROM candidates WHERE event.id=candidates.id
       RETURNING event.id,event.topic,event.event_key,event.payload,event.attempts,event.created_at`,
      [limit, leaseMs],
    )
    return result.rows.map(row => ({
      id: row.id,
      topic: row.topic,
      key: row.event_key ?? undefined,
      payload: row.payload,
      attempts: row.attempts,
      createdAt: row.created_at.toISOString(),
    }))
  }

  async markOutboxPublished(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE fuzequality.outbox_events SET published_at=now(),locked_until=NULL,last_error=NULL WHERE id=$1',
      [id],
    )
  }

  async releaseOutboxEvent(id: string, error: string): Promise<void> {
    await this.pool.query(
      'UPDATE fuzequality.outbox_events SET locked_until=NULL,last_error=$2 WHERE id=$1 AND published_at IS NULL',
      [id, error.slice(0, 2000)],
    )
  }

  async addRepository(input: RepositoryInput, tenantId = 'legacy') {
    const canonicalUrl = `https://github.com/${input.owner}/${input.name}`
    const result = await this.pool.query(
      `INSERT INTO fuzequality.repositories (tenant_id, owner, name, canonical_url, default_branch, kind, installation_id, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, provider, lower(owner), lower(name)) DO UPDATE SET default_branch=EXCLUDED.default_branch, kind=EXCLUDED.kind, installation_id=EXCLUDED.installation_id, config=EXCLUDED.config, updated_at=now()
       RETURNING id`,
      [tenantId, input.owner, input.name, canonicalUrl, input.defaultBranch, input.kind, input.installationId, input]
    )
    return (await this.repository(result.rows[0].id, tenantId))!
  }

  async updateRepositoryAdministration(
    id: string,
    tenantId: string,
    value: Pick<RepositoryInput, 'ownership' | 'jiraBindings' | 'storybookBaseUrl'>
  ) {
    const result = await this.pool.query(
      `UPDATE fuzequality.repositories
       SET config = config || $3::jsonb, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND enabled = true
       RETURNING id`,
      [id, tenantId, JSON.stringify(value)]
    )
    if (!result.rowCount) return undefined
    return this.repository(id, tenantId)
  }

  async setRepositoryStatus(id: string, status: Repository['lastScanStatus']) {
    await this.pool.query('UPDATE fuzequality.repositories SET last_scan_status=$2, updated_at=now() WHERE id=$1', [id, status])
  }


  async setRepositoryAnalysis(id: string, analysis: NonNullable<Repository['lastAnalysis']>) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `WITH current AS (
           SELECT id,last_analysis
           FROM fuzequality.repositories
           WHERE id=$1 AND last_scan_revision=$3
           FOR UPDATE
         ), updated AS (
           UPDATE fuzequality.repositories repository
           SET last_analysis=$2::jsonb,updated_at=now()
           FROM current
           WHERE repository.id=current.id
             AND repository.last_analysis IS DISTINCT FROM $2::jsonb
           RETURNING current.last_analysis
         )
         SELECT last_analysis FROM updated`,
        [id, JSON.stringify(analysis), analysis.revision],
      )
      const previousStatus = result.rows[0]?.last_analysis?.status
      if (result.rowCount && analysis.status === 'complete' && previousStatus !== 'complete') {
        await client.query(
          'INSERT INTO fuzequality.outbox_events (topic,event_key,payload) VALUES ($1,$2,$3::jsonb)',
          [TOPICS.ANALYSIS_COMPLETED, id, JSON.stringify({ repositoryId: id, revision: analysis.revision })],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async queueRepositoryAnalysis(id: string, tenantId: string) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE fuzequality.repositories
         SET last_analysis=jsonb_build_object('revision',last_scan_revision,'status','queued'),updated_at=now()
         WHERE id=$1 AND tenant_id=$2 AND enabled=true AND last_scan_revision IS NOT NULL
           AND last_analysis->>'status'='failed'
         RETURNING last_scan_revision`, [id, tenantId])
      if (!result.rowCount) { await client.query('ROLLBACK'); return undefined }
      const revision = result.rows[0].last_scan_revision
      await client.query('INSERT INTO fuzequality.outbox_events (topic,event_key,payload) VALUES ($1,$2,$3::jsonb)',
        [TOPICS.REPOSITORY_INVENTORY_CHANGED, id, JSON.stringify({ repositoryId: id, revision })])
      await client.query('COMMIT')
      return this.repository(id, tenantId)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async saveScan(result: ScanResult) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const revision = await client.query(`INSERT INTO fuzequality.repository_revisions (repository_id,commit_sha,branch,scanner_version,config_version,status,scanned_at) VALUES ($1,$2,$3,'v1','v1','complete',$4) ON CONFLICT (repository_id,commit_sha,scanner_version,config_version) DO UPDATE SET status='complete',scanned_at=EXCLUDED.scanned_at RETURNING id`, [result.repository.id, result.revision, result.repository.defaultBranch, result.scannedAt])
      if (result.scanDetails.sourceRevision) await client.query(
        `INSERT INTO fuzequality.repository_revision_sources (repository_id,source_revision,catalog_revision,scanned_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (repository_id,source_revision) DO UPDATE SET catalog_revision=EXCLUDED.catalog_revision,scanned_at=EXCLUDED.scanned_at`,
        [result.repository.id, result.scanDetails.sourceRevision, result.revision, result.scannedAt],
      )
      await client.query(`INSERT INTO fuzequality.scan_runs (repository_id,revision_id,trigger,status,counts,finished_at) VALUES ($1,$2,'manual','complete',$3,now())`, [result.repository.id, revision.rows[0].id, JSON.stringify({ operations: result.operations.length, surfaces: result.surfaces.length, tests: result.tests.length, diagnostics: result.diagnostics.length })])
      await client.query(
        `UPDATE fuzequality.test_expectations
         SET active=false, updated_at=now()
         WHERE (subject_type='api-operation' AND subject_id IN (
           SELECT id FROM fuzequality.api_operations WHERE repository_id=$1
         )) OR (subject_type='frontend-surface' AND subject_id IN (
           SELECT id FROM fuzequality.frontend_surfaces WHERE repository_id=$1
         ))`,
        [result.repository.id]
      )
      await client.query('UPDATE fuzequality.api_operations SET active=false WHERE repository_id=$1', [result.repository.id])
      await client.query('UPDATE fuzequality.frontend_surfaces SET active=false WHERE repository_id=$1', [result.repository.id])
      await client.query('UPDATE fuzequality.test_cases SET active=false WHERE repository_id=$1', [result.repository.id])
      for (const item of result.operations) {
        const { id, repositoryId, documentPath, operationId, method, path, summary, tags, security, parameters, responses, ...details } = item
        await client.query(`INSERT INTO fuzequality.api_operations (id,repository_id,document_path,operation_id,method,path,summary,tags,security,parameters,responses,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO UPDATE SET operation_id=EXCLUDED.operation_id,summary=EXCLUDED.summary,tags=EXCLUDED.tags,security=EXCLUDED.security,parameters=EXCLUDED.parameters,responses=EXCLUDED.responses,details=EXCLUDED.details,active=true,updated_at=now()`, [id,repositoryId,documentPath,operationId,method,path,summary,JSON.stringify(tags),security,JSON.stringify(parameters),JSON.stringify(responses),JSON.stringify(details)])
      }
      for (const item of result.surfaces) await client.query(`INSERT INTO fuzequality.frontend_surfaces (id,repository_id,package_name,kind,name,source_path,route_path,is_public,states,has_story,stories) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,source_path=EXCLUDED.source_path,route_path=EXCLUDED.route_path,is_public=EXCLUDED.is_public,states=EXCLUDED.states,has_story=EXCLUDED.has_story,stories=EXCLUDED.stories,active=true,updated_at=now()`, [item.id,item.repositoryId,item.packageName,item.kind,item.name,item.sourcePath,item.routePath,item.public,JSON.stringify(item.states),item.hasStory,JSON.stringify(item.stories)])
      for (const item of result.tests) await client.query(`INSERT INTO fuzequality.test_cases (id,repository_id,framework,test_level,title,source_path,assertion_count,targets) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET framework=EXCLUDED.framework,test_level=EXCLUDED.test_level,title=EXCLUDED.title,source_path=EXCLUDED.source_path,assertion_count=EXCLUDED.assertion_count,targets=EXCLUDED.targets,active=true,updated_at=now()`, [item.id,item.repositoryId,item.framework,item.level,item.title,item.sourcePath,item.assertionCount,JSON.stringify(item.targets)])
      for (const item of result.expectations) await client.query(`INSERT INTO fuzequality.test_expectations (id,subject_type,subject_id,kind,label,priority,rule,coverage,evidence_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label,priority=EXCLUDED.priority,rule=EXCLUDED.rule,coverage=EXCLUDED.coverage,evidence_ids=EXCLUDED.evidence_ids,active=true,updated_at=now()`, [item.id,item.subjectType,item.subjectId,item.kind,item.label,item.priority,item.rule,item.coverage,JSON.stringify(item.evidenceIds)])
      await client.query('DELETE FROM fuzequality.findings WHERE repository_id=$1', [result.repository.id])
      for (const item of result.findings) await client.query(`INSERT INTO fuzequality.findings (id,repository_id,subject_id,type,severity,title,detail,status,owner,remediation,source_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [item.id,item.repositoryId,item.subjectId,item.type,item.severity,item.title,item.detail,item.status,item.owner,item.remediation,result.revision])
      await client.query('DELETE FROM fuzequality.scan_diagnostics WHERE repository_id=$1', [result.repository.id])
      for (const item of result.diagnostics) await client.query(`INSERT INTO fuzequality.scan_diagnostics (repository_id,revision,source_path,category,severity,code,message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [result.repository.id,result.revision,item.sourcePath,item.category,item.severity,item.code,item.message])
      await client.query('DELETE FROM fuzequality.repository_quality_artifacts WHERE repository_id=$1 AND revision=$2', [result.repository.id, result.revision])
      for (const item of result.qualityArtifacts ?? []) await client.query(
        `INSERT INTO fuzequality.repository_quality_artifacts (id,repository_id,revision,kind,title,source_path,summary,evidence,execution_target)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,evidence=EXCLUDED.evidence,execution_target=EXCLUDED.execution_target,discovered_at=now()`,
        [item.id, item.repositoryId, result.revision, item.kind, item.title, item.sourcePath, item.summary, JSON.stringify(item.evidence), item.execution ? JSON.stringify(item.execution) : null],
      )
      await client.query('UPDATE fuzequality.repositories SET last_scan_status=\'complete\',last_scan_at=$2,last_scan_revision=$3,last_scan_details=$4,last_analysis=$5,updated_at=now() WHERE id=$1', [result.repository.id,result.scannedAt,result.revision,JSON.stringify(result.scanDetails),JSON.stringify({ revision: result.revision, status: 'queued' })])
      await client.query('INSERT INTO fuzequality.outbox_events (topic,event_key,payload) VALUES ($1,$2,$3::jsonb)',
        [TOPICS.REPOSITORY_INVENTORY_CHANGED, result.repository.id, JSON.stringify({ repositoryId: result.repository.id, revision: result.revision })])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async syncCursor(sourceType: SyncCursor['sourceType'], sourceKey: string) {
    const result = await this.pool.query(
      'SELECT * FROM fuzequality.sync_cursors WHERE source_type=$1 AND source_key=$2',
      [sourceType, sourceKey],
    )
    const row = result.rows[0]
    if (!row) return undefined
    return {
      sourceType: row.source_type,
      sourceKey: row.source_key,
      cursor: row.cursor ?? undefined,
      lastSuccessAt: row.last_success_at?.toISOString(),
      freshnessStatus: row.freshness_status,
    } as SyncCursor
  }

  async markSyncFailed(sourceType: SyncCursor['sourceType'], sourceKey: string) {
    await this.pool.query(
      `INSERT INTO fuzequality.sync_cursors (source_type,source_key,freshness_status)
       VALUES ($1,$2,'failed')
       ON CONFLICT (source_type,source_key) DO UPDATE SET freshness_status='failed'`,
      [sourceType, sourceKey],
    )
  }

  async saveIntelligence(
    results: Array<{ requirement: Requirement; suggestions: Suggestion[] }>,
    sync?: Pick<SyncCursor, 'sourceType' | 'sourceKey' | 'cursor'> & { tenantId?: string }
  ) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (!sync?.tenantId) throw new Error('Tenant-scoped Jira intelligence is required')
      for (const { requirement, suggestions } of results) {
        const saved = await client.query(`INSERT INTO fuzequality.requirements (tenant_id,jira_key,issue_type,parent_key,summary,normalized_description,project,status,source_updated_at,source_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id,jira_key) WHERE tenant_id IS NOT NULL DO UPDATE SET issue_type=EXCLUDED.issue_type,parent_key=EXCLUDED.parent_key,summary=EXCLUDED.summary,normalized_description=EXCLUDED.normalized_description,project=EXCLUDED.project,status=EXCLUDED.status,source_updated_at=EXCLUDED.source_updated_at,source_payload=EXCLUDED.source_payload,active=true RETURNING id`, [sync.tenantId,requirement.jiraKey,requirement.issueType,requirement.parentKey,requirement.summary,requirement.description,requirement.project,requirement.status,requirement.updatedAt,JSON.stringify(requirement)])
        const requirementId = saved.rows[0].id
        await client.query('UPDATE fuzequality.acceptance_criteria SET active=false WHERE requirement_id=$1', [requirementId])
        for (const criterion of requirement.acceptanceCriteria ?? []) {
          await client.query(
            `INSERT INTO fuzequality.acceptance_criteria (requirement_id,fingerprint,position,normalized_text,active)
             VALUES ($1,$2,$3,$4,true)
             ON CONFLICT (requirement_id,fingerprint) DO UPDATE SET
               position=EXCLUDED.position,normalized_text=EXCLUDED.normalized_text,active=true`,
            [requirementId, criterion.fingerprint, criterion.position, criterion.text],
          )
        }
        for (const suggestion of suggestions) await client.query(`INSERT INTO fuzequality.suggestions (id,requirement_id,type,title,confidence,evidence,payload,state,source_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`, [suggestion.id,requirementId,suggestion.type,suggestion.title,suggestion.confidence,JSON.stringify(suggestion.evidence),JSON.stringify(suggestion.payload),suggestion.state,requirement.updatedAt])
      }
      if (sync) {
        await client.query(
          `INSERT INTO fuzequality.sync_cursors (source_type,source_key,cursor,last_success_at,freshness_status)
           VALUES ($1,$2,$3,now(),'fresh')
           ON CONFLICT (source_type,source_key) DO UPDATE SET
             cursor=EXCLUDED.cursor,last_success_at=EXCLUDED.last_success_at,freshness_status='fresh'`,
          [sync.sourceType, sync.sourceKey, sync.cursor],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async rebuildCoverage() {
    const portfolio = await this.portfolio()
    const evaluationRows = await this.pool.query('SELECT * FROM fuzequality.policy_gate_evaluations')
    const evaluations = evaluationRows.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, tenantId: row.tenant_id, revision: row.revision, kind: row.kind, severity: row.severity, title: row.title, detail: row.detail, policyArtifactIds: row.policy_artifact_ids, gateArtifactIds: row.gate_artifact_ids, confidence: Number(row.confidence), scope: row.scope, evidencePassages: row.evidence_passages ?? [], remediationAction: row.remediation_action, recommendation: row.recommendation, reviewStatus: row.review_status, reviewedAt: row.reviewed_at?.toISOString(), reviewedBy: row.reviewed_by ?? undefined, reviewReason: row.review_reason ?? undefined, createdAt: row.created_at.toISOString() }))
    const projection = buildQualityIntelligenceProjection(portfolio, { policyGateEvaluations: evaluations })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM fuzequality.findings WHERE policy_version = ANY($1::text[])', [[FLOW_COVERAGE_POLICY_VERSION, REQUIREMENT_REVIEW_POLICY_VERSION, 'quality-intelligence-v1']])
      for (const item of projection.findings) {
        await client.query(
          `INSERT INTO fuzequality.findings
           (id,repository_id,subject_id,type,severity,title,detail,status,source_revision,policy_version,schema_version,evidence_strength,evidence,confidence,source_passages,affected_flow_ids,affected_target_ids,remediation_options,generated_at,audit_history)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [item.id,item.repositoryId,item.subjectId,item.type,item.severity,item.title,item.detail,item.status,item.sourceRevision,item.policyVersion,item.schemaVersion,item.evidenceStrength,JSON.stringify(item.evidence ?? []),item.confidence,JSON.stringify(item.sourcePassages ?? []),JSON.stringify(item.affectedFlowIds ?? []),JSON.stringify(item.affectedTargetIds ?? []),JSON.stringify(item.remediationOptions ?? []),item.generatedAt,JSON.stringify(item.auditHistory ?? [])],
        )
      }
      await client.query(
        `INSERT INTO fuzequality.coverage_snapshots (scope,revision_set,policy_version,totals)
         VALUES ('flows',$1,$2,$3)`,
        [JSON.stringify(portfolio.requirements.map(item => ({ requirementId: item.id, revision: item.updatedAt }))), projection.policyVersion, JSON.stringify(projection.metrics)],
      )
      await client.query('COMMIT')
      return projection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async reviewSuggestion(id: string, input: Omit<SuggestionDecision, 'id' | 'suggestionId' | 'originalPayload' | 'decidedAt'>) {
    const state = input.action === 'confirm' || input.action === 'merge' ? 'confirmed' : input.action === 'suppress' ? 'suppressed' : input.action === 'reject' ? 'rejected' : 'proposed'
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const original = await client.query(`SELECT s.* FROM fuzequality.suggestions s JOIN fuzequality.requirements r ON r.id=s.requirement_id WHERE s.id=$1 AND s.state='proposed' AND r.tenant_id=$2 FOR UPDATE`, [id, input.tenantId])
      const originalRow = original.rows[0]
      if (!originalRow) { await client.query('ROLLBACK'); return undefined }
      const result = await client.query('UPDATE fuzequality.suggestions SET state=$2, payload=COALESCE($3,payload) WHERE id=$1 RETURNING *', [id, state, input.editedPayload ? JSON.stringify(input.editedPayload) : null])
      const row = result.rows[0]
      await client.query(
        `INSERT INTO fuzequality.review_decisions
         (id,suggestion_id,actor,tenant_id,decision,original_payload,edited_payload,reason,owner,expires_at,target_suggestion_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [randomUUID(), id, input.actorId, input.tenantId, input.action, JSON.stringify(originalRow.payload), input.editedPayload ? JSON.stringify(input.editedPayload) : null, input.reason ?? null, input.owner ?? null, input.expiresAt ?? null, input.targetSuggestionId ?? null],
      )
      if (row && (input.action === 'confirm' || input.action === 'merge') && row.type === 'flow') {
        const flow = (input.editedPayload ?? row.payload) as Flow
        await client.query(
          `INSERT INTO fuzequality.flows (id,requirement_id,title,owner,origin,status,confirmed_revision,details)
           VALUES ($1,$2,$3,$4,'confirmed','confirmed',1,$5)
           ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,owner=EXCLUDED.owner,origin='confirmed',status='confirmed',details=EXCLUDED.details,confirmed_revision=fuzequality.flows.confirmed_revision+1,updated_at=now()`,
          [flow.id, row.requirement_id, flow.title, flow.owner, JSON.stringify({ actors: flow.actors, preconditions: flow.preconditions, trigger: flow.trigger, authorizationBoundaries: flow.authorizationBoundaries, tenantBoundaries: flow.tenantBoundaries })],
        )
        await client.query('DELETE FROM fuzequality.flow_steps WHERE flow_id=$1', [flow.id])
        for (const step of flow.steps) {
          await client.query(
            `INSERT INTO fuzequality.flow_steps (id,flow_id,position,actor,action,expected_outcome,variant,target_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [step.id,flow.id,step.position,step.actor,step.action,step.expectedOutcome,step.variant,JSON.stringify(step.targetIds)],
          )
        }
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return (await this.portfolio(input.tenantId)).suggestions.find(item => item.id === id)
  }

  async approveExpectedTest(id: string, input: Omit<SuggestionDecision, 'id' | 'suggestionId' | 'originalPayload' | 'decidedAt'>) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const source = await client.query(`SELECT s.*, r.tenant_id FROM fuzequality.suggestions s JOIN fuzequality.requirements r ON r.id=s.requirement_id WHERE s.id=$1 AND s.type='expected-test' AND s.state='proposed' AND r.tenant_id=$2 FOR UPDATE`, [id, input.tenantId])
      const row = source.rows[0]
      if (!row) { await client.query('ROLLBACK'); return undefined }
      const expectationId = `expectation:ai:${id}`
      await client.query(`INSERT INTO fuzequality.test_expectations (id,subject_type,subject_id,kind,label,priority,rule,coverage,evidence_ids) VALUES ($1,'flow-step',$2,'ai-approved',$3,$4,$5,'gap','[]') ON CONFLICT (id) DO NOTHING`, [expectationId, `requirement:${row.requirement_id}`, row.title, row.payload?.priority === 'required' ? 'required' : 'recommended', `ai-reviewed:${id}`])
      await client.query(`UPDATE fuzequality.suggestions SET state='confirmed' WHERE id=$1`, [id])
      await client.query(`INSERT INTO fuzequality.review_decisions (suggestion_id,actor,tenant_id,decision,original_payload) VALUES ($1,$2,$3,'confirm',$4)`, [id, input.actorId, input.tenantId, JSON.stringify(row.payload)])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    return (await this.portfolio(input.tenantId)).suggestions.find(item => item.id === id)
  }

  async excludeExpectation(id: string, tenantId: string, input: ExpectationExclusionInput) {
    const visible = (await this.portfolio(tenantId)).expectations.some(item => item.id === id)
    if (!visible) return false
    await this.pool.query(
      `INSERT INTO fuzequality.expectation_exclusions (expectation_id,tenant_id,owner,reason,expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (expectation_id,tenant_id) WHERE revoked_at IS NULL
       DO UPDATE SET owner=EXCLUDED.owner, reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at`,
      [id, tenantId, input.owner, input.reason, input.expiresAt],
    )
    return true
  }

  async suggestionDecisions(id: string, tenantId: string): Promise<SuggestionDecision[]> {
    const result = await this.pool.query(`SELECT d.* FROM fuzequality.review_decisions d JOIN fuzequality.suggestions s ON s.id=d.suggestion_id JOIN fuzequality.requirements r ON r.id=s.requirement_id WHERE d.suggestion_id=$1 AND r.tenant_id=$2 AND d.tenant_id=$2 ORDER BY d.decided_at DESC`, [id, tenantId])
    return result.rows.map(row => ({ id: row.id, suggestionId: row.suggestion_id, actorId: row.actor, tenantId: row.tenant_id, action: row.decision, originalPayload: row.original_payload, editedPayload: row.edited_payload ?? undefined, reason: row.reason ?? undefined, owner: row.owner ?? undefined, expiresAt: row.expires_at?.toISOString(), targetSuggestionId: row.target_suggestion_id ?? undefined, decidedAt: row.decided_at.toISOString() }))
  }

  async createTestImplementation(request: TestImplementationRequest, idempotencyKey: string) {
    const result = await this.pool.query(
      `INSERT INTO fuzequality.test_implementation_requests
       (id,tenant_id,repository_id,source_revision,expectation_ids,idempotency_key,agent_profile,skills,status,requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id,idempotency_key) DO UPDATE SET updated_at=fuzequality.test_implementation_requests.updated_at
       RETURNING *`,
      [request.id, request.tenantId, request.repositoryId, request.sourceRevision, JSON.stringify(request.expectationIds), idempotencyKey, request.agentProfile, JSON.stringify(request.skills), request.status, request.requestedBy],
    )
    return this.mapTestImplementation(result.rows[0])
  }

  async testImplementation(id: string, tenantId: string) {
    const result = await this.pool.query(
      'SELECT * FROM fuzequality.test_implementation_requests WHERE id=$1 AND tenant_id=$2',
      [id, tenantId],
    )
    return result.rows[0] ? this.mapTestImplementation(result.rows[0]) : undefined
  }

  async updateTestImplementation(id: string, value: Partial<Pick<TestImplementationRequest, 'status' | 'workflowUrl' | 'pullRequestUrl' | 'error'>>) {
    await this.pool.query(
      `UPDATE fuzequality.test_implementation_requests
       SET status=COALESCE($2,status), workflow_url=COALESCE($3,workflow_url),
           pull_request_url=COALESCE($4,pull_request_url), error=COALESCE($5,error), updated_at=now()
       WHERE id=$1`,
      [id, value.status, value.workflowUrl, value.pullRequestUrl, value.error],
    )
  }

  async recordAdminContext(input: Omit<AdminContextAudit, 'id' | 'createdAt'>): Promise<AdminContextAudit> {
    const id = randomUUID()
    const result = await this.pool.query(
      `INSERT INTO fuzequality.admin_context_audits
       (id, actor_id, source_tenant_id, target_tenant_id, reason, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING created_at`,
      [id, input.actorId, input.sourceTenantId, input.targetTenantId, input.reason, input.correlationId]
    )
    return { ...input, id, createdAt: result.rows[0].created_at.toISOString() }
  }

  private mapTestImplementation(row: Record<string, any>): TestImplementationRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      repositoryId: row.repository_id,
      sourceRevision: row.source_revision,
      expectationIds: row.expectation_ids,
      agentProfile: row.agent_profile,
      skills: row.skills,
      status: row.status,
      requestedBy: row.requested_by,
      workflowUrl: row.workflow_url ?? undefined,
      pullRequestUrl: row.pull_request_url ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }
}

export function createCatalogStore() {
  return process.env.DATABASE_URL
    ? new PostgresCatalogStore(process.env.DATABASE_URL)
    : new MemoryCatalogStore(process.env.FUZEQUALITY_DEMO === 'false' ? undefined : demoPortfolio())
}

export function demoPortfolio(): Partial<Portfolio> {
  const repositoryId = 'b4908e35-8a57-4c13-9366-489ec59071fe'
  const operations = [
    {
      id: 'api:FuzeFront:auth:requestPasswordReset',
      repositoryId,
      documentPath: 'packages/auth/openapi.yaml',
      operationId: 'requestPasswordReset',
      method: 'post',
      path: '/auth/password-reset/request',
      summary: 'Request a password reset email',
      tags: ['Identity'],
      security: false,
      parameters: [],
      responses: ['202', '429'],
    },
    {
      id: 'api:FuzeFront:billing:createSubscription',
      repositoryId,
      documentPath: 'services/billing-service/openapi.yaml',
      operationId: 'createSubscription',
      method: 'post',
      path: '/billing/subscriptions',
      summary: 'Create a subscription for the active organization',
      tags: ['Billing'],
      security: true,
      parameters: [{ name: 'organizationId', location: 'header', required: true }],
      responses: ['201', '401', '403', '409'],
    },
  ] satisfies Portfolio['operations']
  const surfaces = [
    {
      id: 'ui:FuzeFront:frontend:route:/settings/billing',
      repositoryId,
      packageName: '@fuzefront/frontend',
      kind: 'route',
      name: '/settings/billing',
      sourcePath: 'frontend/src/App.tsx',
      routePath: '/settings/billing',
      public: true,
      states: ['default', 'loading', 'error'],
      hasStory: false,
      stories: [],
    },
    {
      id: 'ui:FuzeFront:billing-ui:component:PlanPicker',
      repositoryId,
      packageName: '@fuzefront/billing-ui',
      kind: 'component',
      name: 'PlanPicker',
      sourcePath: 'packages/billing-ui/src/PlanPicker.tsx',
      public: true,
      states: ['default', 'loading', 'error', 'empty'],
      hasStory: false,
      stories: [],
    },
  ] satisfies Portfolio['surfaces']
  const tests = [
    {
      id: 'test:FuzeFront:billing:create-subscription',
      repositoryId,
      framework: 'jest',
      level: 'integration',
      title: 'createSubscription rejects unauthenticated requests',
      sourcePath: 'services/billing-service/tests/routes/checkout.test.ts',
      assertionCount: 4,
      targets: ['createSubscription', '/billing/subscriptions'],
    },
    {
      id: 'test:FuzeFront:billing-ui:plan-picker',
      repositoryId,
      framework: 'vitest',
      level: 'unit',
      title: 'PlanPicker renders available plans',
      sourcePath: 'packages/billing-ui/tests/PlanPicker.test.tsx',
      assertionCount: 3,
      targets: ['PlanPicker'],
    },
  ] satisfies Portfolio['tests']
  const expectations = [
    ...operations.flatMap(operation => buildApiExpectations(operation, tests)),
    ...surfaces.flatMap(surface => buildFrontendExpectations(surface, tests)),
  ]
  return {
    repositories: [
      {
        id: repositoryId,
        owner: 'izzywdev',
        name: 'FuzeFront',
        canonicalUrl: 'https://github.com/izzywdev/FuzeFront',
        defaultBranch: 'master',
        kind: 'mixed',
        enabled: true,
        includeGlobs: [],
        excludeGlobs: [],
        jiraProjects: ['FUZE'],
        jiraBindings: [],
        lastScanStatus: 'complete',
        lastScanAt: new Date().toISOString(),
      },
    ],
    operations,
    surfaces,
    tests,
    expectations,
    findings: buildFindings(repositoryId, operations, surfaces, expectations),
    diagnostics: [],
    requirements: [
      {
        id: 'req-fuze-142',
        jiraKey: 'FUZE-142',
        issueType: 'Story',
        summary: 'Reset an expired password securely',
        description: 'An anonymous user can request a reset and is protected from expired token reuse.',
        status: 'In Progress',
        project: 'FUZE',
        updatedAt: new Date().toISOString(),
      },
    ],
    suggestions: [
      {
        id: 'suggestion-reset-flow',
        requirementId: 'req-fuze-142',
        type: 'flow',
        title: 'Password reset contains an undocumented expired-token path',
        confidence: 0.91,
        evidence: ['“protected from expired token reuse”', 'POST /auth/reset-password'],
        state: 'proposed',
        createdAt: new Date().toISOString(),
        payload: {
          id: 'flow-password-reset',
          requirementId: 'req-fuze-142',
          title: 'Password reset',
          origin: 'inferred',
          status: 'proposed',
          steps: [],
        },
      },
    ],
  }
}
