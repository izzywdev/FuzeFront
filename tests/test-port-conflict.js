// Manual harness for the backend's port-conflict fallback: it simply holds
// port 3001 open so the backend can be observed picking 3002 instead.
//
// This deliberately uses Node's `net` rather than express. The harness serves no
// routes and needs no HTTP semantics, so an express app here was both an unused
// dependency and a standing CSRF-middleware finding on an "express application"
// that never handles a request. A bare TCP listener occupies the port
// identically with no framework and nothing to secure.
const net = require('net')

const PORT = Number(process.env.PORT || 3001)

// Accept and immediately drop connections; the point is to own the port.
const server = net.createServer(socket => socket.destroy())

server.on('error', err => {
  console.error('❌ Could not occupy port %s: %s', PORT, err.message)
  process.exit(1)
})

server.listen(PORT, () => {
  console.log('🔒 Test server occupying port %s', PORT)
  console.log('Now try starting the FrontFuse backend in another terminal...')
  console.log(
    'The backend should automatically find port 3002 and start there.'
  )
  console.log('Press Ctrl+C to stop this test server.')
})

// Handle graceful shutdown
const shutdown = () => {
  console.log('\n🛑 Stopping test server...')
  server.close(() => {
    console.log('✅ Test server stopped')
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
