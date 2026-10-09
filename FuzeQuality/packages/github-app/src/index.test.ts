import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  GITHUB_APP_EVENTS,
  GITHUB_APP_PERMISSIONS,
  redactGithubDiagnostic,
  verifyGithubWebhook,
  webhookScanCommands,
  webhookWorkflowExecutions,
} from './index'

const repositories = [{
  id: 'repo-1', owner: 'izzywdev', name: 'FuzeOne', defaultBranch: 'main', installationId: '42',
}]

// Test-only webhook HMAC key (never a production credential); overridable via
// TEST_WEBHOOK_SECRET so the literal is an obviously fake fallback.
const TEST_WEBHOOK_SECRET = process.env.TEST_WEBHOOK_SECRET ?? 'test-only-not-a-real-secret'

describe('FuzeQuality GitHub App contract', () => {
  it('declares the narrowly required workflow dispatch permission and webhook events', () => {
    expect(GITHUB_APP_PERMISSIONS).toEqual({ metadata: 'read', contents: 'read', pull_requests: 'read', actions: 'write' })
    expect(GITHUB_APP_EVENTS).toEqual(['push', 'repository', 'installation', 'installation_repositories', 'workflow_run'])
  })

  it('requires a correctly signed raw payload', () => {
    const payload = Buffer.from('{"ok":true}')
    const signature = `sha256=${createHmac('sha256', TEST_WEBHOOK_SECRET).update(payload).digest('hex')}`
    expect(verifyGithubWebhook(payload, signature, TEST_WEBHOOK_SECRET)).toBe(true)
    // Deliberately empty secret — must still fail closed.
    expect(verifyGithubWebhook(payload, signature, '')).toBe(false)
    expect(verifyGithubWebhook(Buffer.from('{}'), signature, TEST_WEBHOOK_SECRET)).toBe(false)
    expect(verifyGithubWebhook(payload, 'sha1=nope', TEST_WEBHOOK_SECRET)).toBe(false)
  })

  it('queues an exact revision only for a default-branch push', () => {
    const payload = { repository: { full_name: 'izzywdev/FuzeOne', default_branch: 'main' }, ref: 'refs/heads/main', after: 'a'.repeat(40) }
    expect(webhookScanCommands('push', payload, repositories)).toEqual([
      { repositoryId: 'repo-1', commitSha: 'a'.repeat(40), trigger: 'push' },
    ])
    expect(webhookScanCommands('push', { ...payload, ref: 'refs/heads/feature' }, repositories)).toEqual([])
  })

  it('reconciles installations and default-branch changes', () => {
    expect(webhookScanCommands('repository', {
      action: 'edited', repository: { full_name: 'izzywdev/FuzeOne' }, changes: { default_branch: { from: 'master' } },
    }, repositories)).toEqual([{ repositoryId: 'repo-1', trigger: 'reconcile' }])
    expect(webhookScanCommands('installation_repositories', {
      action: 'added', installation: { id: 42 }, repositories_added: [{ full_name: 'izzywdev/FuzeOne' }],
    }, repositories)).toEqual([{ repositoryId: 'repo-1', trigger: 'reconcile' }])
  })

  it('redacts credentials from diagnostics', () => {
    expect(redactGithubDiagnostic('clone https://x-access-token:ghs_secret@github.com/org/repo.git token=abc'))
      .toBe('clone https://github.com/org/repo.git token=[REDACTED]')
  })

  it('maps completed default-branch workflow runs to execution evidence', () => {
    expect(webhookWorkflowExecutions('workflow_run', { action: 'completed', repository: { full_name: 'izzywdev/FuzeOne', default_branch: 'main' }, workflow_run: { id: 101, run_attempt: 2, head_branch: 'main', head_sha: 'a'.repeat(40), name: 'Post-production integration', status: 'completed', conclusion: 'success', html_url: 'https://github.com/izzywdev/FuzeOne/actions/runs/101', run_started_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:01:00.000Z' } }, repositories)).toEqual([expect.objectContaining({ repositoryId: 'repo-1', provider: 'github-actions', externalRunId: '101', attempt: 2, kind: 'post-production', status: 'passed' })])
  })

  it('keeps one run attempt identity while its lifecycle advances', () => {
    const base = {
      repository: { full_name: 'izzywdev/FuzeOne', default_branch: 'main' },
      workflow_run: {
        id: 202, run_attempt: 1, head_branch: 'main', head_sha: 'b'.repeat(40), name: 'Integration suite',
        status: 'in_progress', conclusion: null, html_url: undefined, run_started_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:10.000Z',
      },
    }
    const running = webhookWorkflowExecutions('workflow_run', { action: 'in_progress', ...base }, repositories)[0]
    const completed = webhookWorkflowExecutions('workflow_run', {
      action: 'completed', ...base, workflow_run: { ...base.workflow_run, status: 'completed', conclusion: 'failure', updated_at: '2026-01-01T00:01:00.000Z' },
    }, repositories)[0]
    expect(running).toMatchObject({ externalRunId: '202', attempt: 1, status: 'running', sourceUrl: undefined })
    expect(completed).toMatchObject({ externalRunId: '202', attempt: 1, status: 'failed', sourceUrl: undefined })
  })

  it('retains rerun attempts and fans evidence out to every onboarded tenant copy', () => {
    const tenantCopies = [
      repositories[0],
      { ...repositories[0], id: 'repo-2', installationId: '84' },
    ]
    const payload = {
      action: 'completed',
      repository: { full_name: 'izzywdev/FuzeOne', default_branch: 'main' },
      workflow_run: { id: 303, run_attempt: 3, head_branch: 'main', head_sha: 'c'.repeat(40), name: 'Load test', status: 'completed', conclusion: 'success', run_started_at: null, updated_at: '2026-01-01T00:01:00.000Z' },
    }
    expect(webhookWorkflowExecutions('workflow_run', payload, tenantCopies)).toEqual([
      expect.objectContaining({ repositoryId: 'repo-1', externalRunId: '303', attempt: 3, kind: 'load' }),
      expect.objectContaining({ repositoryId: 'repo-2', externalRunId: '303', attempt: 3, kind: 'load' }),
    ])
  })
})
