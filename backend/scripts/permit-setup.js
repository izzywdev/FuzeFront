#!/usr/bin/env node

/**
 * Permit.io Setup and Data Sync Script
 *
 * This script helps you set up and sync your FuzeFront data with Permit.io
 *
 * Usage:
 *   node scripts/permit-setup.js [command]
 *
 * Commands:
 *   check     - Check Permit.io connection
 *   sync      - Sync all existing data to Permit.io
 *   user      - Sync a specific user by ID
 *   org       - Sync a specific organization by ID
 */

const path = require('path')

// Set up environment
require('dotenv').config({ path: path.join(__dirname, '../.env') })

async function main() {
  const command = process.argv[2]
  const arg = process.argv[3]

  if (!command) {
    console.log(`
🚀 Permit.io Setup and Data Sync

Usage: node scripts/permit-setup.js [command] [arguments]

Commands:
  check           Check Permit.io connection
  sync            Sync all existing data to Permit.io
  user <userId>   Sync a specific user by ID
  org <orgId>     Sync a specific organization by ID

Examples:
  node scripts/permit-setup.js check
  node scripts/permit-setup.js sync
  node scripts/permit-setup.js user user-123
  node scripts/permit-setup.js org org-456
`)
    process.exit(0)
  }

  try {
    // Dynamic import of ES modules
    const {
      checkPermitConnection,
      syncExistingDataToPermit,
      syncSingleUserToPermit,
      syncSingleOrganizationToPermit,
    } = await import('../dist/utils/permit/sync-existing-data.js')

    switch (command) {
      case 'check':
        console.log('🔍 Checking Permit.io connection...')
        const isConnected = await checkPermitConnection()
        if (isConnected) {
          console.log('✅ Connection successful!')
          process.exit(0)
        } else {
          console.log('❌ Connection failed!')
          process.exit(1)
        }
        break

      case 'sync':
        console.log('🔄 Starting full data sync...')
        await syncExistingDataToPermit()
        console.log('🎉 Sync completed!')
        break

      case 'user':
        if (!arg) {
          console.error('❌ User ID is required')
          console.log('Usage: node scripts/permit-setup.js user <userId>')
          process.exit(1)
        }
        console.log(`🔄 Syncing user ${arg}...`)
        const userResult = await syncSingleUserToPermit(arg)
        if (userResult) {
          console.log('✅ User sync completed!')
          process.exit(0)
        } else {
          console.log('❌ User sync failed!')
          process.exit(1)
        }
        break

      case 'org':
        if (!arg) {
          console.error('❌ Organization ID is required')
          console.log('Usage: node scripts/permit-setup.js org <orgId>')
          process.exit(1)
        }
        console.log(`🔄 Syncing organization ${arg}...`)
        const orgResult = await syncSingleOrganizationToPermit(arg)
        if (orgResult) {
          console.log('✅ Organization sync completed!')
          process.exit(0)
        } else {
          console.log('❌ Organization sync failed!')
          process.exit(1)
        }
        break

      default:
        console.error(`❌ Unknown command: ${command}`)
        console.log('Run without arguments to see usage information')
        process.exit(1)
    }
  } catch (error) {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }
}

// Handle errors gracefully
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled rejection:', error)
  process.exit(1)
})

process.on('uncaughtException', error => {
  console.error('❌ Uncaught exception:', error)
  process.exit(1)
})

main().catch(error => {
  console.error('❌ Main function failed:', error)
  process.exit(1)
})
