const sqlite3 = require('sqlite3').verbose()
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const path = require('path')

const dbPath = process.env.DB_PATH || path.join(__dirname, '../database.sqlite')
const db = new sqlite3.Database(dbPath)

async function seedDatabase() {
  console.log('🌱 Seeding database...')

  try {
    // Create admin user
    const adminId = uuidv4()
    const hashedPassword = await bcrypt.hash('admin123', 10)

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO users (id, email, password_hash, first_name, last_name, roles) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          adminId,
          'admin@frontfuse.dev',
          hashedPassword,
          'System',
          'Administrator',
          '["admin", "user"]',
        ],
        function (err) {
          if (err) reject(err)
          else resolve()
        }
      )
    })

    // Create demo user
    const userId = uuidv4()
    const userPassword = await bcrypt.hash('user123', 10)

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO users (id, email, password_hash, first_name, last_name, roles) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          'user@frontfuse.dev',
          userPassword,
          'Demo',
          'User',
          '["user"]',
        ],
        function (err) {
          if (err) reject(err)
          else resolve()
        }
      )
    })

    // Clear existing apps to avoid duplicates
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM apps', function (err) {
        if (err) reject(err)
        else resolve()
      })
    })

    // Create demo apps
    const apps = [
      {
        id: uuidv4(),
        name: 'CRM Dashboard',
        url: 'https://crm.example.com',
        iconUrl: null,
        integrationType: 'module-federation',
        remoteUrl: 'https://crm.example.com',
        scope: 'crmApp',
        module: './App',
        description: 'Customer relationship management system',
      },
      {
        id: uuidv4(),
        name: 'Analytics Portal',
        url: 'https://analytics.example.com',
        iconUrl: '📊',
        integrationType: 'iframe',
        description: 'Business intelligence and analytics dashboard',
      },
      {
        id: uuidv4(),
        name: 'Task Manager',
        url: 'http://localhost:3002',
        iconUrl: null,
        integrationType: 'iframe',
        description:
          'Project and task management application - Local Development',
      },
      {
        id: uuidv4(),
        name: 'HR Portal',
        url: 'https://hr.example.com',
        iconUrl: '👥',
        integrationType: 'web-component',
        description: 'Human resources management portal',
      },
    ]

    for (const app of apps) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO apps (id, name, url, icon_url, integration_type, remote_url, scope, module, description) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            app.id,
            app.name,
            app.url,
            app.iconUrl,
            app.integrationType,
            app.remoteUrl,
            app.scope,
            app.module,
            app.description,
          ],
          function (err) {
            if (err) reject(err)
            else {
              console.log(`📱 Created app: ${app.name} (ID: ${app.id})`)
              resolve()
            }
          }
        )
      })
    }

    console.log('✅ Database seeded successfully!')
    console.log('\n📋 Demo Accounts:')
    console.log('Admin: admin@frontfuse.dev / admin123')
    console.log('User:  user@frontfuse.dev / user123')
    console.log(`\n📱 Created ${apps.length} demo apps`)
  } catch (error) {
    console.error('❌ Error seeding database:', error)
  } finally {
    db.close()
  }
}

seedDatabase()
