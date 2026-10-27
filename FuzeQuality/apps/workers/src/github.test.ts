import { access, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scanRequestedSchema } from '@fuzequality/contracts'
import { checkoutRepository, dispatchPerformanceWorkflow, githubWorkflowArtifactEvidence, type CheckoutOptions } from './github'

const sha = '0123456789abcdef0123456789abcdef01234567'

function harness(overrides: Partial<CheckoutOptions> = {}) {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
  const commandRunner = vi.fn(async (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ args, env: options.env })
    if (args[0] === 'rev-parse') return { stdout: `${sha}\n`, stderr: '' }
    if (args[0] === 'ls-files') return { stdout: '100644 abc 0\tREADME.md\n', stderr: '' }
    return { stdout: '', stderr: '' }
  })
  return {
    calls,
    options: {
      owner: 'fuze',
      name: 'sample',
      commitSha: sha,
      installationId: '1234',
      tokenProvider: vi.fn(async () => 'super-secret-token'),
      commandRunner,
      ...overrides,
    } satisfies CheckoutOptions,
  }
}

describe('secure GitHub checkout', () => {
  it('requires every queued remote scan to identify an immutable revision', () => {
    expect(scanRequestedSchema.safeParse({
      repositoryId: '8a87e83d-bc25-4de7-b5b7-b0e96e990810',
      trigger: 'manual',
    }).success).toBe(false)
    expect(scanRequestedSchema.parse({
      repositoryId: '8a87e83d-bc25-4de7-b5b7-b0e96e990810',
      commitSha: sha,
      trigger: 'manual',
    }).commitSha).toBe(sha)
  })

  it('fetches only the requested SHA without persisting the credential', async () => {
    const { calls, options } = harness()
    const directory = await checkoutRepository(options)

    expect(calls.map(call => call.args)).toEqual([
      ['init', '--quiet'],
      ['remote', 'add', 'origin', 'https://github.com/fuze/sample.git'],
      ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', sha],
      ['checkout', '--quiet', '--detach', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
      ['ls-files', '--stage'],
    ])
    expect(JSON.stringify(calls.map(call => call.args))).not.toContain('super-secret-token')
    expect(calls[2].env.GIT_CONFIG_VALUE_0).toContain('Authorization: Basic ')
    expect(calls[1].env.GIT_CONFIG_VALUE_0).toBeUndefined()
    await access(directory)
  })

  it('rejects mutable revisions before requesting a token', async () => {
    const { options } = harness({ commitSha: 'main' })
    await expect(checkoutRepository(options)).rejects.toThrow('exact 40-character commit SHA')
    expect(options.tokenProvider).not.toHaveBeenCalled()
  })

  it('cleans the ephemeral checkout when git fails and redacts diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fq19-test-'))
    const { options } = harness({
      checkoutRoot: root,
      commandRunner: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === 'fetch') throw new Error('authorization=super-secret-token')
        return { stdout: '', stderr: '' }
      }),
    })

    await expect(checkoutRepository(options)).rejects.toThrow('authorization=[REDACTED]')
    expect(await readdir(root)).toEqual([])
  })

  it('rejects symlink entries and cleans the checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fq19-symlink-'))
    const { options } = harness({ checkoutRoot: root })
    options.commandRunner = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: `${sha}\n`, stderr: '' }
      if (args[0] === 'ls-files') return { stdout: '120000 abc 0\tescape\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await expect(checkoutRepository(options)).rejects.toThrow('symbolic links')
    expect(await readdir(root)).toEqual([])
  })

  it('reports bounded success metrics without credentials', async () => {
    const onMetrics = vi.fn()
    const { options } = harness({ onMetrics })
    await checkoutRepository(options)
    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', repository: 'fuze/sample' }))
    expect(JSON.stringify(onMetrics.mock.calls)).not.toContain('super-secret-token')
  })
})

describe('controlled performance workflow dispatch', () => {
  it('revalidates the analyzed branch before dispatching the scanned workflow', async () => {
    const sourceRevision = 'a'.repeat(40)
    const immutableRef = `fuzequality-revision-${sourceRevision}`
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: sourceRevision } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: sourceRevision } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(dispatchPerformanceWorkflow({ owner: 'fuze', name: 'sample', sourceRevision, sourceRef: 'main', installationId: '1234', workflowPath: '.github/workflows/load-test.yml', tokenProvider: async () => 'secret', fetcher })).resolves.toEqual({ ref: immutableRef, sourceRevision })
    expect(fetcher).toHaveBeenNthCalledWith(1, expect.stringContaining('/branches/main'), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }) }))
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.stringContaining(`/git/ref/tags/${immutableRef}`), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }) }))
    expect(fetcher).toHaveBeenNthCalledWith(3, expect.stringContaining('/git/refs'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ ref: `refs/tags/${immutableRef}`, sha: sourceRevision }) }))
    expect(fetcher).toHaveBeenNthCalledWith(4, expect.stringContaining('/actions/workflows/load-test.yml/dispatches'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ ref: immutableRef }) }))
    await expect(dispatchPerformanceWorkflow({ owner: 'fuze', name: 'sample', sourceRevision, sourceRef: 'main', installationId: '1234', workflowPath: '../workflow.yml', tokenProvider: async () => 'secret', fetcher })).rejects.toThrow('Only a scanned')
    await expect(dispatchPerformanceWorkflow({ owner: 'fuze', name: 'sample', sourceRevision, sourceRef: 'main', installationId: '1234', workflowPath: '.github/workflows/nested/load.yml', tokenProvider: async () => 'secret', fetcher })).rejects.toThrow('Only a scanned')
    await expect(dispatchPerformanceWorkflow({ owner: 'fuze', name: 'sample', sourceRevision: 'main', sourceRef: 'main', installationId: '1234', workflowPath: '.github/workflows/load-test.yml', tokenProvider: async () => 'secret', fetcher })).rejects.toThrow('exact analyzed commit')
  })

  it('refuses dispatch when the analyzed branch has advanced', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ commit: { sha: 'b'.repeat(40) } }), { status: 200 }))
    await expect(dispatchPerformanceWorkflow({ owner: 'fuze', name: 'sample', sourceRevision: 'a'.repeat(40), sourceRef: 'feature/load-tests', installationId: '1234', workflowPath: '.github/workflows/load-test.yml', tokenProvider: async () => 'secret', fetcher })).rejects.toThrow('branch has advanced')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('forwards only bounded reviewed workflow inputs', async () => {
    const sourceRevision = 'a'.repeat(40)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: sourceRevision } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: sourceRevision } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await dispatchPerformanceWorkflow({
      owner: 'fuze', name: 'sample', sourceRevision, sourceRef: 'main', installationId: '1234',
      workflowPath: '.github/workflows/load-test.yml', inputs: { environment: 'staging', duration: '5m' },
      tokenProvider: async () => 'secret', fetcher,
    })
    expect(fetcher).toHaveBeenNthCalledWith(3, expect.any(String), expect.objectContaining({
      body: JSON.stringify({ ref: `fuzequality-revision-${sourceRevision}`, inputs: { environment: 'staging', duration: '5m' } }),
    }))
    await expect(dispatchPerformanceWorkflow({
      owner: 'fuze', name: 'sample', sourceRevision, sourceRef: 'main', installationId: '1234',
      workflowPath: '.github/workflows/load-test.yml', inputs: { environment: '' },
      tokenProvider: async () => 'secret', fetcher,
    })).rejects.toThrow('bounded non-empty')
  })

  it('rejects an existing immutable dispatch ref bound to another commit', async () => {
    const sourceRevision = 'a'.repeat(40)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: sourceRevision } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'b'.repeat(40) } }), { status: 200 }))

    await expect(dispatchPerformanceWorkflow({
      owner: 'fuze', name: 'sample', sourceRevision, sourceRef: 'main', installationId: '1234',
      workflowPath: '.github/workflows/load-test.yml', tokenProvider: async () => 'secret', fetcher,
    })).rejects.toThrow('does not match the analyzed commit')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('GitHub workflow artifact evidence', () => {
  it('bounds provider collection and returns a safe timeout code', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))

    const result = githubWorkflowArtifactEvidence({
      owner: 'izzywdev',
      name: 'FuzeFront',
      runId: '4242',
      attempt: 1,
      installationId: '1234',
      tokenProvider: async () => 'secret',
      fetcher,
      timeoutMs: 5,
    })

    await expect(result).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    })
  })

  it('classifies malformed provider responses without exposing their body', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_attempt: 1, run_started_at: '2026-10-18T04:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: 'secret body' }), { status: 200 }))
    await expect(githubWorkflowArtifactEvidence({
      owner: 'izzywdev', name: 'FuzeFront', runId: '4242', installationId: '1234',
      attempt: 1,
      tokenProvider: async () => 'secret', fetcher,
    })).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
      message: 'GitHub workflow artifact response was invalid',
    })
  })

  it('classifies active run artifacts and returns browser-accessible links', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_attempt: 1, run_started_at: '2026-10-18T04:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifacts: [
      { id: 11, name: 'fuzequality-post-prod-playwright-video', expired: false, created_at: '2026-10-18T04:01:00.000Z' },
      { id: 12, name: 'playwright-report', expired: false, created_at: '2026-10-18T04:01:00.000Z' },
      { id: 13, name: 'browser-trace', expired: false, created_at: '2026-10-18T04:01:00.000Z' },
      { id: 14, name: 'failure-screenshots', expired: false, created_at: '2026-10-18T04:01:00.000Z' },
      { id: 15, name: 'service-logs', expired: false, created_at: '2026-10-18T04:01:00.000Z' },
      { id: 16, name: 'raw-artifacts', expired: false, created_at: '2026-10-18T04:01:00.000Z' },
      { id: 17, name: 'expired-video', expired: true },
    ] }), { status: 200 }))

    await expect(githubWorkflowArtifactEvidence({
      owner: 'izzywdev',
      name: 'FuzeFront',
      runId: '4242',
      attempt: 1,
      installationId: '1234',
      tokenProvider: async () => 'secret',
      fetcher,
    })).resolves.toEqual({
      truncated: false,
      unverifiedLinks: [],
      links: [
        { kind: 'video', name: 'fuzequality-post-prod-playwright-video', url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/11' },
        { kind: 'report', name: 'playwright-report', url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/12' },
        { kind: 'trace', name: 'browser-trace', url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/13' },
        { kind: 'screenshot', name: 'failure-screenshots', url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/14' },
        { kind: 'log', name: 'service-logs', url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/15' },
        { kind: 'other', name: 'raw-artifacts', url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/16' },
      ],
    })
    expect(fetcher).toHaveBeenNthCalledWith(2,
      'https://api.github.com/repos/izzywdev/FuzeFront/actions/runs/4242/artifacts?per_page=100',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }), signal: expect.any(AbortSignal) }),
    )
  })

  it('binds a historical retry to its attempt window and withholds artifacts with no provenance', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_attempt: 3, run_started_at: '2026-10-18T06:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_started_at: '2026-10-18T04:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_started_at: '2026-10-18T05:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifacts: [
        { id: 10, name: 'attempt-one-video', expired: false, created_at: '2026-10-18T03:30:00.000Z' },
        { id: 20, name: 'attempt-two-video', expired: false, created_at: '2026-10-18T04:30:00.000Z' },
        { id: 30, name: 'attempt-three-video', expired: false, created_at: '2026-10-18T06:30:00.000Z' },
        { id: 40, name: 'run-video-without-timestamp', expired: false },
      ] }), { status: 200 }))

    await expect(githubWorkflowArtifactEvidence({
      owner: 'izzywdev', name: 'FuzeFront', runId: '4242', attempt: 2, installationId: '1234',
      tokenProvider: async () => 'secret', fetcher,
    })).resolves.toEqual({
      truncated: false,
      links: [{
        kind: 'video', name: 'attempt-two-video',
        url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/20',
      }],
      unverifiedLinks: [{
        kind: 'video', name: 'run-video-without-timestamp',
        url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/40',
      }],
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.stringContaining('/attempts/2'), expect.any(Object))
    expect(fetcher).toHaveBeenNthCalledWith(3, expect.stringContaining('/attempts/3'), expect.any(Object))
  })

  it('finds a Playwright video on a later provider page and marks the locally capped result partial', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `generic-artifact-${String(index + 1).padStart(3, '0')}`,
      expired: false,
      created_at: '2026-10-18T04:01:00.000Z',
    }))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_attempt: 1, run_started_at: '2026-10-18T04:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, artifacts: firstPage }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, artifacts: [
        { id: 101, name: 'post-production-playwright-video', expired: false, created_at: '2026-10-18T04:01:00.000Z' },
      ] }), { status: 200 }))

    const result = await githubWorkflowArtifactEvidence({
      owner: 'izzywdev', name: 'FuzeFront', runId: '4242', installationId: '1234',
      attempt: 1,
      tokenProvider: async () => 'secret', fetcher,
    })

    expect(result.truncated).toBe(true)
    expect(result.links[0]).toMatchObject({ kind: 'video', name: 'post-production-playwright-video' })
    expect(result.links).toHaveLength(99)
    expect(fetcher).toHaveBeenNthCalledWith(3, expect.stringContaining('per_page=100&page=2'), expect.any(Object))
  })

  it('marks evidence partial when provider pagination exceeds the collection bound', async () => {
    const artifacts = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `artifact-${index + 1}`,
      expired: false,
      created_at: '2026-10-18T04:01:00.000Z',
    }))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_attempt: 1, run_started_at: '2026-10-18T04:00:00.000Z' }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({ total_count: 1001, artifacts }), { status: 200 }))

    const result = await githubWorkflowArtifactEvidence({
      owner: 'izzywdev', name: 'FuzeFront', runId: '4242', installationId: '1234',
      attempt: 1,
      tokenProvider: async () => 'secret', fetcher,
    })

    expect(result.truncated).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(11)
  })

  it('rejects invalid run identity before requesting an installation token', async () => {
    const tokenProvider = vi.fn(async () => 'secret')
    await expect(githubWorkflowArtifactEvidence({
      owner: 'izzywdev', name: 'FuzeFront', runId: '../42', installationId: '1234', tokenProvider,
      attempt: 1,
    })).rejects.toThrow('Invalid GitHub Actions run ID')
    expect(tokenProvider).not.toHaveBeenCalled()
  })
})
