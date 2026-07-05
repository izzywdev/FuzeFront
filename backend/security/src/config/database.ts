// Thin re-export shim. The db config + helpers now live in @fuzefront/core so
// every backend service shares one implementation. Copied domain modules import
// `../config/database` unchanged; this shim forwards to core.
export * from '@fuzefront/core'
