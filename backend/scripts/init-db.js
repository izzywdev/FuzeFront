const sqlite3 = require('sqlite3').verbose()
const path = require('path')

const dbPath = process.env.DB_PATH || path.join(__dirname, '../database.sqlite')
const db = new sqlite3.Database(dbPath)

async function initializeDatabase() {
  console.log('🔧 Initializing database...')

  try {
    // Users table
    await new Promise((resolve, reject) => {
      db.run(
        `
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
      `,
        function (err) {
          if (err) reject(err)
          else resolve()
        }
      )
    })

    // Apps table
    await new Promise((resolve, reject) => {
      db.run(
        `
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
      `,
        function (err) {
          if (err) reject(err)
          else resolve()
        }
      )
    })

    // Sessions table
    await new Promise((resolve, reject) => {
      db.run(
        `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          tenant_id TEXT,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `,
        function (err) {
          if (err) reject(err)
          else resolve()
        }
      )
    })

    console.log('✅ Database initialized successfully!')
  } catch (error) {
    console.error('❌ Error initializing database:', error)
  } finally {
    db.close()
  }
}

initializeDatabase()
