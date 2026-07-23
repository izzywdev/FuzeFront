import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  GITHUB_APP_EVENTS,
  GITHUB_APP_PERMISSIONS,
  redactGithubDiagnostic,
  verifyGithubWebhook,
  webhookScanCommands,
} from './index'

const repositories = [{
  id: 'repo-1', owner: 'izzywdev', name: 'FuzeOne', defaultBranch: 'main', installationId: '42',
}]

describe('FuzeQuality GitHub App contract', () => {
  it('declares only the approved read permissions and webhook events', () => {
    expect(GITHUB_APP_PERMISSIONS).toEqual({ metadata: 'read', contents: 'read', pull_requests: 'read' })
    expect(GITHUB_APP_EVENTS).toEqual(['push', 'repository', 'installation', 'installation_repositories'])
  })

  it('requires a correctly signed raw payload', () => {
    const payload = Buffer.from('{"ok":true}')
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(payload).digest('hex')}`
    expect(verifyGithubWebhook(payload, signature, 'test-secret')).toBe(true)
    expect(verifyGithubWebhook(payload, signature, '')).toBe(false)
    expect(verifyGithubWebhook(Buffer.from('{}'), signature, 'test-secret')).toBe(false)
    expect(verifyGithubWebhook(payload, 'sha1=nope', 'test-secret')).toBe(false)
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
})
