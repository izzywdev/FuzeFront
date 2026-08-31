import { Permit } from 'permitio'

interface PermitConfig {
  token: string
  pdp: string
  debug?: boolean
  syncInterval?: number
  apiTimeoutMs: number
}

// Load configuration from environment variables
const config: PermitConfig = {
  token: process.env.PERMIT_API_KEY!,
  pdp: process.env.PERMIT_PDP_URL || 'http://localhost:7766',
  debug: process.env.PERMIT_DEBUG === 'true',
  syncInterval: parseInt(process.env.PERMIT_SYNC_INTERVAL || '10000'),
  // FINDING (izzywdev/FuzeFront authz-live-s2s): this config previously had NO
  // bound on `permit.check()` at all — unlike `backend/src/config/permit.ts`,
  // which was fixed for exactly this in FuzeFront#760 ("permit-schema-sync"
  // hanging forever on a connect-but-never-respond PDP). A `/authz/check` call
  // against an unreachable-but-not-connection-refused PDP would otherwise hang
  // the request indefinitely rather than resolving to an explicit deny within
  // a bounded time — not an "allow", but not the fast, observable "deny" this
  // service's fail-closed contract requires either. `timeout` bounds
  // `permit.check()`/`permit.bulkCheck()` specifically (per the permitio SDK);
  // it does NOT bound `permit.api.*` (resourceInstances/roleAssignments) calls
  // used by grant/revoke — that would need a custom `axiosInstance`, which
  // requires adding `axios` as a dependency of this package (deliberately
  // avoided elsewhere here, see `services/machine-identity.ts`'s header) and
  // is left out of this fix's scope.
  apiTimeoutMs: parseInt(process.env.PERMIT_API_TIMEOUT_MS || '30000'),
}

// Validate required configuration
if (!config.token) {
  throw new Error('PERMIT_API_KEY environment variable is required')
}

// ─── CI / test no-op mock ────────────────────────────────────────────────────
//
// When running under CI with the well-known dummy key we return a zero-network
// mock that satisfies every call site without opening any TCP connections.
//
const CI_DUMMY_KEYS = new Set([
  'ci-no-real-permit-calls',
  'ci-noop',
  'ci-offline-pdp-key',
])

const isNoOpMode =
  CI_DUMMY_KEYS.has(config.token) ||
  (process.env.NODE_ENV === 'test' && !config.token.startsWith('permit_key_'))

// Recursively build a Proxy that resolves every property access to another
// no-op Proxy and every call to a resolved Promise.
function makeNoOpProxy(): any {
  const handler: ProxyHandler<object> = {
    get(_target, _prop) {
      return makeNoOpProxy()
    },
    apply(_target, _thisArg, _args) {
      return Promise.resolve(undefined)
    },
    construct(_target, _args) {
      return makeNoOpProxy()
    },
  }
  return new Proxy(function () {} as any, handler)
}

let permit: any

if (isNoOpMode) {
  // No-op mock — zero network calls, zero open handles.
  permit = makeNoOpProxy()
} else {
  // Initialize real Permit SDK for production / integration-test use.
  permit = new Permit({
    token: config.token,
    pdp: config.pdp,
    log: {
      level: config.debug ? 'debug' : 'error',
    },
    throwOnError: false,
    // Bounds permit.check()/permit.bulkCheck() — see apiTimeoutMs comment above.
    timeout: config.apiTimeoutMs,
  })
}

// Export permit instance as default
export default permit

// Export configuration for other modules
export { config as permitConfig }
