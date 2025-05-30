declare class Database {
  private db
  constructor()
  private initializeTables
  run(sql: string, params?: any[]): Promise<void>
  get<T>(sql: string, params?: any[]): Promise<T | undefined>
  all<T>(sql: string, params?: any[]): Promise<T[]>
  close(): void
}
export declare const db: Database
export {}
//# sourceMappingURL=database.d.ts.map
