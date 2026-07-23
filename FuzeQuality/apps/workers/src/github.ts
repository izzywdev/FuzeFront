import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { importPKCS8, SignJWT } from 'jose'
import { GITHUB_APP_PERMISSIONS } from '@fuzequality/github-app'

const execFileAsync = promisify(execFile)
const githubIdentifier = /^[A-Za-z0-9_.-]+$/
const immutableCommit = /^[0-9a-f]{40}$/i

type CommandResult = { stdout: string; stderr: string }
type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; windowsHide: boolean }
) => Promise<CommandResult>

export type CheckoutMetrics = {
  outcome: 'success' | 'failure'
  durationMs: number
  repository: string
}

export type CheckoutOptions = {
  owner: string
  name: string
  commitSha: string
  installationId: string
  checkoutRoot?: string
  tokenProvider?: (installationId: string) => Promise<string>
  commandRunner?: CommandRunner
  onMetrics?: (metrics: CheckoutMetrics) => void
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https?:\/\/[^\s@/]+@/gi, 'https://[REDACTED]@')
    .replace(/authorization:\s*basic\s+[^\s,;]+/gi, 'authorization: Basic [REDACTED]')
    .replace(/(token|authorization|password|credential)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000)
}

function emitMetrics(options: CheckoutOptions, metrics: CheckoutMetrics): void {
  try {
    options.onMetrics?.(metrics)
  } catch {
    // Telemetry must never alter checkout state or retry behavior.
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!githubIdentifier.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid GitHub ${label}`)
  }
}

function credentialFreeUrl(owner: string, name: string): string {
  assertIdentifier(owner, 'owner')
  assertIdentifier(name, 'repository name')
  return `https://github.com/${owner}/${name}.git`
}

function checkoutEnvironment(directory: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
  }
}

async function controlledCheckoutRoot(configuredRoot?: string): Promise<string> {
  if (configuredRoot && !isAbsolute(configuredRoot)) throw new Error('Checkout root must be absolute')
  const root = resolve(configuredRoot ?? process.env.FUZEQUALITY_CHECKOUT_ROOT ?? tmpdir())
  await mkdir(root, { recursive: true })
  return realpath(root)
}

export async function githubInstallationToken(installationId: string): Promise<string> {
  if (!/^\d+$/.test(installationId)) throw new Error('Invalid GitHub App installation ID')
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!appId || !privateKey) throw new Error('GitHub App credentials are not configured')
  const now = Math.floor(Date.now() / 1000)
  const key = await importPKCS8(privateKey, 'RS256')
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .setIssuer(appId)
    .sign(key)
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ permissions: GITHUB_APP_PERMISSIONS }),
    }
  )
  if (!response.ok) throw new Error(`GitHub installation token request failed: ${response.status}`)
  const body = (await response.json()) as { token?: string }
  if (!body.token) throw new Error('GitHub installation token response contained no token')
  return body.token
}

/**
 * Fetches exactly one immutable commit into isolated storage. Authentication is
 * passed only as an in-memory HTTP header and is never written to .git/config,
 * process arguments, the repository URL, or returned diagnostics.
 */
export async function checkoutRepository(options: CheckoutOptions): Promise<string> {
  const startedAt = Date.now()
  const repository = `${options.owner}/${options.name}`
  let directory: string | undefined
  try {
    const url = credentialFreeUrl(options.owner, options.name)
    if (!immutableCommit.test(options.commitSha)) {
      throw new Error('An exact 40-character commit SHA is required')
    }
    if (!/^\d+$/.test(options.installationId)) throw new Error('Invalid GitHub App installation ID')

    const root = await controlledCheckoutRoot(options.checkoutRoot)
    directory = await mkdtemp(join(root, 'fuzequality-scan-'))
    const checkoutPath = await realpath(directory)
    const escaped = relative(root, checkoutPath)
    if (escaped.startsWith('..') || isAbsolute(escaped)) throw new Error('Checkout escaped controlled storage')

    const run = options.commandRunner ?? (execFileAsync as unknown as CommandRunner)
    const env = checkoutEnvironment(directory)
    const git = (args: string[], commandEnv = env) =>
      run('git', args, { cwd: directory, env: commandEnv, windowsHide: true })

    await git(['init', '--quiet'])
    await git(['remote', 'add', 'origin', url])

    // Obtain the short-lived credential only immediately before network I/O.
    const token = await (options.tokenProvider ?? githubInstallationToken)(options.installationId)
    const authorization = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`
    await git(
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--depth=1',
        'origin',
        options.commitSha,
      ],
      {
        ...env,
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: authorization,
        GIT_CONFIG_KEY_1: 'credential.helper',
        GIT_CONFIG_VALUE_1: '',
      }
    )
    await git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'])
    const resolvedCommit = (await git(['rev-parse', 'HEAD'])).stdout.trim()
    if (resolvedCommit.toLowerCase() !== options.commitSha.toLowerCase()) {
      throw new Error('Fetched revision did not match requested commit')
    }

    const trackedFiles = (await git(['ls-files', '--stage'])).stdout
    if (trackedFiles.split(/\r?\n/).some(line => line.startsWith('120000 '))) {
      throw new Error('Repository contains symbolic links; checkout rejected')
    }

    emitMetrics(options, { outcome: 'success', durationMs: Date.now() - startedAt, repository })
    return directory
  } catch (error) {
    let cleanupDetail = ''
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true })
      } catch (cleanupError) {
        cleanupDetail = `; cleanup failed: ${safeMessage(cleanupError)}`
      }
    }
    emitMetrics(options, { outcome: 'failure', durationMs: Date.now() - startedAt, repository })
    throw new Error(`Secure checkout failed for ${repository}: ${safeMessage(error)}${cleanupDetail}`)
  }
}
