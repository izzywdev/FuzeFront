'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.permitConfig = void 0
const permitio_1 = require('permitio')
// Load configuration from environment variables
const config = {
  token: process.env.PERMIT_API_KEY,
  pdp: process.env.PERMIT_PDP_URL || 'http://localhost:7766',
  debug: process.env.PERMIT_DEBUG === 'true',
  syncInterval: parseInt(process.env.PERMIT_SYNC_INTERVAL || '10000'),
}
exports.permitConfig = config
// Validate required configuration
if (!config.token) {
  throw new Error('PERMIT_API_KEY environment variable is required')
}
// Initialize Permit SDK
const permit = new permitio_1.Permit({
  token: config.token,
  pdp: config.pdp,
  log: {
    level: config.debug ? 'debug' : 'error',
  },
  throwOnError: false,
})
// Export permit instance as default
exports.default = permit
//# sourceMappingURL=permit.js.map
