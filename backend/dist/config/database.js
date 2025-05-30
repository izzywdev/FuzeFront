'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.db = void 0
const sqlite3_1 = __importDefault(require('sqlite3'))
const util_1 = require('util')
const path_1 = __importDefault(require('path'))
const dbPath =
  process.env.DB_PATH || path_1.default.join(__dirname, '../../database.sqlite')
class Database {
  constructor() {
    this.db = new sqlite3_1.default.Database(dbPath)
    this.initializeTables()
  }
  async initializeTables() {
    const runAsync = (0, util_1.promisify)(this.db.run.bind(this.db))
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
  async run(sql, params) {
    return new Promise((resolve, reject) => {
      if (params) {
        this.db.run(sql, params, err => {
          if (err) reject(err)
          else resolve()
        })
      } else {
        this.db.run(sql, err => {
          if (err) reject(err)
          else resolve()
        })
      }
    })
  }
  async get(sql, params) {
    return new Promise((resolve, reject) => {
      if (params) {
        this.db.get(sql, params, (err, row) => {
          if (err) reject(err)
          else resolve(row)
        })
      } else {
        this.db.get(sql, (err, row) => {
          if (err) reject(err)
          else resolve(row)
        })
      }
    })
  }
  async all(sql, params) {
    return new Promise((resolve, reject) => {
      if (params) {
        this.db.all(sql, params, (err, rows) => {
          if (err) reject(err)
          else resolve(rows || [])
        })
      } else {
        this.db.all(sql, (err, rows) => {
          if (err) reject(err)
          else resolve(rows || [])
        })
      }
    })
  }
  close() {
    this.db.close()
  }
}
exports.db = new Database()
//# sourceMappingURL=database.js.map
