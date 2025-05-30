import sqlite3 from 'sqlite3'
import { promisify } from 'util'
import path from 'path'

const dbPath =
  process.env.DB_PATH || path.join(__dirname, '../../database.sqlite')

class Database {
  private db: sqlite3.Database

  constructor() {
    this.db = new sqlite3.Database(dbPath)
    this.initializeTables()
  }

  private async initializeTables() {
    const runAsync = promisify(this.db.run.bind(this.db))

    // Users table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        first_name TEXT,
        last_name TEXT,
        default_app_id TEXT,
        roles TEXT DEFAULT '["user"]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Apps table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        icon_url TEXT,
        is_active BOOLEAN DEFAULT 1,
        integration_type TEXT DEFAULT 'iframe',
        remote_url TEXT,
        scope TEXT,
        module TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Sessions table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `)

    console.log('Database tables initialized')
  }

  async run(sql: string, params?: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (params) {
        this.db.run(sql, params, (err: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      } else {
        this.db.run(sql, (err: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      }
    })
  }

  async get<T>(sql: string, params?: any[]): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (params) {
        this.db.get(sql, params, (err: Error | null, row: T) => {
          if (err) reject(err)
          else resolve(row)
        })
      } else {
        this.db.get(sql, (err: Error | null, row: T) => {
          if (err) reject(err)
          else resolve(row)
        })
      }
    })
  }

  async all<T>(sql: string, params?: any[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (params) {
        this.db.all(sql, params, (err: Error | null, rows: T[]) => {
          if (err) reject(err)
          else resolve(rows || [])
        })
      } else {
        this.db.all(sql, (err: Error | null, rows: T[]) => {
          if (err) reject(err)
          else resolve(rows || [])
        })
      }
    })
  }

  close(): void {
    this.db.close()
  }
}

export const db = new Database()
