import { describe, expect, it } from 'vitest'
import express from 'express'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpenApiSurface, loadSpec, CONTRACT_VERSION, SERVICE_NAME } from './openapi'
import { isPublicRequest } from './authentication'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_SPEC = resolve(HERE, '../../../contracts/openapi.yaml')
const MISSING_SPEC = '/nonexistent/openapi.yaml'

/**
 * Mount the surface on a bare Express app and drive it over a real socket.
 *
 * Deliberately NOT importing apps/api/src/index.ts: that module calls
 * app.listen() at import time and constructs a Kafka bus and a catalog store,
 * so importing it in a unit test would bind a port and open connections. The
 * surface under test is a router, and a router is testable on its own.
 */
async function withSurface(
  env: NodeJS.ProcessEnv,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const app = express()
  app.use(createOpenApiSurface(env).router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', () => resolve()))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  try {
    await fn(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('GET /health', () => {
  it('reports ok, the service, the contract version and spec availability', async () => {
    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      const response = await fetch(`${base}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: 'ok',
        service: SERVICE_NAME,
        version: CONTRACT_VERSION,
        openapi: 'available',
      })
    })
  })

  it('stays 200 with openapi:"unavailable" when the spec is missing', async () => {
    // The distinction that matters: a build shipped without its contract must be
    // VISIBLE, not fatal. A non-200 here would CrashLoopBackOff the pod over a
    // problem that restarting it cannot fix.
    await withSurface({ OPENAPI_SPEC_PATH: MISSING_SPEC }, async base => {
      const response = await fetch(`${base}/health`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
      expect(body.openapi).toBe('unavailable')
    })
  })
})

describe('contract discovery', () => {
  it('serves the committed bytes at /openapi.yaml', async () => {
    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      const response = await fetch(`${base}/openapi.yaml`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('yaml')
      expect(await response.text()).toContain('openapi: 3.0.3')
    })
  })

  it('serves the same document as JSON at /openapi.json', async () => {
    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      const response = await fetch(`${base}/openapi.json`)
      expect(response.status).toBe(200)
      const document = await response.json()
      expect(document.info.title).toBe('FuzeQuality')
      expect(document.info.version).toBe(CONTRACT_VERSION)
    })
  })

  it('publishes structured execution threshold input and evaluated evidence', async () => {
    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      const response = await fetch(`${base}/openapi.json`)
      expect(response.status).toBe(200)
      const document = await response.json()
      const schemas = document.components.schemas
      expect(schemas.TestExecutionInput.properties.thresholds.items.$ref).toBe(
        '#/components/schemas/TestExecutionThresholdInput'
      )
      expect(schemas.TestExecutionThreshold.required).toContain('passed')
      expect(schemas.TestExecution.required).toContain('thresholds')
      expect(schemas.TestExecutionInput.properties.gateEvaluations.items.$ref).toBe(
        '#/components/schemas/TestExecutionGateEvaluation'
      )
      expect(schemas.TestExecution.required).toContain('gateEvaluations')
      expect(schemas.TestExecutionInput.properties.evidenceLinks.items.$ref).toBe(
        '#/components/schemas/TestExecutionEvidenceLink'
      )
      expect(schemas.TestExecution.required).toContain('evidenceLinks')
      expect(schemas.TestExecutionEvidenceLink.properties.url.pattern).toBe('^https://')
      expect(schemas.TestExecutionInput.properties.sourceUrl.pattern).toBe('^https://')
      expect(schemas.TestExecution.properties.sourceUrl.pattern).toBe('^https://')
      expect(schemas.PerformanceDispatch.required).toContain('sourceRevision')
      expect(schemas.PerformanceDispatch.properties.sourceRevision.pattern).toBe(
        '^[0-9a-fA-F]{40}$'
      )
      expect(schemas.TestExecutionInput.properties.workflowPath.maxLength).toBe(1000)
      expect(schemas.TestExecutionInput.properties.workflowPath.description).toContain('removed before storage')
      expect(schemas.TestExecutionInput.properties.branch.maxLength).toBe(500)
      expect(schemas.TestExecution.properties.branch.maxLength).toBe(500)
      expect(schemas.TestExecution.properties.workflowPath.type).toBe('string')
      expect(schemas.TestExecution.properties.workflowPath.description).toContain('without a provider `@ref` suffix')
      expect(document.components.parameters.ExecutionWorkflowPath.description).toContain(
        'removed before matching history, trends, and policy-gate performance'
      )
      expect(schemas.TestExecutionInput.description).toContain('completion cannot precede start')
      expect(schemas.TestExecutionInput.properties.completedAt.description).toContain(
        'forbidden while status is running'
      )
      expect(
        document.paths['/api/v1/internal/test-executions'].post.responses['422'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/ExecutionEvidenceConflict')
      expect(document.paths['/api/v1/internal/test-executions'].post.description).toContain(
        'canonicalized to their repository-relative YAML path'
      )
      expect(schemas.ExecutionEvidenceConflict.properties.code.enum).toEqual([
        'EXECUTION_EVIDENCE_REVISION_UNANALYZED',
        'EXECUTION_EVIDENCE_REFERENCE_INVALID',
      ])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions'].get.parameters
          .map((parameter: { $ref?: string }) => parameter.$ref)
      ).toContain('#/components/parameters/ExecutionWorkflowPath')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions'].get.parameters
          .map((parameter: { $ref?: string }) => parameter.$ref)
      ).toContain('#/components/parameters/ExecutionExternalRunId')
      expect(document.components.parameters.ExecutionExternalRunId.schema.maxLength).toBe(500)
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions/attempts'].get.parameters
          .map((parameter: { $ref?: string }) => parameter.$ref)
      ).toEqual([
        '#/components/parameters/ExecutionProvider',
        '#/components/parameters/ExecutionExternalRunId',
        undefined,
        undefined,
      ])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions/attempts'].get.responses['200'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/TestExecutionPage')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions/evidence/refresh'].post.requestBody.content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/TestExecutionEvidenceRefresh')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions/evidence/refresh'].post.responses['200'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/TestExecution')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions/{executionId}'].get.responses['200'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/TestExecutionDetail')
      expect(schemas.TestExecutionDetail.allOf[0].$ref).toBe(
        '#/components/schemas/TestExecution'
      )
      expect(schemas.TestExecutionDetail.allOf[1].properties.catalogRevision.type).toBe('string')
      expect(document.components.parameters.ExecutionId).toMatchObject({
        name: 'executionId',
        in: 'path',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 500 },
      })
      expect(schemas.TestExecutionEvidenceRefresh).toMatchObject({
        additionalProperties: false,
        required: ['provider', 'externalRunId', 'attempt'],
      })
      expect(schemas.TestExecutionEvidenceRefresh.properties.provider.enum).toEqual(['github-actions'])
      expect(document.components.parameters.ExecutionName).toMatchObject({
        name: 'name',
        in: 'query',
        schema: { type: 'string', minLength: 1, maxLength: 500 },
      })
      for (const path of [
        '/api/v1/repositories/{repositoryId}/execution-performance',
        '/api/v1/repositories/{repositoryId}/execution-trend',
        '/api/v1/repositories/{repositoryId}/test-executions',
      ]) {
        const parameterRefs = document.paths[path].get.parameters.map((parameter: { $ref?: string }) => parameter.$ref)
        expect(parameterRefs).toContain('#/components/parameters/ExecutionExternalRunId')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionName')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionEvidenceKind')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionEvidenceCollectionStatus')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionEvidenceCheckedAfter')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionEvidenceCheckedBefore')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionEvidenceRequirement')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionThresholdOutcome')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionGateOutcome')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionPolicyArtifactId')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionGateArtifactId')
        expect(parameterRefs).toContain('#/components/parameters/ExecutionBranch')
      }
      expect(document.components.parameters.ExecutionPolicyArtifactId.schema.maxLength).toBe(500)
      expect(document.components.parameters.ExecutionGateArtifactId.schema.maxLength).toBe(500)
      expect(document.components.parameters.ExecutionBranch).toMatchObject({
        name: 'branch',
        in: 'query',
        schema: { type: 'string', minLength: 1, maxLength: 500 },
      })
      expect(document.components.parameters.ExecutionEvidenceKind.schema.enum).toEqual([
        'video', 'report', 'trace', 'screenshot', 'log', 'other',
      ])
      expect(document.components.parameters.ExecutionEvidenceCollectionStatus).toMatchObject({
        name: 'evidenceCollectionStatus',
        in: 'query',
        schema: { type: 'string', enum: ['complete', 'partial', 'unavailable', 'not-collected'] },
      })
      expect(document.components.parameters.ExecutionEvidenceCheckedAfter).toMatchObject({
        name: 'evidenceCheckedAfter',
        in: 'query',
        schema: { type: 'string', format: 'date-time' },
      })
      expect(document.components.parameters.ExecutionEvidenceCheckedBefore).toMatchObject({
        name: 'evidenceCheckedBefore',
        in: 'query',
        schema: { type: 'string', format: 'date-time' },
      })
      expect(document.components.parameters.ExecutionEvidenceRequirement).toMatchObject({
        name: 'evidenceRequirement',
        in: 'query',
        schema: { type: 'string', enum: ['policy-gate-outcome-missing', 'post-production-video-missing', 'performance-threshold-missing', 'terminal-timing-missing'] },
      })
      expect(document.paths['/api/v1/internal/repository-flow-candidates'].post.description)
        .toContain('exact tenant-scoped repository revision')
      expect(document.paths['/api/v1/internal/repository-flow-candidates'].post.description)
        .toContain('LiteLLM evidence IDs')
      expect(document.paths['/api/v1/repositories/{repositoryId}/test-executions/evidence/refresh'].post.description)
        .toContain('no retained collection attempt')
      expect(document.paths['/api/v1/repositories/{repositoryId}/test-executions/evidence/refresh'].post.description)
        .toContain('Complete attempts may be reconciled again')
      expect(document.paths['/api/v1/repositories/{repositoryId}/test-executions/evidence/refresh'].post.responses['502'].description)
        .toContain('previously retained evidence remains unchanged')
      expect(document.paths['/api/v1/repositories/{repositoryId}/test-executions/evidence/refresh'].post.responses['504'].description)
        .toContain('timed out')
      expect(document.components.parameters.ExecutionThresholdOutcome.schema.enum).toEqual([
        'passed', 'failed',
      ])
      expect(document.components.parameters.ExecutionGateOutcome).toMatchObject({
        name: 'gateOutcome',
        in: 'query',
        schema: { $ref: '#/components/schemas/ExecutionStatus' },
      })
      expect(document.components.parameters.ExecutionWorkflowPath.schema.maxLength).toBe(1000)
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions'].get.parameters
          .filter((parameter: { name?: string }) => parameter.name)
          .map((parameter: { name: string }) => parameter.name)
      ).toEqual(['limit', 'cursor'])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-executions'].get.responses['200'].content[
          'application/json'
        ].schema
      ).toMatchObject({ type: 'object', required: ['items', 'page'] })
      expect(schemas.TestExecutionPage.properties.page.$ref).toBe('#/components/schemas/HistoryCursorPage')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/quality-artifacts'].get.parameters
          .find((parameter: { name?: string }) => parameter.name === 'cursor').description
      ).toContain("first page's analyzed revision")
      const artifactIds = document.paths[
        '/api/v1/repositories/{repositoryId}/quality-artifacts/by-ids'
      ].get.parameters.find((parameter: { name?: string }) => parameter.name === 'id')
      const artifactRevision = document.paths[
        '/api/v1/repositories/{repositoryId}/quality-artifacts/by-ids'
      ].get.parameters.find((parameter: { name?: string }) => parameter.name === 'revision')
      expect(artifactRevision).toMatchObject({ in: 'query', schema: { type: 'string', minLength: 1, maxLength: 500 } })
      expect(artifactRevision.required).not.toBe(true)
      expect(artifactIds).toMatchObject({ required: true, explode: true })
      expect(artifactIds.schema).toMatchObject({
        type: 'array',
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
      })
      expect(schemas.QualityArtifact.properties.revision).toMatchObject({ type: 'string', minLength: 1 })
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/execution-performance'].get.parameters
          .filter((parameter: { name?: string }) => parameter.name)
          .map((parameter: { name: string }) => parameter.name)
      ).toEqual(['limit', 'cursor'])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/execution-performance'].get.responses['200'].content[
          'application/json'
        ].schema
      ).toMatchObject({ type: 'object', required: ['items', 'page'] })
      expect(schemas.PolicyGatePerformance.properties.revisionCount.minimum).toBe(0)
      expect(schemas.PolicyGatePerformance.properties.latestRevision.type).toBe('string')
      expect(schemas.PolicyGatePerformance.required).toEqual(
        ['repositoryId', 'policyArtifactId', 'gateArtifactId', 'total', 'passed', 'failed', 'cancelled', 'running', 'passRate']
      )
      expect(schemas.PolicyGatePerformance.properties.passRate).toMatchObject({
        type: 'number', format: 'double', minimum: 0, maximum: 1,
      })
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/execution-trend'].get.parameters
          .filter((parameter: { name?: string }) => parameter.name)
          .map((parameter: { name: string }) => parameter.name)
      ).toEqual(['limit', 'cursor'])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/execution-trend'].get.responses['200'].content[
          'application/json'
        ].schema
      ).toMatchObject({ type: 'object', required: ['items', 'page'] })
      expect(schemas.ExecutionOutcomeTrend.required).toEqual(
        ['date', 'total', 'passed', 'failed', 'cancelled', 'running', 'passRate', 'durationSampleCount', 'averageDurationMs', 'maximumDurationMs', 'retryAttemptCount', 'successfulRetryCount', 'recoveredRunCount']
      )
      expect(schemas.ExecutionOutcomeTrend.properties.passRate).toMatchObject({
        type: 'number', format: 'double', minimum: 0, maximum: 1,
      })
      expect(schemas.ExecutionOutcomeTrend.properties.averageDurationMs).toMatchObject({
        type: 'integer', minimum: 0,
      })
      expect(schemas.ExecutionOutcomeTrend.properties.maximumDurationMs).toMatchObject({
        type: 'integer', minimum: 0,
      })
      expect(schemas.ExecutionOutcomeTrend.properties.successfulRetryCount).toMatchObject({
        type: 'integer', minimum: 0,
      })
      expect(schemas.ExecutionOutcomeTrend.properties.recoveredRunCount).toMatchObject({
        type: 'integer', minimum: 0,
      })
      expect(document.components.parameters.ExecutionAttemptScope).toMatchObject({
        name: 'attemptScope',
        in: 'query',
        schema: { type: 'string', enum: ['initial', 'retry', 'recovered'] },
      })
      expect(document.components.parameters.ExecutionMinimumDurationMs).toMatchObject({
        name: 'minimumDurationMs',
        in: 'query',
        schema: { type: 'integer', minimum: 0, maximum: 2147483647 },
      })
      expect(document.components.parameters.ExecutionMaximumDurationMs).toMatchObject({
        name: 'maximumDurationMs',
        in: 'query',
        schema: { type: 'integer', minimum: 0, maximum: 2147483647 },
      })
      expect(schemas.PolicyGateEvaluation.required).toEqual(
        expect.arrayContaining(['confidence', 'scope', 'remediationAction'])
      )
      expect(schemas.PolicyGateRemediationAction.enum).toEqual([
        'build-gate',
        'build-policy',
        'disambiguate-policy',
        'align-policy-gate',
      ])
      expect(schemas.PolicyGateEvaluationInput.required).toContain('remediationAction')
      expect(schemas.PolicyGateEvaluationInput.properties.evidencePassages.items.$ref).toBe(
        '#/components/schemas/PolicyGateEvidencePassage'
      )
      expect(schemas.PolicyGateEvidencePassage.required).toEqual(
        ['artifactId', 'sourcePath', 'text', 'signal']
      )
      const ingestionSchema = schemas.PolicyGateEvaluationInput
      expect(
        document.paths['/api/v1/internal/policy-gate-evaluations'].post.requestBody.content[
          'application/json'
        ].schema.properties.evaluations.items.$ref
      ).toBe('#/components/schemas/PolicyGateEvaluationInput')
      expect(ingestionSchema.additionalProperties).toBe(false)
      expect(ingestionSchema.properties.reviewStatus.enum).toEqual(['proposed'])
      expect(ingestionSchema.properties).not.toHaveProperty('reviewedAt')
      expect(ingestionSchema.properties).not.toHaveProperty('reviewedBy')
      expect(ingestionSchema.properties).not.toHaveProperty('reviewReason')
      expect(
        document.paths['/api/v1/internal/policy-gate-evaluations'].post.description
      ).toContain('exact repository analysis revision')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates'].get.parameters.map(
          (parameter: { name: string }) => parameter.name
        )
      ).toEqual([
        'source',
        'status',
        'revision',
        'model',
        'promptVersion',
        'schemaVersion',
        'minConfidence',
        'maxConfidence',
        'limit',
        'cursor',
      ])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates'].get.responses['200'].content[
          'application/json'
        ].schema
      ).toMatchObject({
        type: 'object',
        required: ['items', 'page'],
      })
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates/{candidateId}'].get.responses['200'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/RepositoryFlowCandidate')
      expect(document.components.parameters.CandidateId.schema.maxLength).toBe(500)
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/policy-gate-evaluations/{evaluationId}'].get.responses['200'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/PolicyGateEvaluation')
      expect(document.components.parameters.EvaluationId.schema.minLength).toBe(1)
      for (const path of [
        '/api/v1/repositories/{repositoryId}/flow-candidates/{candidateId}/history',
        '/api/v1/repositories/{repositoryId}/policy-gate-evaluations/{evaluationId}/history',
      ]) {
        expect(
          document.paths[path].get.parameters.map((parameter: { name: string }) => parameter.name)
        ).toEqual(['limit', 'cursor'])
        expect(
          document.paths[path].get.responses['200'].content['application/json'].schema
        ).toMatchObject({ type: 'object', required: ['items', 'page'] })
      }
      expect(schemas.RepositoryFlowReviewHistoryEntry.required).toContain('id')
      expect(schemas.PolicyGateReviewHistoryEntry.required).toContain('id')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates/{candidateId}/review'].post.responses['409'].content[
          'application/json'
        ].schema.oneOf
      ).toEqual([
        { $ref: '#/components/schemas/StaleFlowCandidateError' },
        { $ref: '#/components/schemas/StaleFlowReviewError' },
      ])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates/{candidateId}/review'].post.responses['422'].description
      ).toContain('grounding gaps')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates/{candidateId}/review'].post.responses['422'].description
      ).toContain('exact repository revision')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates/{candidateId}/review'].post.responses['422'].description
      ).toContain('LiteLLM evidence')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/flow-candidates/{candidateId}/review'].post.requestBody.content[
          'application/json'
        ].schema.properties.expectedReviewedAt
      ).toMatchObject({ type: 'string', format: 'date-time', nullable: true })
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/policy-gate-evaluations/{evaluationId}/review'].post.responses['409'].content[
          'application/json'
        ].schema.oneOf
      ).toEqual([
        { $ref: '#/components/schemas/StalePolicyGateEvaluationError' },
        { $ref: '#/components/schemas/StalePolicyGateReviewError' },
      ])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/policy-gate-evaluations/{evaluationId}/review'].post.responses['422'].description
      ).toContain('requires reviewer rationale')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/policy-gate-evaluations/{evaluationId}/review'].post.responses['422'].description
      ).toContain('exact repository revision')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/policy-gate-evaluations/{evaluationId}/review'].post.requestBody.content[
          'application/json'
        ].schema.properties.expectedReviewedAt
      ).toMatchObject({ type: 'string', format: 'date-time', nullable: true })
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/policy-gate-evaluations'].get.parameters.map(
          (parameter: { name: string }) => parameter.name
        )
      ).toEqual(['kind', 'remediationAction', 'severity', 'reviewStatus', 'revision', 'subject', 'minConfidence', 'maxConfidence', 'limit', 'cursor'])
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/policy-gate-evaluations'].get.responses['200'].content[
          'application/json'
        ].schema
      ).toMatchObject({
        type: 'object',
        required: ['items', 'page'],
      })
      expect(schemas.RepositoryFlowCandidatePage.properties.page.$ref).toBe('#/components/schemas/HistoryCursorPage')
      expect(schemas.PolicyGateEvaluationPage.properties.page.$ref).toBe('#/components/schemas/HistoryCursorPage')
      expect(schemas.HistoryCursorPage.required).toEqual(['nextCursor', 'hasMore'])
      expect(schemas.HistoryCursorPage.properties.nextCursor.nullable).toBe(true)
      expect(
        document.paths['/api/v1/internal/repositories/{repositoryId}/policy-gate-evaluations'].get.parameters
          .map((parameter: { name: string }) => parameter.name)
      ).toEqual(['kind', 'remediationAction', 'severity', 'reviewStatus', 'revision', 'subject', 'minConfidence', 'maxConfidence', 'limit', 'cursor'])
      expect(
        document.paths['/api/v1/internal/repositories/{repositoryId}/policy-gate-evaluations'].get.responses['200'].content[
          'application/json'
        ].schema
      ).toMatchObject({ type: 'object', required: ['items', 'page'] })
      expect(
        document.paths['/api/v1/internal/repositories/{repositoryId}/policy-gate-evaluations'].get.responses
      ).toHaveProperty('400')
      expect(
        document.paths['/api/v1/internal/repositories/{repositoryId}/scan-failure'].post.requestBody.content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/RepositoryScanFailure')
      expect(schemas.RepositoryScanFailure).toMatchObject({
        additionalProperties: false,
        required: ['code', 'message', 'failedAt'],
      })
      expect(schemas.RepositoryScanFailure.properties.code.enum).toEqual([
        'SCAN_TRANSPORT_LIMIT_EXCEEDED',
        'SCAN_PROCESSING_FAILED',
      ])
      expect(schemas.RepositoryProcessingStatus.properties.lastScanFailure.$ref).toBe(
        '#/components/schemas/RepositoryScanFailure'
      )
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/analysis-retries'].post.responses['409'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/ApiError')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/performance-tests/{artifactId}/execute'].post.summary
      ).toContain('immutable analyzed commit')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/performance-tests/{artifactId}/execute'].post.responses
      ).toHaveProperty('409')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-suites/{artifactId}/execute'].post.summary
      ).toContain('integration, post-production, load, or stress')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-suites/{artifactId}/execute'].post.responses['202'].content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/TestSuiteDispatch')
      expect(
        document.paths['/api/v1/repositories/{repositoryId}/test-suites/{artifactId}/execute'].post.requestBody.content[
          'application/json'
        ].schema.$ref
      ).toBe('#/components/schemas/WorkflowDispatchRequest')
      expect(schemas.WorkflowDispatchRequest.properties.inputs).toMatchObject({
        maxProperties: 20,
        additionalProperties: { type: 'string', minLength: 1, maxLength: 256 },
      })
      expect(schemas.TestSuiteDispatch.required).toContain('artifactKind')
    })
  })

  it('answers 503 — not 404 — when the document is missing', async () => {
    // 404 would read as "this service publishes no spec". It does; the document
    // is what is missing, and the two need different fixes.
    await withSurface({ OPENAPI_SPEC_PATH: MISSING_SPEC }, async base => {
      for (const path of ['/openapi.yaml', '/openapi.json']) {
        const response = await fetch(`${base}${path}`)
        expect(response.status, `${path} should be 503`).toBe(503)
        expect((await response.json()).code).toBe('openapi_unavailable')
      }
    })
  })
})

describe('the contract and the implementation agree', () => {
  it('every contract path owned by the discovery surface is served', async () => {
    // Repository-intelligence endpoints live in index.ts and are covered by
    // the API route suites and the contract-conformance test. This unit mounts
    // only createOpenApiSurface(), so keep its reachability assertion scoped to
    // the routes that router actually owns.
    const loaded = loadSpec({ OPENAPI_SPEC_PATH: REPO_SPEC })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const routed = ['/health', '/openapi.yaml', '/openapi.json']

    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      for (const path of routed) {
        const response = await fetch(`${base}${path}`)
        expect(response.status, `${path} is in the contract but not served`).not.toBe(404)
      }
    })
  })

  it('every operational path in the contract is reachable without a token', async () => {
    // A probe endpoint the API-token guard rejects is a probe endpoint that
    // fails for the kubelet, the nginx proxy and the portal alike — none of
    // which send one. `/health` in particular is NOT matched by the
    // `/health/` prefix rule, which is exactly how it would have been missed.
    const loaded = loadSpec({ OPENAPI_SPEC_PATH: REPO_SPEC })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const document = JSON.parse(loaded.spec.json) as {
      paths: Record<string, { get?: { tags?: string[] } }>
    }

    const operationalPaths = Object.entries(document.paths)
      .filter(([, item]) => item.get?.tags?.includes('operations'))
      .map(([path]) => path)
    expect(operationalPaths).toEqual([
      '/health',
      '/health/live',
      '/health/ready',
      '/openapi.yaml',
      '/openapi.json',
    ])
    for (const path of operationalPaths) {
      expect(isPublicRequest('GET', path), `${path} must be public`).toBe(true)
    }
  })
})
