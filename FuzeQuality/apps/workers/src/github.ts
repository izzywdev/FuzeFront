import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { importPKCS8, SignJWT } from 'jose'
import { GITHUB_APP_PERMISSIONS, redactGithubDiagnostic } from '@fuzequality/github-app'

const execute = promisify(execFile)

export async function githubInstallationToken(installationId: string) {
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
  const body = (await response.json()) as { token: string }
  return body.token
}

export async function checkoutRepository(options: {
  owner: string
  name: string
  branch: string
  commitSha?: string
  installationId: string
}) {
  const token = await githubInstallationToken(options.installationId)
  const directory = await mkdtemp(join(tmpdir(), 'fuzequality-scan-'))
  const url = `https://github.com/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.name)}.git`
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  const gitEnvironment = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  }
  try {
    await execute('git', ['clone', '--depth', '1', '--branch', options.branch, url, directory], {
      windowsHide: true,
      env: gitEnvironment,
    })
    if (options.commitSha) {
      await execute('git', ['fetch', '--depth', '1', 'origin', options.commitSha], { cwd: directory, windowsHide: true, env: gitEnvironment })
      await execute('git', ['checkout', '--detach', options.commitSha], { cwd: directory, windowsHide: true, env: gitEnvironment })
    }
  } catch (error) {
    throw new Error(`GitHub checkout failed: ${redactGithubDiagnostic(error)}`)
  }
  return directory
}
