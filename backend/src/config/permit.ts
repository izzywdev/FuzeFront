import { Permit } from 'permitio'

interface PermitConfig {
  token: string
  pdp: string
  debug?: boolean
  syncInterval?: number
}

// Load configuration from environment variables
const config: PermitConfig = {
  token: process.env.PERMIT_API_KEY!,
  pdp: process.env.PERMIT_PDP_URL || 'http://localhost:7766',
  debug: process.env.PERMIT_DEBUG === 'true',
  syncInterval: parseInt(process.env.PERMIT_SYNC_INTERVAL || '10000'),
}

// Validate required configuration
if (!config.token) {
  throw new Error('PERMIT_API_KEY environment variable is required')
}

// ─── CI / test no-op mock ────────────────────────────────────────────────────
//
// When running under CI with the well-known dummy key we return a zero-network
// mock that satisfies every call site without opening any TCP connections.
// This prevents the ~49 fire-and-forget permit.api.users.sync() calls that
// each login test triggers from leaving open HTTPS keep-alive sockets that
// block jest from exiting cleanly (the "open handle" problem).
//
// Production (real key) → fall through and create the real SDK instance below.
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
// no-op Proxy and every call to a resolved Promise.  This covers any depth
// of chained permit.api.users.sync(...), permit.check(...), etc.
//
// The proxy is also CONTRACT-SHAPED and FAIL-CLOSED for the decision methods:
//   - permit.check(...)       resolves to `false` (a real boolean, deny)
//   - permit.bulkCheck(arr)   resolves to `arr.map(() => false)` (boolean[])
// so callers that consume the result as a boolean / boolean[] (the
// authorization decision surface) get the correct, deny-by-default value and
// shape with zero network calls — instead of `undefined`, which is merely
// falsy and breaks any `=== false` / `Array.isArray()` / `.length` contract.
// Every other (side-effecting sync) method resolves to `undefined`, matching
// the real SDK's void-ish returns.
//
// `name` is the property name through which this proxy node was reached, so
// `apply` can branch on which SDK method is being invoked.
function makeNoOpProxy(name?: string): any {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      return makeNoOpProxy(typeof prop === 'string' ? prop : undefined)
    },
    apply(_target, _thisArg, args) {
      if (name === 'check') {
        // Authorization decision: fail closed with a real boolean.
        return Promise.resolve(false)
      }
      if (name === 'bulkCheck') {
        // Mirror the real SDK shape: one boolean (deny) per requested check.
        const checks = Array.isArray(args?.[0]) ? args[0] : []
        return Promise.resolve(checks.map(() => false))
      }
      if (name === 'list') {
        // List/read endpoints (e.g. permit.api.roleAssignments.list) return a
        // collection in the real SDK; return an empty array so callers that
        // treat the result as an array keep their contract.
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    },
    construct(_target, _args) {
      return makeNoOpProxy()
    },
  }
  // The target must be a function so the proxy can be both called and have
  // properties accessed on it (i.e. permit.check() AND permit.api.users.sync()).
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
  })
}

// Export permit instance as default
export default permit

// Export configuration for other modules
export { config as permitConfig }

/**
 * Destroy the Permit SDK's underlying axios instance so its HTTP keep-alive
 * agent releases open sockets. Also destroys the Node global HTTP/HTTPS agents
 * so keep-alive sockets from any library (supertest, openid-client, etc.) are
 * released. Call this in jest afterAll to allow jest to exit without --forceExit.
 *
 * In no-op / CI mode the Permit SDK was never created, but the global agent
 * cleanup still runs — it closes any keep-alive sockets that supertest or other
 * HTTP libraries left open during the test suite.
 */
export function destroyPermitClient(): void {
  try {
    if (!isNoOpMode) {
      // Real SDK: also tear down the SDK's own axios instance agents.
      const axiosInstance = (permit as any)?.config?.axiosInstance
      if (axiosInstance?.defaults?.httpAgent) {
        axiosInstance.defaults.httpAgent.destroy()
      }
      if (axiosInstance?.defaults?.httpsAgent) {
        axiosInstance.defaults.httpsAgent.destroy()
      }
    }
    // Always destroy the global Node http/https agents — this closes keep-alive
    // sockets from supertest, axios, openid-client, or any other HTTP library
    // that used the global agent during tests.
    const http = require('http')
    const https = require('https')
    if (http.globalAgent) http.globalAgent.destroy()
    if (https.globalAgent) https.globalAgent.destroy()
  } catch {
    // Non-fatal: best-effort cleanup
  }
}
