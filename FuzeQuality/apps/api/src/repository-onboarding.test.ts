import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGitHubAccessVerifier, publicAccessError, RepositoryAccessError } from './repository-onboarding'

describe('FQ-18 repository access verification', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('verifies installation access and the configured branch without exposing credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        html_url: 'https://github.com/izzywdev/FuzeOne',
        default_branch: 'master', private: true, permissions: { pull: true },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'a'.repeat(40) } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        truncated: false,
        tree: [
          { type: 'blob', path: 'services/auth/openapi.yaml' },
          { type: 'blob', path: 'src/index.ts' },
          { type: 'blob', path: 'config/swagger.config.ts' },
        ],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const verifier = createGitHubAccessVerifier(async () => 'installation-token-for-test')

    const result = await verifier.verify({ installationId: '42', owner: 'izzywdev', name: 'FuzeOne', defaultBranch: 'master' })

    expect(result).toEqual({
      canonicalUrl: 'https://github.com/izzywdev/FuzeOne', defaultBranch: 'master', private: true,
      commitSha: 'a'.repeat(40),
      permissions: { contents: 'read', metadata: 'read' },
      openApiCandidates: ['config/swagger.config.ts', 'services/auth/openapi.yaml'],
      candidatePreviewComplete: true,
    })
    expect(JSON.stringify(result)).not.toContain('installation-token-for-test')
    expect(fetchMock.mock.calls[1][0]).toContain('/branches/master')
    expect(fetchMock.mock.calls[2][0]).toContain(`/git/trees/${'a'.repeat(40)}?recursive=1`)
  })

  it('returns a redacted access error for a missing branch', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: { pull: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 })))
    const verifier = createGitHubAccessVerifier(async () => 'redaction-test-token')
    let failure: unknown
    try { await verifier.verify({ installationId: '42', owner: 'o', name: 'n', defaultBranch: 'missing' }) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(RepositoryAccessError)
    expect(publicAccessError(failure)).toEqual({
      status: 422,
      body: { error: 'The GitHub App cannot access the requested repository and branch', code: 'BRANCH_NOT_FOUND' },
    })
    expect(JSON.stringify(publicAccessError(failure))).not.toContain('redaction-test-token')
  })

  it('accepts successful read-only GitHub App responses with false legacy permission flags', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        html_url: 'https://github.com/izzywdev/FuzeFront',
        default_branch: 'master',
        private: false,
        permissions: { admin: false, push: false, pull: false },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'b'.repeat(40) } }), { status: 200 })))
    const verifier = createGitHubAccessVerifier(async () => 'read-only-installation-token')

    await expect(verifier.verify({
      installationId: '42',
      owner: 'izzywdev',
      name: 'FuzeFront',
      defaultBranch: 'master',
    })).resolves.toMatchObject({
      commitSha: 'b'.repeat(40),
      permissions: { contents: 'read', metadata: 'read' },
    })
  })
})
