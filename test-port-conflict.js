const express = require('express')
const app = express()

// Create a simple server to occupy port 3001
const server = app.listen(3001, () => {
  console.log('🔒 Test server occupying port 3001')
  console.log('Now try starting the FrontFuse backend in another terminal...')
  console.log(
    'The backend should automatically find port 3002 and start there.'
  )
  console.log('Press Ctrl+C to stop this test server.')
})

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping test server...')
  server.close(() => {
    console.log('✅ Test server stopped')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Stopping test server...')
  server.close(() => {
    console.log('✅ Test server stopped')
    process.exit(0)
  })
})
