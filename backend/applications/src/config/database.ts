// Thin re-export shim. The db config + helpers live in @fuzeone/core. Copied
// domain modules import `../config/database` unchanged; this shim forwards to core.
export * from '@fuzeone/core'
