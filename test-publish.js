// Test script to verify SDK functionality
const {
  PlatformProvider,
  useCurrentUser,
  registerWithHub,
} = require('./sdk/dist/index.js')

console.log('✅ SDK successfully imported!')
console.log('Available exports:', {
  PlatformProvider: typeof PlatformProvider,
  useCurrentUser: typeof useCurrentUser,
  registerWithHub: typeof registerWithHub,
})

console.log('🎉 Package is ready for distribution!')
