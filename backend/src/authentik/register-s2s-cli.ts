/**
 * register-s2s-cli.ts
 *
 * One-shot CLI to register a platform S2S (service-to-service) machine identity
 * in Authentik — izzywdev/FuzeFront#648. Intended to run IN-CLUSTER (e.g. as a
 * Kubernetes Job or `kubectl exec` in the backend pod) where AUTHENTIK_ADMIN_TOKEN
 * + AUTHENTIK_BASE_URL already exist. CLAUDE.md forbids operating prod Authentik
 * from CI / a public host. Mirrors register-a2a-cli.ts's shape.
 *
 *   node dist/authentik/register-s2s-cli.js <service-name> <scope1,scope2,...>
 *   # e.g. node dist/authentik/register-s2s-cli.js fuzecall-backend fuzecall:control-plane:auth
 *
 *   # ...and, for an automated in-cluster handoff, with the credentials written
 *   # to a file instead of a human copying them out of the Admin UI:
 *   node dist/authentik/register-s2s-cli.js billing-service authz:admin \
 *     --write-env-file /run/s2s/s2s.env
 *
 * On success it prints the client_id (safe to share) and a MASKED client_secret.
 *
 * WITHOUT --write-env-file the full secret must be retrieved from the Authentik
 * Admin UI (or the unmasked provider API response) and sealed on the consumer
 * side — never commit or echo it into logs.
 *
 * WITH --write-env-file the full secret is written to that path, in `KEY=value`
 * env-file form, mode 0600, and STILL never printed. This is what lets a
 * Kubernetes Job hand the credential straight to `kubectl create secret
 * --from-env-file` in the same pod, so the secret is generated and consumed
 * entirely inside the cluster: it never passes through a terminal, a CI log, a
 * GitHub repo secret, or a PR diff. See
 * deploy/helm/fuzefront/templates/billing-s2s-register-job.yaml.
 *
 * See docs/runbooks/s2s-client-credentials.md for the full onboarding recipe,
 * including how to grant the resulting service account a Permit
 * `ServiceEndpoint:invoke` permission via `grantServiceInvoke`.
 */

import { registerS2SClient } from './provision-s2s-clients'
import { parseArgs, writeCredentialsEnvFile } from './s2s-credentials-file'

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
  const { positionals, writeEnvFile } = parseArgs(process.argv.slice(2))
  const service = positionals[0]
  const scopesArg = positionals[1]
  if (!service || !scopesArg) {
    console.error(
      'Usage: node dist/authentik/register-s2s-cli.js <service-name> <scope1,scope2,...> ' +
        '[--write-env-file <path>]'
    )
    process.exit(2)
  }

  const scopes = scopesArg.split(',').map(s => s.trim()).filter(Boolean)

  const result = await registerS2SClient(service, scopes)

  if (writeEnvFile) {
    writeCredentialsEnvFile(writeEnvFile, {
      clientId: result.clientId,
      clientSecret: result.clientSecret,
    })
  }

  console.log('[register-s2s] -------------------------------------------------------')
  console.log(`[register-s2s] S2S machine identity registered for "${result.service}":`)
  console.log(`[register-s2s]   client_id     = ${result.clientId}`)
  console.log(`[register-s2s]   client_secret = ${mask(result.clientSecret)}  (retrieve full value from Authentik + seal on the consumer side)`)
  console.log(`[register-s2s]   aud claim     = ${result.audience}`)
  console.log(`[register-s2s]   scopes claim  = ${result.scopes.join(', ')}`)
  console.log(`[register-s2s]   application   = ${result.applicationSlug}`)
  if (writeEnvFile) {
    console.log(`[register-s2s]   credentials   = written to ${writeEnvFile} (mode 0600, not shown)`)
  }
  console.log('[register-s2s] Next: grant this service account a Permit invoke permission —')
  console.log('[register-s2s]   grantServiceInvoke(clientId, "<endpoint-key>") from utils/permit/machine-roles.ts')
  console.log('[register-s2s] -------------------------------------------------------')
}

main().catch(err => {
  console.error('[register-s2s] Registration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
