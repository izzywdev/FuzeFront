import { describe, expect, it, vi } from 'vitest'
import { testExecutionInputSchema } from '@fuzequality/contracts'
import { executionRecord, linkExecutionToRevisionArtifacts, prepareExecutionEvidence, webhookExecutionRecord } from './test-execution-ingestion'

describe('internal execution ingestion compatibility', () => {
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
    ).resolves.toEqual({ policyArtifactIds: [], gateArtifactIds: [] })
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
    )).resolves.toEqual({ policyArtifactIds: [], gateArtifactIds: [] })
    expect(loadArtifacts).not.toHaveBeenCalled()
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

  it('does not infer a policy-gate pair when exact-revision linkage is ambiguous', async () => {
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
      summary: 'CI', evidence: ['CI'],
    }
    const result = await prepareExecutionEvidence(
      input,
      vi.fn().mockResolvedValue('catalog-abc123'),
      vi.fn().mockResolvedValue([
        { ...shared, id: 'policy-1', kind: 'policy', title: 'Policy one' },
        { ...shared, id: 'policy-2', kind: 'policy', title: 'Policy two' },
        { ...shared, id: 'gate-1', kind: 'gate', title: 'CI' },
      ]),
    )

    expect(result).toMatchObject({ ok: true, execution: { gateEvaluations: [] } })
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
