import { Knex } from 'knex';
export declare let db: Knex;
export declare function initializeDatabaseConnection(): void;
export declare function waitForPostgres(maxRetries?: number, retryDelay?: number, useMigrationCredentials?: boolean): Promise<void>;
export declare function ensureDatabase(useMigrationCredentials?: boolean): Promise<void>;
export declare function runMigrations(): Promise<void>;
export declare function runSeeds(): Promise<void>;
export declare function initializeDatabase(): Promise<void>;
export declare function checkDatabaseHealth(): Promise<boolean>;
export declare function closeDatabase(): Promise<void>;
//# sourceMappingURL=database.d.ts.map