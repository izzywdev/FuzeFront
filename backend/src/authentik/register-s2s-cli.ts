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
 * On success it prints the client_id (safe to share) and a MASKED client_secret.
 * Retrieve the full secret from the Authentik Admin UI (or the unmasked provider
 * API response) and seal it on the consumer side — never commit or echo it into
 * logs. See docs/runbooks/s2s-client-credentials.md for the full onboarding
 * recipe, including how to grant the resulting service account a Permit
 * `ServiceEndpoint:invoke` permission via `grantServiceInvoke`.
 */

import { registerS2SClient } from './provision-s2s-clients'

function mask(secret: string): string {
  return secret.length > 4 ? `${secret.slice(0, 4)}****` : '****'
}

async function main(): Promise<void> {
  const service = process.argv[2]
  const scopesArg = process.argv[3]
  if (!service || !scopesArg) {
    console.error(
      'Usage: node dist/authentik/register-s2s-cli.js <service-name> <scope1,scope2,...>'
    )
    process.exit(2)
  }

  const scopes = scopesArg.split(',').map(s => s.trim()).filter(Boolean)

  const result = await registerS2SClient(service, scopes)

  console.log('[register-s2s] -------------------------------------------------------')
  console.log(`[register-s2s] S2S machine identity registered for "${result.service}":`)
  console.log(`[register-s2s]   client_id     = ${result.clientId}`)
  console.log(`[register-s2s]   client_secret = ${mask(result.clientSecret)}  (retrieve full value from Authentik + seal on the consumer side)`)
  console.log(`[register-s2s]   aud claim     = ${result.audience}`)
  console.log(`[register-s2s]   scopes claim  = ${result.scopes.join(', ')}`)
  console.log(`[register-s2s]   application   = ${result.applicationSlug}`)
  console.log('[register-s2s] Next: grant this service account a Permit invoke permission —')
  console.log('[register-s2s]   grantServiceInvoke(clientId, "<endpoint-key>") from utils/permit/machine-roles.ts')
  console.log('[register-s2s] -------------------------------------------------------')
}

main().catch(err => {
  console.error('[register-s2s] Registration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
