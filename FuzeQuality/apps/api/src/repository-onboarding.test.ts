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
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const verifier = createGitHubAccessVerifier(async () => 'installation-token-for-test')

    const result = await verifier.verify({ installationId: '42', owner: 'izzywdev', name: 'FuzeOne', defaultBranch: 'master' })

    expect(result).toEqual({
      canonicalUrl: 'https://github.com/izzywdev/FuzeOne', defaultBranch: 'master', private: true,
      permissions: { contents: 'read', metadata: 'read' },
    })
    expect(JSON.stringify(result)).not.toContain('installation-token-for-test')
    expect(fetchMock.mock.calls[1][0]).toContain('/branches/master')
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
})
