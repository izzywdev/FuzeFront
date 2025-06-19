import { Knex } from 'knex'
export declare const db: Knex<any, unknown[]>
export declare function waitForPostgres(
  maxRetries?: number,
  retryDelay?: number
): Promise<void>
export declare function ensureDatabase(): Promise<void>
export declare function runMigrations(): Promise<void>
export declare function runSeeds(): Promise<void>
export declare function initializeDatabase(): Promise<void>
export declare function checkDatabaseHealth(): Promise<boolean>
export declare function closeDatabase(): Promise<void>
export default db
//# sourceMappingURL=database.d.ts.map
