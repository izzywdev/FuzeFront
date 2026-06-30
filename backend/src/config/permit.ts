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

// Initialize Permit SDK
const permit = new Permit({
  token: config.token,
  pdp: config.pdp,
  log: {
    level: config.debug ? 'debug' : 'error',
  },
  throwOnError: false,
})

// Export permit instance as default
export default permit

// Export configuration for other modules
export { config as permitConfig }

/**
 * Destroy the Permit SDK's underlying axios instance so its HTTP keep-alive
 * agent releases open sockets. Call this in jest afterAll to allow jest to
 * exit without --forceExit.
 *
 * The Permit SDK creates an axios instance (axios.create()) whose http.Agent
 * defaults to keepAlive in Node ≥ 18. Without explicit destruction those
 * sockets keep the event loop alive after all tests finish.
 */
export function destroyPermitClient(): void {
  try {
    // Access the axios instance via the internal config
    const axiosInstance = (permit as any)?.config?.axiosInstance
    if (axiosInstance?.defaults?.httpAgent) {
      axiosInstance.defaults.httpAgent.destroy()
    }
    if (axiosInstance?.defaults?.httpsAgent) {
      axiosInstance.defaults.httpsAgent.destroy()
    }
    // Also destroy the global Node http/https agents used by axios when no
    // custom agent is set, by clearing the socket pool on axios's adapter.
    const http = require('http')
    const https = require('https')
    if (http.globalAgent) http.globalAgent.destroy()
    if (https.globalAgent) https.globalAgent.destroy()
  } catch {
    // Non-fatal: best-effort cleanup
  }
}
