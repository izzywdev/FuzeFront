/**
 * register-a2a-cli.ts
 *
 * One-shot CLI to register an A2A machine identity in Authentik. Intended to
 * run IN-CLUSTER (e.g. as a Kubernetes Job or `kubectl exec` in the backend /
 * security pod) where AUTHENTIK_ADMIN_TOKEN + AUTHENTIK_BASE_URL already exist.
 * CLAUDE.md forbids operating prod Authentik from CI / a public host.
 *
 *   node dist/authentik/register-a2a-cli.js <RepoName>
 *   # e.g. node dist/authentik/register-a2a-cli.js FuzeAgent
 *
 * On success it prints the client_id (safe to share — post it on the tracking
 * issue) and a MASKED client_secret. Retrieve the full secret from the
 * Authentik Admin UI (or the unmasked provider API response) and seal it on the
 * FuzeAgent side — never commit or echo it into logs.
 */

import { registerA2AMachineClient } from './provision-a2a-clients'

/**
 * Describe a secret WITHOUT emitting any of its bytes.
 *
 * This previously printed the first 4 characters of the client_secret. An
 * Authentik client_secret is an opaque high-entropy string — unlike a JWT its
 * leading bytes are secret material, not a static header — so a 4-character
 * "mask" is a partial credential disclosure into whatever captures this
 * command's stdout (terminal scrollback, a `kubectl logs` capture, CI output).
 * Shape only.
 */
function mask(secret: string): string {
  return secret ? `(set, ${secret.length} chars — not shown)` : '(not set)'
}

async function main(): Promise<void> {
  const repo = process.argv[2]
  if (!repo) {
    console.error('Usage: node dist/authentik/register-a2a-cli.js <RepoName>')
    process.exit(2)
  }

  const result = await registerA2AMachineClient(repo)

  console.log('[register-a2a] -------------------------------------------------------')
  console.log(`[register-a2a] A2A machine identity registered for "${result.repo}":`)
  console.log(`[register-a2a]   client_id     = ${result.clientId}`)
  console.log(`[register-a2a]   client_secret = ${mask(result.clientSecret)}  (retrieve full value from Authentik + seal on FuzeAgent side)`)
  console.log(`[register-a2a]   repo claim    = ${result.repo}`)
  console.log(`[register-a2a]   aud claim     = ${result.audience}`)
  console.log(`[register-a2a]   application   = ${result.applicationSlug}`)
  console.log('[register-a2a] Wire on the A2A side: callerClaim="repo", audience="a2a".')
  console.log('[register-a2a] -------------------------------------------------------')
}

main().catch(err => {
  console.error('[register-a2a] Registration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
