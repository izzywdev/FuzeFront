import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const GITHUB_APP_PERMISSIONS = {
  metadata: 'read',
  contents: 'read',
  pull_requests: 'read',
  actions: 'write',
} as const

export const GITHUB_APP_EVENTS = [
  'push',
  'repository',
  'installation',
  'installation_repositories',
  'workflow_run',
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

export type WorkflowExecutionCommand = {
  repositoryId: string
  provider: 'github-actions'
  externalRunId: string
  attempt: number
  revision: string
  kind: 'ci' | 'integration' | 'post-production' | 'load' | 'stress'
  status: 'passed' | 'failed' | 'cancelled' | 'running'
  name: string
  /** Repository-relative workflow file that produced this run. */
  workflowPath?: string
  sourceUrl?: string
  startedAt?: string
  completedAt?: string
  evidenceLinks: Array<{ kind: 'report'; name: string; url: string }>
  summary?: string
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
const workflowRunSchema = z.object({
  action: z.enum(['requested', 'in_progress', 'completed']),
  repository: z.object({ full_name: z.string(), default_branch: z.string() }),
  workflow_run: z.object({
    id: z.number().int().positive(), run_attempt: z.number().int().positive(),
    head_branch: z.string().nullable(), head_sha: z.string().regex(/^[0-9a-f]{40}$/i), name: z.string().min(1),
    status: z.enum(['queued', 'in_progress', 'completed']), conclusion: z.enum(['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required']).nullable(),
    path: z.string().trim().min(1).max(1000).optional(),
    html_url: z.string().url().optional(), run_started_at: z.string().datetime().nullable(), updated_at: z.string().datetime(),
  }),
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
    return findRepositories(repositories, parsed.data.repository)
      .filter(repository => parsed.data.ref === `refs/heads/${repository.defaultBranch}`)
      .map(repository => ({ repositoryId: repository.id, commitSha: parsed.data.after, trigger: 'push' as const }))
  }

  if (event === 'repository') {
    const parsed = repositorySchema.safeParse(payload)
    if (!parsed.success) return []
    const defaultBranchChanged = Boolean(
      parsed.data.action === 'edited' && parsed.data.changes?.default_branch
    )
    const relevantAction = defaultBranchChanged || ['renamed', 'transferred'].includes(parsed.data.action)
    return relevantAction
      ? findRepositories(repositories, parsed.data.repository).map(repository => ({ repositoryId: repository.id, trigger: 'reconcile' as const }))
      : []
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

/** Maps only default-branch GitHub Actions evidence to immutable execution rows. */
export function webhookWorkflowExecutions(event: string, payload: unknown, repositories: OnboardedRepository[]): WorkflowExecutionCommand[] {
  if (event !== 'workflow_run') return []
  const parsed = workflowRunSchema.safeParse(payload)
  if (!parsed.success || parsed.data.workflow_run.head_branch !== parsed.data.repository.default_branch) return []
  const run = parsed.data.workflow_run
  const kind = workflowExecutionKind(run.name, run.path)
  const status = run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'passed' : run.conclusion === 'cancelled' || run.conclusion === 'skipped' ? 'cancelled' : 'failed'
  return findRepositories(repositories, parsed.data.repository).map(repository => ({
    repositoryId: repository.id,
    provider: 'github-actions' as const,
    externalRunId: String(run.id),
    attempt: run.run_attempt,
    revision: run.head_sha,
    kind,
    status,
    name: run.name,
    workflowPath: run.path,
    sourceUrl: run.html_url,
    startedAt: run.run_started_at ?? undefined,
    completedAt: run.status === 'completed' ? run.updated_at : undefined,
    evidenceLinks: run.html_url ? [{ kind: 'report' as const, name: 'GitHub Actions artifacts', url: `${run.html_url}#artifacts` }] : [],
    summary: run.conclusion ?? undefined,
  }))
}

/** Classifies a run from both its display name and its durable workflow file. */
export function workflowExecutionKind(
  name: string,
  workflowPath?: string,
): WorkflowExecutionCommand['kind'] {
  const evidence = `${name} ${workflowPath ?? ''}`.replace(/[_./-]+/g, ' ')
  if (/\b(?:stress|soak)\b/i.test(evidence)) return 'stress'
  if (/\b(?:load|performance|k6|artillery)\b/i.test(evidence)) return 'load'
  if (/\bpost[-_ ]?prod(?:uction)?\b|\bproduction\b/i.test(evidence)) return 'post-production'
  if (/\bintegration\b/i.test(evidence)) return 'integration'
  return 'ci'
}

function findRepositories(repositories: OnboardedRepository[], githubRepository: GithubRepository) {
  const fullName = githubRepository.full_name?.toLowerCase()
  return repositories.filter(repository => `${repository.owner}/${repository.name}`.toLowerCase() === fullName)
}

export function redactGithubDiagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message
    .replace(/https:\/\/x-access-token:[^@\s]+@github\.com/gi, 'https://github.com')
    .replace(/(token|authorization|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000)
}
