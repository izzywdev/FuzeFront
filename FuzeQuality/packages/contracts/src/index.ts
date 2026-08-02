import { z } from 'zod'

export const repositoryKindSchema = z.enum([
  'application',
  'service',
  'library',
  'infrastructure',
  'mixed',
])

export const repositoryInputSchema = z.object({
  owner: z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  name: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  defaultBranch: z.string().trim().min(1).max(255).default('main'),
  kind: repositoryKindSchema.default('mixed'),
  installationId: z.string().regex(/^\d+$/).optional(),
  localPath: z.string().optional(),
  includeGlobs: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  excludeGlobs: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  jiraProjects: z.array(z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/)).max(50).default([]),
  jiraBindings: z.array(z.object({
    project: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/),
    component: z.string().trim().min(1).max(255).optional(),
  })).max(100).default([]),
  ownership: z.object({
    team: z.string().trim().min(1).max(100),
    contact: z.string().trim().email().optional(),
  }).optional(),
  storybookBaseUrl: z.string().trim().url().refine(
    value => new URL(value).protocol === 'https:',
    'Storybook base URL must use HTTPS'
  ).optional(),
}).superRefine((value, context) => {
  for (const glob of [...value.includeGlobs, ...value.excludeGlobs]) {
    if (glob.includes('..') || glob.includes('://') || /[\r\n]/.test(glob)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Globs cannot contain traversal, URLs, or line breaks' })
    }
  }
})

export type RepositoryInput = z.infer<typeof repositoryInputSchema>

export type Repository = RepositoryInput & {
  id: string
  tenantId?: string
  canonicalUrl: string
  enabled: boolean
  lastScanAt?: string
  lastScanRevision?: string
  lastScanStatus: 'never' | 'queued' | 'running' | 'complete' | 'failed'
  lastScanDetails?: RepositoryScanDetails
}

export type RepositoryScanCandidate = {
  sourcePath: string
  kind: 'openapi-document' | 'openapi-config' | 'test' | 'storybook' | 'package'
  status: 'discovered' | 'parsed' | 'partial' | 'invalid'
  diagnosticCodes: string[]
}

export type RepositoryScanDetails = {
  sourceRevision?: string
  catalogRevision: string
  scannerVersion: string
  configVersion: string
  partial: boolean
  candidates: RepositoryScanCandidate[]
  counts: {
    candidates: number
    operations: number
    frontendSurfaces: number
    tests: number
    diagnostics: number
  }
}

export type CoverageState =
  | 'covered-explicit'
  | 'covered-generated'
  | 'likely-covered'
  | 'gap'
  | 'excluded'
  | 'unknown'

export type ExpectationPriority = 'required' | 'recommended' | 'not-applicable'

export type ApiOperation = {
  id: string
  repositoryId: string
  documentPath: string
  specificationVersion?: string
  documentTitle?: string
  documentVersion?: string
  sourcePaths?: string[]
  servers?: string[]
  operationId?: string
  method: string
  path: string
  summary: string
  tags: string[]
  security: boolean
  securitySchemes?: string[]
  parameters: Array<{
    name: string
    location: string
    required: boolean
    schema?: Record<string, unknown>
  }>
  responses: string[]
  requestContentTypes?: string[]
  requestBodyRequired?: boolean
  responseContentTypes?: string[]
  idempotencyHeader?: string
  supportsCrudSequence?: boolean
}

export type FrontendSurface = {
  id: string
  repositoryId: string
  packageName: string
  kind: 'route' | 'page' | 'component'
  name: string
  sourcePath: string
  routePath?: string
  public: boolean
  states: string[]
  hasStory: boolean
  stories: StorybookStory[]
}

export type StorybookStory = {
  id: string
  title: string
  name: string
  exportName: string
  sourcePath: string
  hasPlay: boolean
  previewPath: string
}

export type TestCase = {
  id: string
  repositoryId: string
  framework: string
  level: 'unit' | 'integration' | 'contract' | 'e2e' | 'unknown'
  title: string
  sourcePath: string
  assertionCount: number
  targets: string[]
  explicitTargets?: string[]
  operationIds?: string[]
  routes?: Array<{ method?: string; path: string }>
}

export type TestExpectation = {
  id: string
  subjectType: 'api-operation' | 'frontend-surface' | 'flow-step'
  subjectId: string
  kind: string
  label: string
  priority: ExpectationPriority
  rule: string
  coverage: CoverageState
  evidenceIds: string[]
}

export type CatalogFinding = {
  id: string
  repositoryId?: string
  subjectId?: string
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  detail: string
  owner?: string
  remediation?: string
  sourceRevision?: string
  status: 'open' | 'resolved' | 'suppressed'
}

export type ApiCoverageQuery = {
  repositoryId?: string
  tag?: string
  path?: string
  coverage?: CoverageState
  findingType?: string
}

export type ApiCoverageRow = ApiOperation & {
  repositoryName: string
  expectations: TestExpectation[]
  findings: CatalogFinding[]
  coverageSummary: {
    total: number
    covered: number
    gaps: number
    percent: number
  }
}

export type ApiCoverageResponse = {
  rows: ApiCoverageRow[]
  totals: {
    operations: number
    expectations: number
    covered: number
    gaps: number
    findings: number
    percent: number
  }
  filters: {
    repositories: Array<{ id: string; name: string }>
    tags: string[]
    coverageStates: CoverageState[]
    findingTypes: string[]
  }
  revisionSet: Array<{ repositoryId: string; revision?: string; scannedAt?: string }>
  policyVersion: string
  generatedAt: string
}

export type Requirement = {
  id: string
  jiraKey: string
  issueType: 'Epic' | 'Story' | 'Task'
  parentKey?: string
  summary: string
  description: string
  status: string
  project: string
  updatedAt: string
}

export type FlowStep = {
  id: string
  position: number
  actor: string
  action: string
  expectedOutcome: string
  variant: 'main' | 'alternate' | 'error'
  targetIds: string[]
}

export type Flow = {
  id: string
  requirementId: string
  title: string
  owner?: string
  origin: 'confirmed' | 'inferred'
  status: 'proposed' | 'confirmed' | 'rejected'
  steps: FlowStep[]
}

export type Suggestion = {
  id: string
  requirementId: string
  type: 'flow' | 'mapping' | 'expected-test' | 'missing-criteria'
  title: string
  confidence: number
  evidence: string[]
  payload: Record<string, unknown>
  state: 'proposed' | 'confirmed' | 'rejected'
  createdAt: string
}

export type ScanDiagnostic = {
  sourcePath: string
  category: 'openapi' | 'test' | 'frontend' | 'storybook'
  severity: 'error' | 'warning'
  code: string
  message: string
}

export type CatalogScanDiagnostic = ScanDiagnostic & {
  repositoryId: string
  revision: string
}

export type ScanResult = {
  repository: Repository
  revision: string
  operations: ApiOperation[]
  surfaces: FrontendSurface[]
  tests: TestCase[]
  expectations: TestExpectation[]
  findings: CatalogFinding[]
  diagnostics: ScanDiagnostic[]
  scanDetails: RepositoryScanDetails
  scannedAt: string
}

export type Portfolio = {
  repositories: Repository[]
  operations: ApiOperation[]
  surfaces: FrontendSurface[]
  tests: TestCase[]
  expectations: TestExpectation[]
  findings: CatalogFinding[]
  diagnostics: CatalogScanDiagnostic[]
  requirements: Requirement[]
  flows: Flow[]
  suggestions: Suggestion[]
}

export type OrganizationQualitySummary = {
  organizationId: string
  repositories: number
  apiOperations: number
  frontendSurfaces: number
  tests: number
  expectations: number
  coveredExpectations: number
  gaps: number
  openFindings: number
  failedScans: number
  staleScans: number
  coveragePercent: number
  latestScanAt?: string
}

export type AdminTenantContext = {
  organizationId: string
  mode: 'read-only'
  auditId: string
  enteredAt: string
  portfolio: Portfolio
}

export type AdminContextAudit = {
  id: string
  actorId: string
  sourceTenantId: string
  targetTenantId: string
  reason: string
  correlationId?: string
  createdAt: string
}

export const testImplementationRequestSchema = z.object({
  repositoryId: z.string().uuid(),
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/i),
  expectationIds: z.array(z.string().min(1).max(500)).min(1).max(50),
}).strict()

export type TestImplementationInput = z.infer<typeof testImplementationRequestSchema>

export type TestImplementationStatus = 'queued' | 'running' | 'pr-ready' | 'failed'

export type TestImplementationRequest = {
  id: string
  tenantId: string
  repositoryId: string
  sourceRevision: string
  expectationIds: string[]
  agentProfile: 'test-engineer' | 'frontend-test-engineer'
  skills: string[]
  status: TestImplementationStatus
  requestedBy: string
  workflowUrl?: string
  pullRequestUrl?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export const eventEnvelopeSchema = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    version: z.literal('1.0'),
    topic: z.string(),
    correlationId: z.string().uuid(),
    occurredAt: z.string().datetime(),
    payload,
  })

export const scanRequestedSchema = z.object({
  repositoryId: z.string().uuid(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i, 'An immutable 40-character commit SHA is required'),
  trigger: z.enum(['manual', 'push', 'reconcile']),
})

export const requirementSyncRequestedSchema = z.object({
  scopeId: z.string(),
  jql: z.string(),
  since: z.string().datetime().optional(),
})

export const reviewDecisionSchema = z.object({
  decision: z.enum(['confirm', 'reject']),
  reason: z.string().max(2000).optional(),
  editedPayload: z.record(z.unknown()).optional(),
})

export const TOPICS = {
  REPOSITORY_SCAN_REQUESTED: 'fuzequality.repository.scan.requested',
  REPOSITORY_INVENTORY_CHANGED: 'fuzequality.repository.inventory.changed',
  REQUIREMENT_SYNC_REQUESTED: 'fuzequality.requirement.sync.requested',
  REQUIREMENT_CHANGED: 'fuzequality.requirement.changed',
  ANALYSIS_REQUESTED: 'fuzequality.analysis.requested',
  ANALYSIS_COMPLETED: 'fuzequality.analysis.completed',
  MAPPING_REVIEWED: 'fuzequality.mapping.reviewed',
  COVERAGE_REBUILD_REQUESTED: 'fuzequality.coverage.rebuild.requested',
  COVERAGE_SNAPSHOT_READY: 'fuzequality.coverage.snapshot.ready',
} as const
