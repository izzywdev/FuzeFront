import { Knex } from 'knex'
export declare const db: Knex<any, unknown[]>
export declare const initializeDatabase: () => Promise<void>
export declare const closeDatabase: () => Promise<void>
export declare const checkDatabaseHealth: () => Promise<boolean>
export default db
//# sourceMappingURL=database.d.ts.map
