#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`)
}

function logHeader(message) {
  log(colors.cyan + colors.bright, `\n🚀 ${message}`)
}

function logStep(step, message) {
  log(colors.yellow, `   ${step}. ${message}`)
}

function logSuccess(message) {
  log(colors.green, `   ✅ ${message}`)
}

function logError(message) {
  log(colors.red, `   ❌ ${message}`)
}

function checkPrerequisites() {
  logHeader('Checking Prerequisites')

  try {
    execSync('node --version', { stdio: 'pipe' })
    logSuccess('Node.js is installed')
  } catch (error) {
    logError('Node.js is not installed. Please install Node.js 18+')
    process.exit(1)
  }

  try {
    execSync('npm --version', { stdio: 'pipe' })
    logSuccess('npm is installed')
  } catch (error) {
    logError('npm is not installed')
    process.exit(1)
  }

  if (!fs.existsSync('package.json')) {
    logError('package.json not found. Please run this from the project root.')
    process.exit(1)
  }

  logSuccess('All prerequisites met')
}

function installDependencies() {
  logHeader('Installing Dependencies')

  try {
    logStep(1, 'Installing root dependencies...')
    execSync('npm install', { stdio: 'inherit' })

    logStep(2, 'Installing workspace dependencies...')
    execSync('npm run install:all', { stdio: 'inherit' })

    logSuccess('All dependencies installed')
  } catch (error) {
    logError('Failed to install dependencies')
    process.exit(1)
  }
}

function initializeDatabase() {
  logHeader('Initializing Database')

  try {
    logStep(1, 'Creating database schema...')
    execSync('npm run db:init', { stdio: 'inherit' })

    logStep(2, 'Seeding with demo data...')
    execSync('npm run db:seed', { stdio: 'inherit' })

    logSuccess('Database initialized')
  } catch (error) {
    logError('Failed to initialize database')
    process.exit(1)
  }
}

function showDemoInstructions() {
  logHeader('Demo Instructions')

  console.log(`
${colors.bright}What this demo will show:${colors.reset}

${colors.cyan}1. Runtime Module Federation${colors.reset}
   • Hub Portal has NO knowledge of apps at build time
   • Task Manager will self-register via REST API
   • Real-time WebSocket notification when app registers

${colors.cyan}2. Dynamic App Loading${colors.reset}
   • Click the 9-dots selector in the top-right
   • See the Task Manager app appear dynamically
   • Click to load it using Module Federation

${colors.cyan}3. Shared Dependencies${colors.reset}
   • React and React-DOM are shared as singletons
   • No duplication, optimal performance
   • Seamless integration between hub and app

${colors.cyan}4. Health Monitoring${colors.reset}
   • Heartbeat system shows real-time app status
   • Green indicators for healthy apps
   • Automatic status updates

${colors.bright}URLs when running:${colors.reset}
   • Hub Portal:    ${colors.blue}http://localhost:5173${colors.reset}
   • Backend API:   ${colors.blue}http://localhost:3001${colors.reset}
   • Task Manager:  ${colors.blue}http://localhost:3002${colors.reset}

${colors.bright}Demo Accounts:${colors.reset}
   • Admin: ${colors.green}admin@frontfuse.dev${colors.reset} / ${colors.green}admin123${colors.reset}
   • User:  ${colors.green}user@frontfuse.dev${colors.reset} / ${colors.green}user123${colors.reset}

${colors.yellow}Press Enter to start the demo, or Ctrl+C to exit...${colors.reset}
`)

  // Wait for user input
  require('child_process').spawnSync('read', ['-p', ''], {
    stdio: 'inherit',
    shell: true,
  })
}

function startDemo() {
  logHeader('Starting FuzeFront Module Federation Demo')

  logStep(1, 'Starting Backend API server...')
  logStep(2, 'Starting Frontend Hub portal...')
  logStep(3, 'Starting Task Manager micro-frontend...')

  console.log(`
${colors.bright}🎯 Demo is starting...${colors.reset}

${colors.cyan}Watch for these events:${colors.reset}
1. Task Manager automatically registers with the hub
2. Real-time notification appears in the hub
3. App becomes available in the 9-dots selector
4. Click to load and experience Module Federation!

${colors.yellow}To stop the demo: Press Ctrl+C${colors.reset}
`)

  try {
    execSync('npm run dev:all', { stdio: 'inherit' })
  } catch (error) {
    // This is expected when user presses Ctrl+C
    logHeader('Demo stopped')
  }
}

function main() {
  console.clear()

  log(
    colors.magenta + colors.bright,
    `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║               🔗 FuzeFront Module Federation Demo           ║
║                                                              ║
║   Runtime App Discovery • Zero Build-time Dependencies      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`
  )

  const action = process.argv[2]

  switch (action) {
    case 'install':
      checkPrerequisites()
      installDependencies()
      break

    case 'setup':
      checkPrerequisites()
      installDependencies()
      initializeDatabase()
      break

    case 'start':
      showDemoInstructions()
      startDemo()
      break

    default:
      checkPrerequisites()
      installDependencies()
      initializeDatabase()
      showDemoInstructions()
      startDemo()
  }
}

if (require.main === module) {
  main()
}
