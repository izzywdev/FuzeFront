import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const GITHUB_APP_PERMISSIONS = {
  metadata: 'read',
  contents: 'read',
  pull_requests: 'read',
} as const

export const GITHUB_APP_EVENTS = [
  'push',
  'repository',
  'installation',
  'installation_repositories',
] as const

export const githubWebhookHeadersSchema = z.object({
  event: z.string().min(1),
  delivery: z.string().uuid(),
  signature: z.string().regex(/^sha256=[0-9a-f]{64}$/i),
})

export type OnboardedRepository = {
  id: string
  owner: string
  name: string
  defaultBranch: string
  installationId?: string
}

export type ScanCommand = {
  repositoryId: string
  commitSha?: string
  trigger: 'push' | 'reconcile'
}

type GithubRepository = {
  full_name?: string
  default_branch?: string
}

const pushSchema = z.object({
  ref: z.string(),
  after: z.string().regex(/^[0-9a-f]{40}$/i),
  repository: z.object({
    full_name: z.string(),
    default_branch: z.string(),
  }),
})

const repositorySchema = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string(), default_branch: z.string().optional() }),
  changes: z.object({ default_branch: z.unknown().optional() }).passthrough().optional(),
})

const installationSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repositories: z.array(z.object({ full_name: z.string() })).optional(),
  repositories_added: z.array(z.object({ full_name: z.string() })).optional(),
})

export function verifyGithubWebhook(payload: Buffer, signature: string, secret: string): boolean {
  if (!secret || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', secret).update(payload).digest()
  const actual = Buffer.from(signature.slice(7), 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function webhookScanCommands(
  event: string,
  payload: unknown,
  repositories: OnboardedRepository[]
): ScanCommand[] {
  if (event === 'push') {
    const parsed = pushSchema.safeParse(payload)
    if (!parsed.success) return []
    const repository = findRepository(repositories, parsed.data.repository)
    if (!repository || parsed.data.ref !== `refs/heads/${repository.defaultBranch}`) return []
    return [{ repositoryId: repository.id, commitSha: parsed.data.after, trigger: 'push' }]
  }

  if (event === 'repository') {
    const parsed = repositorySchema.safeParse(payload)
    if (!parsed.success) return []
    const defaultBranchChanged = Boolean(
      parsed.data.action === 'edited' && parsed.data.changes?.default_branch
    )
    const relevantAction = defaultBranchChanged || ['renamed', 'transferred'].includes(parsed.data.action)
    const repository = findRepository(repositories, parsed.data.repository)
    return relevantAction && repository ? [{ repositoryId: repository.id, trigger: 'reconcile' }] : []
  }

  if (event === 'installation' || event === 'installation_repositories') {
    const parsed = installationSchema.safeParse(payload)
    if (!parsed.success || !['created', 'new_permissions_accepted', 'added'].includes(parsed.data.action)) return []
    const names = new Set(
      [...(parsed.data.repositories ?? []), ...(parsed.data.repositories_added ?? [])]
        .map(repository => repository.full_name.toLowerCase())
    )
    return repositories
      .filter(repository => repository.installationId === String(parsed.data.installation.id))
      .filter(repository => !names.size || names.has(`${repository.owner}/${repository.name}`.toLowerCase()))
      .map(repository => ({ repositoryId: repository.id, trigger: 'reconcile' as const }))
  }

  return []
}

function findRepository(repositories: OnboardedRepository[], githubRepository: GithubRepository) {
  const fullName = githubRepository.full_name?.toLowerCase()
  return repositories.find(repository => `${repository.owner}/${repository.name}`.toLowerCase() === fullName)
}

export function redactGithubDiagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message
    .replace(/https:\/\/x-access-token:[^@\s]+@github\.com/gi, 'https://github.com')
    .replace(/(?:token|authorization|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000)
}
