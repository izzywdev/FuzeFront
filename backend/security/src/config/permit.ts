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
