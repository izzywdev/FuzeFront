// @fuzefront/core — shared backend bootstrap utilities. Pure config, types,
// auth middleware, and express boilerplate. ZERO business logic. All arrows
// point inward: services depend on core, core never depends on a service.

export * from './config/database'
export * from './middleware/auth'
export * from './types/shared'
export * from './bootstrap'
