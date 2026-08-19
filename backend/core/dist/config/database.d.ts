import { Knex } from 'knex';
/**
 * Options each service passes so it can own its own migrations table + dirs.
 *
 * - `migrationsTableName` — per-service knex migrations table. Defaults to
 *   'knex_migrations' (security-service keeps the original chain's table;
 *   applications-service passes 'knex_migrations_apps').
 * - `migrationsDir` / `seedsDir` — absolute paths to the SERVICE's migration
 *   and seed directories. Because @fuzefront/core is compiled into each
 *   service's node_modules, it cannot derive these from its own __dirname — the
 *   consuming service must supply them (e.g. path.join(__dirname, '../migrations')).
 */
export interface DatabaseConfigOptions {
    migrationsTableName?: string;
    migrationsDir?: string;
    seedsDir?: string;
}
export declare function getDatabaseConfig(options?: DatabaseConfigOptions): Knex.Config;
export declare let db: Knex;
/**
 * Initialize the module-level options so subsequent helper calls (runMigrations,
 * runSeeds, initializeDatabaseConnection) use the service's table/dirs without
 * having to thread the options through every call site.
 */
export declare function configureDatabase(options: DatabaseConfigOptions): void;
export declare function initializeDatabaseConnection(options?: DatabaseConfigOptions): void;
export declare function waitForPostgres(maxRetries?: number, retryDelay?: number): Promise<void>;
/**
 * Poll the application database until a given table exists. Used by
 * applications-service so it does not run its `organization_id` FK migration
 * before security-service has created the `organizations` table on a fresh
 * cluster. In-process — no initContainer involved.
 */
export declare function waitForTable(tableName: string, maxRetries?: number, retryDelay?: number): Promise<void>;
export declare function ensureDatabase(): Promise<void>;
export declare function runMigrations(options?: DatabaseConfigOptions): Promise<void>;
export declare function runSeeds(options?: DatabaseConfigOptions): Promise<void>;
/**
 * Full in-process bootstrap used by services that own schema (security,
 * applications). The thin backend must NOT call this — it owns no schema and
 * only needs waitForPostgres + initializeDatabaseConnection + checkDatabaseHealth.
 */
export declare function initializeDatabase(options?: DatabaseConfigOptions): Promise<void>;
export declare function checkDatabaseHealth(): Promise<boolean>;
export declare function closeDatabase(): Promise<void>;
//# sourceMappingURL=database.d.ts.map