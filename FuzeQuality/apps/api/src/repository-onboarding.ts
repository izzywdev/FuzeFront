import type { RepositoryInput } from '@fuzequality/contracts'

export interface RepositoryAccess {
  canonicalUrl: string
  defaultBranch: string
  commitSha: string
  private: boolean
  permissions: { contents: 'read' | 'write' | 'admin'; metadata: 'read' }
}

export interface RepositoryAccessVerifier {
  verify(input: Pick<RepositoryInput, 'owner' | 'name' | 'defaultBranch'> & { installationId: string }): Promise<RepositoryAccess>
}

export class RepositoryAccessError extends Error {
  constructor(public readonly code: 'NOT_ACCESSIBLE' | 'BRANCH_NOT_FOUND' | 'UPSTREAM_UNAVAILABLE') {
    super(code)
  }
}

export function createGitHubAccessVerifier(tokenForInstallation: (installationId: string) => Promise<string>): RepositoryAccessVerifier {
  return {
    async verify(input) {
      let token: string
      try {
        token = await tokenForInstallation(input.installationId)
      } catch {
        throw new RepositoryAccessError('UPSTREAM_UNAVAILABLE')
      }
      const headers = {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      }
      const repositoryUrl = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`
      let repositoryResponse: Response
      try {
        repositoryResponse = await fetch(repositoryUrl, { headers })
      } catch {
        throw new RepositoryAccessError('UPSTREAM_UNAVAILABLE')
      }
      if (repositoryResponse.status === 404 || repositoryResponse.status === 403) {
        throw new RepositoryAccessError('NOT_ACCESSIBLE')
      }
      if (!repositoryResponse.ok) throw new RepositoryAccessError('UPSTREAM_UNAVAILABLE')
      const repository = await repositoryResponse.json() as {
        html_url?: string
        default_branch?: string
        private?: boolean
        permissions?: { pull?: boolean; push?: boolean; admin?: boolean }
      }
      let branchResponse: Response
      try {
        branchResponse = await fetch(`${repositoryUrl}/branches/${encodeURIComponent(input.defaultBranch)}`, { headers })
      } catch {
        throw new RepositoryAccessError('UPSTREAM_UNAVAILABLE')
      }
      if (branchResponse.status === 404) throw new RepositoryAccessError('BRANCH_NOT_FOUND')
      if (!branchResponse.ok) throw new RepositoryAccessError('UPSTREAM_UNAVAILABLE')
      const branch = await branchResponse.json() as { commit?: { sha?: string } }
      const commitSha = branch.commit?.sha
      if (!commitSha || !/^[0-9a-f]{40}$/i.test(commitSha)) {
        throw new RepositoryAccessError('UPSTREAM_UNAVAILABLE')
      }
      // GitHub App installation tokens can report every legacy repository
      // permission flag as false even when the app has read-only Contents
      // access. Successful repository and branch reads are the authoritative
      // access proof; the token was already minted with read-only permissions.
      return {
        canonicalUrl: repository.html_url ?? `https://github.com/${input.owner}/${input.name}`,
        defaultBranch: repository.default_branch ?? input.defaultBranch,
        commitSha,
        private: repository.private ?? true,
        permissions: {
          contents: repository.permissions?.admin ? 'admin' : repository.permissions?.push ? 'write' : 'read',
          metadata: 'read',
        },
      }
    },
  }
}

export function publicAccessError(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof RepositoryAccessError) {
    if (error.code === 'UPSTREAM_UNAVAILABLE') return { status: 503, body: { error: 'Repository access verification is temporarily unavailable', code: error.code } }
    return { status: 422, body: { error: 'The GitHub App cannot access the requested repository and branch', code: error.code } }
  }
  return { status: 500, body: { error: 'Repository access verification failed', code: 'VERIFICATION_FAILED' } }
}
