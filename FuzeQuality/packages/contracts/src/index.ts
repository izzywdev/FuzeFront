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
  operationId?: string
  method: string
  path: string
  summary: string
  tags: string[]
  security: boolean
  parameters: Array<{
    name: string
    location: string
    required: boolean
    schema?: Record<string, unknown>
  }>
  responses: string[]
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
  status: 'open' | 'resolved' | 'suppressed'
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
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i, 'An immutable 40-character commit SHA is required').optional(),
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
