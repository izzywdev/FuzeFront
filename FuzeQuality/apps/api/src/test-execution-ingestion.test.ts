import { describe, expect, it, vi } from 'vitest'
import { testExecutionInputSchema, type ScanResult } from '@fuzequality/contracts'
import { executionRecord, linkExecutionToRevisionArtifacts, mergeExecutionEvidenceLinks, prepareExecutionEvidence, reconcileCompleteExecutionEvidenceLinks, reconcileExecutionEvidenceForScan, refreshExecutionArtifactEvidence, webhookExecutionRecord } from './test-execution-ingestion'

describe('internal execution ingestion compatibility', () => {
  it('requires a safe diagnostic for unavailable evidence collection', () => {
    const base = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'post-production' as const,
      status: 'passed' as const,
      name: 'Post-production browser journey',
    }
    expect(testExecutionInputSchema.safeParse({
      ...base,
      evidenceCollection: { status: 'unavailable', checkedAt: '2026-10-16T08:00:00.000Z' },
    }).success).toBe(false)
    expect(testExecutionInputSchema.parse({
      ...base,
      evidenceCollection: {
        status: 'unavailable',
        checkedAt: '2026-10-16T08:00:00.000Z',
        errorCode: 'PROVIDER_TIMEOUT',
      },
    }).evidenceCollection).toEqual(expect.objectContaining({ errorCode: 'PROVIDER_TIMEOUT' }))
  })

  it('merges provider artifacts without duplicating or overflowing evidence', () => {
    const generic = { kind: 'report' as const, name: 'Run artifacts', url: 'https://github.com/run/42#artifacts' }
    const discovered = Array.from({ length: 101 }, (_, index) => ({
      kind: (index === 0 ? 'video' : 'other') as 'video' | 'other',
      name: index === 0 ? 'Final video' : `Artifact ${index}`,
      url: index === 0 ? 'https://github.com/run/42/video' : `https://github.com/run/42/artifact/${index}`,
    }))
    expect(mergeExecutionEvidenceLinks([generic], [generic, ...discovered])).toEqual([
      generic,
      ...discovered.slice(0, 99),
    ])
  })

  it('removes expired GitHub artifacts only after a complete provider inventory', () => {
    const expiredVideo = { kind: 'video' as const, name: 'Expired video', url: 'https://github.com/acme/app/actions/runs/42/artifacts/7' }
    const externalReport = { kind: 'report' as const, name: 'External report', url: 'https://evidence.example/run/42' }
    const runArtifacts = { kind: 'report' as const, name: 'Run artifacts', url: 'https://github.com/acme/app/actions/runs/42#artifacts' }
    const currentTrace = { kind: 'trace' as const, name: 'Current trace', url: 'https://github.com/acme/app/actions/runs/42/artifacts/8' }

    expect(reconcileCompleteExecutionEvidenceLinks(
      [expiredVideo, externalReport, runArtifacts],
      [currentTrace],
    )).toEqual([externalReport, runArtifacts, currentTrace])
  })

  it('refreshes exact-attempt artifacts and records bounded provider results', async () => {
    const execution = webhookExecutionRecord({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000', provider: 'github-actions',
      externalRunId: '42', attempt: 2, revision: 'abc123', kind: 'post-production',
      status: 'passed', name: 'Production journey', evidenceLinks: [],
    }, 'tenant-1', { policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })
    const refreshed = await refreshExecutionArtifactEvidence(execution, async () => ({
      links: [{ kind: 'video', name: 'Playwright video', url: 'https://github.com/acme/app/actions/runs/42/artifacts/7' }],
      truncated: true,
    }), '2026-10-18T04:00:00.000Z')

    expect(refreshed.evidenceLinks).toEqual([expect.objectContaining({ kind: 'video' })])
    expect(refreshed.evidenceCollection).toEqual({
      status: 'partial', checkedAt: '2026-10-18T04:00:00.000Z', errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED',
    })
    expect(refreshed.externalRunId).toBe('42')
    expect(refreshed.attempt).toBe(2)
  })

  it('reconciles expired provider artifacts when a refresh is complete', async () => {
    const execution = webhookExecutionRecord({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000', provider: 'github-actions',
      externalRunId: '42', attempt: 2, revision: 'abc123', kind: 'post-production',
      status: 'passed', name: 'Production journey', evidenceLinks: [
        { kind: 'video', name: 'Expired video', url: 'https://github.com/acme/app/actions/runs/42/artifacts/7' },
        { kind: 'report', name: 'External report', url: 'https://evidence.example/run/42' },
      ],
    }, 'tenant-1', { policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })

    const refreshed = await refreshExecutionArtifactEvidence(execution, async () => ({
      links: [{ kind: 'trace', name: 'Current trace', url: 'https://github.com/acme/app/actions/runs/42/artifacts/8' }],
      truncated: false,
    }), '2026-10-20T11:00:00.000Z')

    expect(refreshed.evidenceLinks).toEqual([
      expect.objectContaining({ name: 'External report' }),
      expect.objectContaining({ name: 'Current trace' }),
    ])
    expect(refreshed.evidenceLinks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Expired video' }),
    ]))
  })

  it('retains a safe unavailable state when artifact refresh fails', async () => {
    const execution = webhookExecutionRecord({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000', provider: 'github-actions',
      externalRunId: '43', attempt: 1, revision: 'abc123', kind: 'ci', status: 'failed',
      name: 'CI', evidenceLinks: [],
    }, 'tenant-1', { policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })
    const failure = Object.assign(new Error('secret provider detail'), { code: 'PROVIDER_TIMEOUT' })

    const refreshed = await refreshExecutionArtifactEvidence(
      execution,
      async () => { throw failure },
      '2026-10-18T04:01:00.000Z',
    )

    expect(refreshed.evidenceCollection).toEqual({
      status: 'unavailable', checkedAt: '2026-10-18T04:01:00.000Z', errorCode: 'PROVIDER_TIMEOUT',
    })
    expect(JSON.stringify(refreshed)).not.toContain('secret provider detail')
  })

  it('does not downgrade previously discovered partial evidence when a retry fails', async () => {
    const execution = webhookExecutionRecord({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000', provider: 'github-actions',
      externalRunId: '44', attempt: 1, revision: 'abc123', kind: 'post-production', status: 'passed',
      name: 'Production journey', evidenceLinks: [],
      evidenceCollection: { status: 'partial', checkedAt: '2026-10-18T03:00:00.000Z', errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' },
    }, 'tenant-1', { policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })

    const refreshed = await refreshExecutionArtifactEvidence(
      execution,
      async () => { throw Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT' }) },
      '2026-10-18T04:00:00.000Z',
    )

    expect(refreshed.evidenceCollection).toEqual(execution.evidenceCollection)
  })

  it('surfaces interactive reconciliation failures without mutating retained evidence', async () => {
    const execution = webhookExecutionRecord({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000', provider: 'github-actions',
      externalRunId: '45', attempt: 1, revision: 'abc123', kind: 'post-production', status: 'passed',
      name: 'Production journey', evidenceLinks: [{
        kind: 'video', name: 'Verified recording', url: 'https://github.com/acme/app/actions/runs/45/artifacts/7',
      }],
      evidenceCollection: { status: 'complete', checkedAt: '2026-10-18T03:00:00.000Z' },
    }, 'tenant-1', { policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })
    const failure = Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT' })

    await expect(refreshExecutionArtifactEvidence(
      execution,
      async () => { throw failure },
      '2026-10-18T04:00:00.000Z',
      'throw',
    )).rejects.toBe(failure)
    expect(execution.evidenceCollection).toEqual({
      status: 'complete', checkedAt: '2026-10-18T03:00:00.000Z',
    })
    expect(execution.evidenceLinks).toHaveLength(1)
  })

  it('makes exact-revision links authoritative in webhook execution records', () => {
    const execution = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      provider: 'github-actions' as const,
      externalRunId: '98765',
      attempt: 2,
      revision: 'abc123',
      kind: 'ci' as const,
      status: 'failed' as const,
      name: 'Benchmark',
      workflowPath: '.github/workflows/benchmark.yml',
      evidenceLinks: [{ kind: 'report' as const, name: 'Artifacts', url: 'https://example.test/run/98765' }],
    }

    expect(webhookExecutionRecord(execution, 'org-1', {
      policyArtifactIds: ['policy-performance'],
      gateArtifactIds: ['gate-performance'],
      policyGatePairs: [{
        policyArtifactId: 'policy-performance',
        gateArtifactId: 'gate-performance',
      }],
      kind: 'stress',
    })).toEqual({
      ...execution,
      id: 'github-actions:98765:2:123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      thresholds: [],
      policyArtifactIds: ['policy-performance'],
      gateArtifactIds: ['gate-performance'],
      gateEvaluations: [{
        policyArtifactId: 'policy-performance',
        gateArtifactId: 'gate-performance',
        status: 'failed',
      }],
      kind: 'stress',
    })
  })

  it('links workflow evidence from the execution source revision only', async () => {
    const loadArtifacts = vi.fn().mockResolvedValue([])
    const resolveCatalogRevision = vi.fn().mockResolvedValue('catalog-revision-a')
    const workflow = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      revision: 'run-commit-a',
      name: 'Production smoke tests',
      workflowPath: '.github/workflows/post-prod.yml',
    }

    await expect(
      linkExecutionToRevisionArtifacts(
        workflow,
        'org-1',
        resolveCatalogRevision,
        loadArtifacts,
      )
    ).resolves.toEqual({ policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })
    expect(resolveCatalogRevision).toHaveBeenCalledWith(
      workflow.repositoryId,
      'org-1',
      'run-commit-a',
    )
    expect(loadArtifacts).toHaveBeenCalledWith(
      workflow.repositoryId,
      'org-1',
      'catalog-revision-a'
    )
  })

  it('does not link current artifacts when the source commit has no analyzed revision', async () => {
    const resolveCatalogRevision = vi.fn().mockResolvedValue(undefined)
    const loadArtifacts = vi.fn()
    const workflow = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      revision: 'unscanned-commit',
      name: 'CI',
      workflowPath: '.github/workflows/ci.yml',
    }

    await expect(linkExecutionToRevisionArtifacts(
      workflow,
      'org-1',
      resolveCatalogRevision,
      loadArtifacts,
    )).resolves.toEqual({ policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })
    expect(loadArtifacts).not.toHaveBeenCalled()
  })

  it('reconciles an early workflow run after its exact source revision is scanned', async () => {
    const execution = {
      id: 'github-actions:42:1:repo-1', repositoryId: 'repo-1', tenantId: 'org-1',
      provider: 'github-actions' as const, externalRunId: '42', attempt: 1,
      revision: 'a'.repeat(40), branch: 'feature/auth', kind: 'ci' as const,
      status: 'passed' as const, name: 'Authentication integration',
      workflowPath: '.github/workflows/integration.yml', policyArtifactIds: [], gateArtifactIds: [],
      gateEvaluations: [], thresholds: [], evidenceLinks: [],
    }
    const result: ScanResult = {
      repository: {
        id: 'repo-1', tenantId: 'org-1', owner: 'fuze', name: 'front',
        canonicalUrl: 'https://github.com/fuze/front', defaultBranch: 'main', kind: 'application',
        includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true,
        lastScanStatus: 'complete',
      },
      revision: 'catalog-1', trigger: 'push', scannedAt: '2026-10-14T10:00:00.000Z',
      operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [],
      scanDetails: {
        sourceRevision: 'a'.repeat(40), catalogRevision: 'catalog-1', scannerVersion: 'v1',
        configVersion: 'v1', partial: false, candidates: [],
        counts: { candidates: 0, operations: 0, frontendSurfaces: 0, tests: 0, diagnostics: 0 },
      },
      qualityArtifacts: [
        { id: 'policy-auth', repositoryId: 'repo-1', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication requirements', evidence: ['Authentication must be integration tested.'] },
        { id: 'gate-auth', repositoryId: 'repo-1', kind: 'gate' as const, title: 'Authentication integration gate', sourcePath: '.github/workflows/integration.yml', summary: 'Authentication integration gate', evidence: ['Authentication must pass integration tests.'] },
        { id: 'test-auth', repositoryId: 'repo-1', kind: 'integration-test' as const, title: 'Authentication integration', sourcePath: '.github/workflows/integration.yml', summary: 'Authentication integration suite', evidence: [] },
      ],
    }
    const saveExecution = vi.fn().mockResolvedValue(undefined)

    await expect(reconcileExecutionEvidenceForScan(
      result,
      'org-1',
      vi.fn().mockResolvedValue([execution]),
      saveExecution,
    )).resolves.toBe(1)
    expect(saveExecution).toHaveBeenCalledWith(expect.objectContaining({
      id: execution.id,
      revision: execution.revision,
      branch: 'feature/auth',
      kind: 'integration',
      policyArtifactIds: ['policy-auth'],
      gateArtifactIds: ['gate-auth'],
      gateEvaluations: [{ policyArtifactId: 'policy-auth', gateArtifactId: 'gate-auth', status: 'passed' }],
    }))
  })

  it('classifies a neutral workflow from reviewed performance metadata at its exact revision', async () => {
    const workflow = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      revision: 'run-commit-a',
      name: 'Benchmark',
      workflowPath: '.github/workflows/benchmark.yml',
    }

    await expect(linkExecutionToRevisionArtifacts(
      workflow,
      'org-1',
      vi.fn().mockResolvedValue('catalog-revision-a'),
      vi.fn().mockResolvedValue([{
        id: 'stress-benchmark',
        repositoryId: workflow.repositoryId,
        kind: 'stress-test',
        title: 'Benchmark',
        sourcePath: '.github/workflows/benchmark.yml',
        summary: 'Reviewed stress workflow',
        evidence: ['FUZEQUALITY_PERFORMANCE: stress'],
        execution: {
          provider: 'github-actions',
          workflowPath: '.github/workflows/benchmark.yml',
          trigger: 'workflow_dispatch',
        },
      }]),
    )).resolves.toMatchObject({ kind: 'stress' })
  })

  it('gives explicit performance classification precedence over overlapping integration inventory', async () => {
    const workflow = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      revision: 'run-commit-a',
      name: 'Integration performance',
      workflowPath: '.github/workflows/integration-performance.yml',
    }
    const common = {
      repositoryId: workflow.repositoryId,
      title: 'Integration performance',
      sourcePath: workflow.workflowPath,
      summary: 'Scanner-reviewed workflow',
      evidence: [],
    }

    await expect(linkExecutionToRevisionArtifacts(
      workflow,
      'org-1',
      vi.fn().mockResolvedValue('catalog-revision-a'),
      vi.fn().mockResolvedValue([
        { ...common, id: 'integration-performance', kind: 'integration-test' as const },
        {
          ...common,
          id: 'load-performance',
          kind: 'load-test' as const,
          evidence: ['FUZEQUALITY_PERFORMANCE: load'],
        },
      ]),
    )).resolves.toMatchObject({ kind: 'load' })
  })

  it.each([
    ['integration-test', 'integration'],
    ['post-production-test', 'post-production'],
  ] as const)('classifies a neutral workflow from exact %s inventory', async (artifactKind, executionKind) => {
    const workflow = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      revision: 'run-commit-a',
      name: 'Quality checks',
      workflowPath: '.github/workflows/quality.yml',
    }

    await expect(linkExecutionToRevisionArtifacts(
      workflow,
      'org-1',
      vi.fn().mockResolvedValue('catalog-revision-a'),
      vi.fn().mockResolvedValue([{
        id: `${artifactKind}-quality`,
        repositoryId: workflow.repositoryId,
        kind: artifactKind,
        title: 'Quality checks',
        sourcePath: workflow.workflowPath,
        summary: 'Scanner-reviewed workflow',
        evidence: [],
      }]),
    )).resolves.toMatchObject({ kind: executionKind })
  })

  it('rejects explicit evidence when the execution revision was not analyzed', async () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'unscanned-commit',
      kind: 'post-production',
      status: 'failed',
      name: 'Production smoke tests',
      policyArtifactIds: ['policy-auth'],
    })

    await expect(prepareExecutionEvidence(
      input,
      vi.fn().mockResolvedValue(undefined),
      vi.fn(),
    )).resolves.toMatchObject({
      ok: false,
      code: 'EXECUTION_EVIDENCE_REVISION_UNANALYZED',
    })
  })

  it('rejects missing and wrong-kind evidence references from the exact revision', async () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'ci',
      status: 'failed',
      name: 'CI',
      gateEvaluations: [{
        policyArtifactId: 'gate-not-policy',
        gateArtifactId: 'missing-gate',
        status: 'failed',
      }],
    })

    await expect(prepareExecutionEvidence(
      input,
      vi.fn().mockResolvedValue('catalog-abc123'),
      vi.fn().mockResolvedValue([{
        id: 'gate-not-policy',
        repositoryId: input.repositoryId,
        kind: 'gate',
        title: 'CI gate',
        sourcePath: '.github/workflows/ci.yml',
        summary: 'CI gate',
        evidence: [],
      }]),
    )).resolves.toEqual({
      ok: false,
      code: 'EXECUTION_EVIDENCE_REFERENCE_INVALID',
      error: 'Policy/gate evidence does not belong to the execution revision',
      invalidPolicyArtifactIds: ['gate-not-policy'],
      invalidGateArtifactIds: ['missing-gate'],
    })
  })

  it('accepts observation or logical evidence IDs and persists stable logical identities', async () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'ci',
      status: 'passed',
      name: 'CI',
      policyArtifactIds: ['policy-observation-abc123'],
      gateArtifactIds: ['gate-release'],
      gateEvaluations: [{
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-observation-abc123',
        status: 'passed',
      }],
    })
    const shared = {
      repositoryId: input.repositoryId,
      revision: 'catalog-abc123',
      title: 'Evidence',
      sourcePath: 'governance.md',
      summary: 'Evidence',
      evidence: [],
    }

    await expect(prepareExecutionEvidence(
      input,
      vi.fn().mockResolvedValue('catalog-abc123'),
      vi.fn().mockResolvedValue([
        { ...shared, id: 'policy-observation-abc123', logicalId: 'policy-auth', kind: 'policy' as const },
        { ...shared, id: 'gate-observation-abc123', logicalId: 'gate-release', kind: 'gate' as const },
      ]),
    )).resolves.toEqual({
      ok: true,
      execution: {
        ...input,
        policyArtifactIds: ['policy-auth'],
        gateArtifactIds: ['gate-release'],
        gateEvaluations: [{
          policyArtifactId: 'policy-auth',
          gateArtifactId: 'gate-release',
          status: 'passed',
        }],
      },
    })
  })

  it('auto-links unclaimed execution evidence from the exact analyzed revision', async () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'post-production',
      status: 'passed',
      name: 'Production smoke tests',
      workflowPath: '.github/workflows/post-prod.yml',
    })
    const artifacts = [
      {
        id: 'policy-auth', repositoryId: input.repositoryId, kind: 'policy' as const,
        title: 'Authentication policy', sourcePath: 'POLICIES.md',
        summary: 'Authentication policy', evidence: ['Production smoke tests'],
      },
      {
        id: 'gate-auth', repositoryId: input.repositoryId, kind: 'gate' as const,
        title: 'Production smoke tests', sourcePath: '.github/workflows/post-prod.yml',
        summary: 'Production smoke tests', evidence: ['Production smoke tests'],
      },
    ]

    await expect(prepareExecutionEvidence(
      input,
      vi.fn().mockResolvedValue('catalog-abc123'),
      vi.fn().mockResolvedValue(artifacts),
    )).resolves.toMatchObject({
      ok: true,
      execution: {
        policyArtifactIds: ['policy-auth'],
        gateArtifactIds: ['gate-auth'],
        gateEvaluations: [{
          policyArtifactId: 'policy-auth',
          gateArtifactId: 'gate-auth',
          status: 'passed',
        }],
      },
    })
  })

  it('records every policy evaluated by one exact-revision workflow gate', async () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'ci', status: 'passed', name: 'CI',
      workflowPath: '.github/workflows/ci.yml',
    })
    const shared = {
      repositoryId: input.repositoryId,
      sourcePath: '.github/workflows/ci.yml',
      summary: 'Authentication required check', evidence: ['Authentication required'],
    }
    const result = await prepareExecutionEvidence(
      input,
      vi.fn().mockResolvedValue('catalog-abc123'),
      vi.fn().mockResolvedValue([
        { ...shared, id: 'policy-1', kind: 'policy', title: 'Policy one' },
        { ...shared, id: 'policy-2', kind: 'policy', title: 'Policy two' },
        { ...shared, id: 'gate-1', kind: 'gate', title: 'Authentication CI' },
      ]),
    )

    expect(result).toMatchObject({
      ok: true,
      execution: {
        gateEvaluations: [
          { policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'passed' },
          { policyArtifactId: 'policy-2', gateArtifactId: 'gate-1', status: 'passed' },
        ],
      },
    })
  })

  it('uses the generated id when a legacy producer omits provider run identity', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'integration',
      status: 'passed',
      name: 'Integration suite',
    })

    expect(executionRecord(input, 'generated-id')).toMatchObject({
      id: 'generated-id',
      provider: 'external',
      externalRunId: 'generated-id',
      attempt: 1,
    })
  })

  it('preserves an explicit provider run identity', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      provider: 'github-actions',
      externalRunId: '98765',
      attempt: 3,
      revision: 'abc123',
      kind: 'ci',
      status: 'running',
      name: 'CI',
      workflowPath: '.github/workflows/ci.yml',
    })

    expect(executionRecord(input, 'generated-id')).toMatchObject({
      provider: 'github-actions',
      externalRunId: '98765',
      attempt: 3,
      workflowPath: '.github/workflows/ci.yml',
    })
  })

  it('derives threshold outcomes instead of trusting producer verdicts', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'load',
      status: 'failed',
      name: 'Checkout load test',
      thresholds: [
        { metric: 'p95 latency', observed: 212, unit: 'ms', operator: 'lte', target: 200 },
        { metric: 'error rate', observed: 0.3, unit: '%', operator: 'lt', target: 1 },
      ],
    })

    expect(executionRecord(input, 'generated-id').thresholds).toEqual([
      expect.objectContaining({ metric: 'p95 latency', passed: false }),
      expect.objectContaining({ metric: 'error rate', passed: true }),
    ])
  })

  it('retains explicit gate outcomes and adds their artifacts to discovery links', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'post-production',
      status: 'failed',
      name: 'Production smoke tests',
      gateEvaluations: [{
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-auth-smoke',
        status: 'failed',
        detail: 'Unauthenticated redirect did not preserve the requested route.',
      }],
    })

    expect(executionRecord(input, 'generated-id')).toMatchObject({
      policyArtifactIds: ['policy-auth'],
      gateArtifactIds: ['gate-auth-smoke'],
      gateEvaluations: [expect.objectContaining({
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-auth-smoke',
        status: 'failed',
      })],
    })
  })

  it('retains links to video and report evidence for the exact run attempt', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'post-production',
      status: 'passed',
      name: 'Production smoke tests',
      evidenceLinks: [
        { kind: 'video', name: 'FuzeQuality journey', url: 'https://evidence.example/runs/42/video.webm' },
        { kind: 'report', name: 'Playwright report', url: 'https://evidence.example/runs/42/report/' },
      ],
    })

    expect(executionRecord(input, 'generated-id').evidenceLinks).toEqual([
      expect.objectContaining({ kind: 'video', name: 'FuzeQuality journey' }),
      expect.objectContaining({ kind: 'report', name: 'Playwright report' }),
    ])
  })

  it('rejects executable and insecure evidence URLs before they reach the UI', () => {
    for (const url of ['javascript:alert(1)', 'http://evidence.example/video.webm']) {
      expect(testExecutionInputSchema.safeParse({
        repositoryId: '123e4567-e89b-12d3-a456-426614174000',
        tenantId: 'org-1',
        revision: 'abc123',
        kind: 'post-production',
        status: 'passed',
        name: 'Production smoke tests',
        evidenceLinks: [{ kind: 'video', name: 'Unsafe video', url }],
      }).success).toBe(false)
    }
  })

  it('accepts only HTTPS provider run URLs before they reach the UI', () => {
    const execution = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'integration',
      status: 'passed',
      name: 'Integration tests',
    }

    expect(testExecutionInputSchema.safeParse({
      ...execution,
      sourceUrl: 'https://github.com/izzywdev/FuzeFront/actions/runs/42',
    }).success).toBe(true)
    for (const sourceUrl of [
      'javascript:alert(1)',
      'http://github.com/izzywdev/FuzeFront/actions/runs/42',
      'not-a-url',
    ]) {
      expect(testExecutionInputSchema.safeParse({ ...execution, sourceUrl }).success).toBe(false)
    }
  })

  it('rejects impossible execution lifecycle timestamps before persistence', () => {
    const execution = {
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'integration' as const,
      name: 'Integration tests',
      startedAt: '2026-10-20T12:00:00.000Z',
    }

    const runningWithCompletion = testExecutionInputSchema.safeParse({
      ...execution,
      status: 'running',
      completedAt: '2026-10-20T12:01:00.000Z',
    })
    expect(runningWithCompletion.success).toBe(false)
    if (!runningWithCompletion.success) {
      expect(runningWithCompletion.error.flatten().fieldErrors.completedAt).toContain(
        'Running execution cannot include a completion timestamp'
      )
    }

    const reversed = testExecutionInputSchema.safeParse({
      ...execution,
      status: 'failed',
      completedAt: '2026-10-20T11:59:59.000Z',
    })
    expect(reversed.success).toBe(false)
    if (!reversed.success) {
      expect(reversed.error.flatten().fieldErrors.completedAt).toContain(
        'Execution completion timestamp cannot precede its start timestamp'
      )
    }

    expect(testExecutionInputSchema.safeParse({
      ...execution,
      status: 'passed',
      completedAt: '2026-10-20T12:01:00.000Z',
    }).success).toBe(true)
  })

  it('rejects duplicate outcomes for the same policy and gate pair', () => {
    const parsed = testExecutionInputSchema.safeParse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'ci',
      status: 'failed',
      name: 'CI',
      gateEvaluations: [
        { policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'passed' },
        { policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'failed' },
      ],
    })

    expect(parsed.success).toBe(false)
  })
})
