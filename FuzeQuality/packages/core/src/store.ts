import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type {
  Flow,
  Portfolio,
  Repository,
  RepositoryInput,
  ScanResult,
  Suggestion,
  Requirement,
} from '@fuzequality/contracts'
import { buildApiExpectations, buildFindings, buildFrontendExpectations } from './coverage'

export interface CatalogStore {
  portfolio(tenantId?: string): Promise<Portfolio>
  repository(id: string, tenantId?: string): Promise<Repository | undefined>
  addRepository(input: RepositoryInput, tenantId?: string): Promise<Repository>
  setRepositoryStatus(id: string, status: Repository['lastScanStatus']): Promise<void>
  saveScan(result: ScanResult): Promise<void>
  saveIntelligence(results: Array<{ requirement: Requirement; suggestions: Suggestion[] }>): Promise<void>
  decideSuggestion(id: string, decision: 'confirm' | 'reject'): Promise<Suggestion | undefined>
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

export class MemoryCatalogStore implements CatalogStore {
  private data = emptyPortfolio()

  constructor(seed?: Partial<Portfolio>) {
    this.data = { ...this.data, ...seed }
  }

  async portfolio(tenantId?: string) {
    const result = structuredClone(this.data)
    if (!tenantId) return result
    const repositories = result.repositories.filter(repository => repository.tenantId === tenantId)
    const repositoryIds = new Set(repositories.map(repository => repository.id))
    const operations = result.operations.filter(item => repositoryIds.has(item.repositoryId))
    const surfaces = result.surfaces.filter(item => repositoryIds.has(item.repositoryId))
    const subjectIds = new Set([...operations.map(item => item.id), ...surfaces.map(item => item.id)])
    return {
      ...result,
      repositories,
      operations,
      surfaces,
      tests: result.tests.filter(item => repositoryIds.has(item.repositoryId)),
      expectations: result.expectations.filter(item => subjectIds.has(item.subjectId)),
      findings: result.findings.filter(item => !item.repositoryId || repositoryIds.has(item.repositoryId)),
      diagnostics: result.diagnostics.filter(item => repositoryIds.has(item.repositoryId)),
    }
  }

  async repository(id: string, tenantId?: string) {
    return this.data.repositories.find(repository => repository.id === id && (!tenantId || repository.tenantId === tenantId))
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

  async setRepositoryStatus(id: string, status: Repository['lastScanStatus']) {
    const repository = this.data.repositories.find(item => item.id === id)
    if (repository) repository.lastScanStatus = status
  }

  async saveScan(result: ScanResult) {
    const repository = this.data.repositories.find(item => item.id === result.repository.id)
    if (repository) {
      Object.assign(repository, result.repository, {
        lastScanAt: result.scannedAt,
        lastScanRevision: result.revision,
        lastScanStatus: 'complete',
      })
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
  }

  async decideSuggestion(id: string, decision: 'confirm' | 'reject') {
    const suggestion = this.data.suggestions.find(item => item.id === id)
    if (!suggestion) return undefined
    suggestion.state = decision === 'confirm' ? 'confirmed' : 'rejected'
    if (decision === 'confirm' && suggestion.type === 'flow') {
      const flow = suggestion.payload as unknown as Flow
      this.data.flows.push({ ...flow, status: 'confirmed', origin: 'confirmed' })
    }
    return suggestion
  }

  async saveIntelligence(results: Array<{ requirement: Requirement; suggestions: Suggestion[] }>) {
    for (const result of results) {
      const existing = this.data.requirements.find(item => item.jiraKey === result.requirement.jiraKey)
      if (existing) Object.assign(existing, result.requirement)
      else this.data.requirements.push(result.requirement)
      this.data.suggestions = [
        ...this.data.suggestions.filter(item => item.requirementId !== result.requirement.id || item.state !== 'proposed'),
        ...result.suggestions,
      ]
    }
  }
}

export class PostgresCatalogStore implements CatalogStore {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }

  async portfolio(tenantId?: string): Promise<Portfolio> {
    const [repositories, operations, surfaces, tests, expectations, findings, diagnostics, requirements, flows, steps, suggestions] = await Promise.all([
      this.pool.query('SELECT * FROM fuzequality.repositories WHERE enabled = true ORDER BY name'),
      this.pool.query('SELECT * FROM fuzequality.api_operations WHERE active = true ORDER BY path, method'),
      this.pool.query('SELECT * FROM fuzequality.frontend_surfaces WHERE active = true ORDER BY package_name, name'),
      this.pool.query('SELECT * FROM fuzequality.test_cases WHERE active = true ORDER BY source_path, title'),
      this.pool.query('SELECT * FROM fuzequality.test_expectations WHERE active = true ORDER BY subject_id, kind'),
      this.pool.query('SELECT * FROM fuzequality.findings ORDER BY severity, title'),
      this.pool.query('SELECT * FROM fuzequality.scan_diagnostics ORDER BY source_path, code'),
      this.pool.query('SELECT * FROM fuzequality.requirements WHERE active = true ORDER BY jira_key'),
      this.pool.query('SELECT * FROM fuzequality.flows WHERE status <> \'rejected\' ORDER BY updated_at DESC'),
      this.pool.query('SELECT * FROM fuzequality.flow_steps ORDER BY flow_id, position'),
      this.pool.query('SELECT * FROM fuzequality.suggestions ORDER BY created_at DESC'),
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
        lastScanAt: row.last_scan_at?.toISOString(),
        lastScanRevision: row.last_scan_revision ?? undefined,
        lastScanStatus: row.last_scan_status,
      })),
      operations: operations.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, documentPath: row.document_path, operationId: row.operation_id ?? undefined, method: row.method, path: row.path, summary: row.summary, tags: row.tags, security: row.security, parameters: row.parameters, responses: row.responses })),
      surfaces: surfaces.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, packageName: row.package_name, kind: row.kind, name: row.name, sourcePath: row.source_path, routePath: row.route_path ?? undefined, public: row.is_public, states: row.states, hasStory: row.has_story })),
      tests: tests.rows.map(row => ({ id: row.id, repositoryId: row.repository_id, framework: row.framework, level: row.test_level, title: row.title, sourcePath: row.source_path, assertionCount: row.assertion_count, targets: row.targets })),
      expectations: expectations.rows.map(row => ({ id: row.id, subjectType: row.subject_type, subjectId: row.subject_id, kind: row.kind, label: row.label, priority: row.priority, rule: row.rule, coverage: row.coverage, evidenceIds: row.evidence_ids })),
      findings: findings.rows.map(row => ({ id: row.id, repositoryId: row.repository_id ?? undefined, subjectId: row.subject_id ?? undefined, type: row.type, severity: row.severity, title: row.title, detail: row.detail, owner: row.owner ?? undefined, remediation: row.remediation ?? undefined, sourceRevision: row.source_revision ?? undefined, status: row.status })),
      diagnostics: diagnostics.rows.map(row => ({ repositoryId: row.repository_id, revision: row.revision, sourcePath: row.source_path, category: row.category, severity: row.severity, code: row.code, message: row.message })),
      requirements: requirements.rows.map(row => ({ id: row.id, jiraKey: row.jira_key, issueType: row.issue_type, parentKey: row.parent_key ?? undefined, summary: row.summary, description: row.normalized_description, status: row.status, project: row.project, updatedAt: row.source_updated_at.toISOString() })),
      flows: flows.rows.map(row => ({ id: row.id, requirementId: row.requirement_id, title: row.title, owner: row.owner ?? undefined, origin: row.origin, status: row.status, steps: steps.rows.filter(step => step.flow_id === row.id).map(step => ({ id: step.id, position: step.position, actor: step.actor, action: step.action, expectedOutcome: step.expected_outcome, variant: step.variant, targetIds: step.target_ids })) })),
      suggestions: suggestions.rows.map(row => ({ id: row.id, requirementId: row.requirement_id, type: row.type, title: row.title, confidence: Number(row.confidence), evidence: row.evidence, payload: row.payload, state: row.state, createdAt: row.created_at.toISOString() })),
    } as Portfolio
    const repositoryIds = new Set(result.repositories.map(repository => repository.id))
    if (!tenantId) return result
    result.operations = result.operations.filter(item => repositoryIds.has(item.repositoryId))
    result.surfaces = result.surfaces.filter(item => repositoryIds.has(item.repositoryId))
    result.tests = result.tests.filter(item => repositoryIds.has(item.repositoryId))
    const subjectIds = new Set([...result.operations.map(item => item.id), ...result.surfaces.map(item => item.id)])
    result.expectations = result.expectations.filter(item => subjectIds.has(item.subjectId))
    result.findings = result.findings.filter(item => !item.repositoryId || repositoryIds.has(item.repositoryId))
    result.diagnostics = result.diagnostics.filter(item => repositoryIds.has(item.repositoryId))
    return result
  }

  async repository(id: string, tenantId?: string) {
    return (await this.portfolio(tenantId)).repositories.find(item => item.id === id)
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

  async setRepositoryStatus(id: string, status: Repository['lastScanStatus']) {
    await this.pool.query('UPDATE fuzequality.repositories SET last_scan_status=$2, updated_at=now() WHERE id=$1', [id, status])
  }

  async saveScan(result: ScanResult) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE fuzequality.api_operations SET active=false WHERE repository_id=$1', [result.repository.id])
      await client.query('UPDATE fuzequality.frontend_surfaces SET active=false WHERE repository_id=$1', [result.repository.id])
      await client.query('UPDATE fuzequality.test_cases SET active=false WHERE repository_id=$1', [result.repository.id])
      for (const item of result.operations) await client.query(`INSERT INTO fuzequality.api_operations (id,repository_id,document_path,operation_id,method,path,summary,tags,security,parameters,responses) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET operation_id=EXCLUDED.operation_id,summary=EXCLUDED.summary,tags=EXCLUDED.tags,security=EXCLUDED.security,parameters=EXCLUDED.parameters,responses=EXCLUDED.responses,active=true,updated_at=now()`, [item.id,item.repositoryId,item.documentPath,item.operationId,item.method,item.path,item.summary,JSON.stringify(item.tags),item.security,JSON.stringify(item.parameters),JSON.stringify(item.responses)])
      for (const item of result.surfaces) await client.query(`INSERT INTO fuzequality.frontend_surfaces (id,repository_id,package_name,kind,name,source_path,route_path,is_public,states,has_story) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,source_path=EXCLUDED.source_path,route_path=EXCLUDED.route_path,is_public=EXCLUDED.is_public,states=EXCLUDED.states,has_story=EXCLUDED.has_story,active=true,updated_at=now()`, [item.id,item.repositoryId,item.packageName,item.kind,item.name,item.sourcePath,item.routePath,item.public,JSON.stringify(item.states),item.hasStory])
      for (const item of result.tests) await client.query(`INSERT INTO fuzequality.test_cases (id,repository_id,framework,test_level,title,source_path,assertion_count,targets) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET framework=EXCLUDED.framework,test_level=EXCLUDED.test_level,title=EXCLUDED.title,source_path=EXCLUDED.source_path,assertion_count=EXCLUDED.assertion_count,targets=EXCLUDED.targets,active=true,updated_at=now()`, [item.id,item.repositoryId,item.framework,item.level,item.title,item.sourcePath,item.assertionCount,JSON.stringify(item.targets)])
      for (const item of result.expectations) await client.query(`INSERT INTO fuzequality.test_expectations (id,subject_type,subject_id,kind,label,priority,rule,coverage,evidence_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label,priority=EXCLUDED.priority,rule=EXCLUDED.rule,coverage=EXCLUDED.coverage,evidence_ids=EXCLUDED.evidence_ids,active=true,updated_at=now()`, [item.id,item.subjectType,item.subjectId,item.kind,item.label,item.priority,item.rule,item.coverage,JSON.stringify(item.evidenceIds)])
      await client.query('DELETE FROM fuzequality.findings WHERE repository_id=$1', [result.repository.id])
      for (const item of result.findings) await client.query(`INSERT INTO fuzequality.findings (id,repository_id,subject_id,type,severity,title,detail,status,owner,remediation,source_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [item.id,item.repositoryId,item.subjectId,item.type,item.severity,item.title,item.detail,item.status,item.owner,item.remediation,result.revision])
      await client.query('DELETE FROM fuzequality.scan_diagnostics WHERE repository_id=$1', [result.repository.id])
      for (const item of result.diagnostics) await client.query(`INSERT INTO fuzequality.scan_diagnostics (repository_id,revision,source_path,category,severity,code,message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [result.repository.id,result.revision,item.sourcePath,item.category,item.severity,item.code,item.message])
      await client.query('UPDATE fuzequality.repositories SET last_scan_status=\'complete\',last_scan_at=$2,last_scan_revision=$3,updated_at=now() WHERE id=$1', [result.repository.id,result.scannedAt,result.revision])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async saveIntelligence(results: Array<{ requirement: Requirement; suggestions: Suggestion[] }>) {
    for (const { requirement, suggestions } of results) {
      const saved = await this.pool.query(`INSERT INTO fuzequality.requirements (jira_key,issue_type,parent_key,summary,normalized_description,project,status,source_updated_at,source_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (jira_key) DO UPDATE SET issue_type=EXCLUDED.issue_type,parent_key=EXCLUDED.parent_key,summary=EXCLUDED.summary,normalized_description=EXCLUDED.normalized_description,project=EXCLUDED.project,status=EXCLUDED.status,source_updated_at=EXCLUDED.source_updated_at,source_payload=EXCLUDED.source_payload,active=true RETURNING id`, [requirement.jiraKey,requirement.issueType,requirement.parentKey,requirement.summary,requirement.description,requirement.project,requirement.status,requirement.updatedAt,JSON.stringify(requirement)])
      const requirementId = saved.rows[0].id
      for (const suggestion of suggestions) await this.pool.query(`INSERT INTO fuzequality.suggestions (id,requirement_id,type,title,confidence,evidence,payload,state,source_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`, [suggestion.id,requirementId,suggestion.type,suggestion.title,suggestion.confidence,JSON.stringify(suggestion.evidence),JSON.stringify(suggestion.payload),suggestion.state,requirement.updatedAt])
    }
  }

  async decideSuggestion(id: string, decision: 'confirm' | 'reject') {
    const state = decision === 'confirm' ? 'confirmed' : 'rejected'
    await this.pool.query('UPDATE fuzequality.suggestions SET state=$2 WHERE id=$1', [id, state])
    return (await this.portfolio()).suggestions.find(item => item.id === id)
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
