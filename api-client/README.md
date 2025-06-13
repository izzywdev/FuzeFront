# FuzeFront API Client

[![npm version](https://badge.fury.io/js/%40izzywdev%2Ffuzefront-api-client.svg)](https://badge.fury.io/js/%40izzywdev%2Ffuzefront-api-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript SDK for interacting with the FuzeFront microfrontend platform API.

## 🚀 Quick Start

### Installation

```bash
npm install @izzywdev/fuzefront-api-client
# or
yarn add @izzywdev/fuzefront-api-client
```

### Basic Usage

```typescript
import { FuzeFrontClient } from '@izzywdev/fuzefront-api-client'

// Create client instance
const client = FuzeFrontClient.createForDevelopment()

// Login
const loginResponse = await client.login('admin@frontfuse.dev', 'admin123')
const user = loginResponse.data.user

// Get all applications
const appsResponse = await client.apps.getApps()
const apps = appsResponse.data

// Create a new app
const newApp = await client.apps.createModuleFederationApp({
  name: 'My React App',
  url: 'https://my-app.netlify.app',
  remoteUrl: 'https://my-app.netlify.app/assets/remoteEntry.js',
  scope: 'myApp',
  module: './App',
  description: 'A React microfrontend application',
})
```

## 📖 API Reference

### Client Initialization

#### Create Client Instances

```typescript
// For development (localhost:3001)
const client = FuzeFrontClient.createForDevelopment()

// For production
const client = FuzeFrontClient.createForProduction()

// Custom configuration
const client = new FuzeFrontClient({
  baseURL: 'https://api.example.com',
  timeout: 15000,
  token: 'your-jwt-token', // Optional
})
```

### Authentication (`client.auth`)

#### Login

```typescript
const response = await client.auth.login({
  email: 'user@example.com',
  password: 'password123',
})

// Or use the convenience method
const user = await client.auth.loginAndGetUser({
  email: 'user@example.com',
  password: 'password123',
})
```

#### Get Current User

```typescript
const userResponse = await client.auth.getCurrentUser()
const user = userResponse.data.user
```

#### Logout

```typescript
await client.auth.logout()
```

#### Check Authentication

```typescript
const isAuthenticated = client.auth.isAuthenticated()
const isTokenValid = await client.auth.verifyToken()
```

### Applications (`client.apps`)

#### Get Applications

```typescript
// Get all apps
const allApps = await client.apps.getApps()

// Get only healthy apps
const healthyApps = await client.apps.getHealthyApps()

// Get apps by type
const moduleFedApps = await client.apps.getAppsByType('module-federation')
```

#### Create Applications

```typescript
// Create Module Federation app
const app = await client.apps.createModuleFederationApp({
  name: 'My React App',
  url: 'https://my-app.netlify.app',
  remoteUrl: 'https://my-app.netlify.app/assets/remoteEntry.js',
  scope: 'myApp',
  module: './App',
  iconUrl: 'https://my-app.netlify.app/icon.svg',
  description: 'A React microfrontend application',
})

// Create Iframe app
const iframeApp = await client.apps.createIframeApp({
  name: 'External Dashboard',
  url: 'https://dashboard.example.com',
  iconUrl: 'https://dashboard.example.com/favicon.ico',
  description: 'External dashboard embedded via iframe',
})

// Create with full control
const customApp = await client.apps.createApp({
  name: 'Custom App',
  url: 'https://custom-app.com',
  integrationType: 'web-component',
  description: 'Custom web component app',
})
```

#### Manage Applications

```typescript
// Get specific app
const app = await client.apps.getApp('app-id')

// Update app
const updatedApp = await client.apps.updateApp('app-id', {
  name: 'Updated App Name',
  description: 'Updated description',
})

// Delete app
await client.apps.deleteApp('app-id')

// Send heartbeat
await client.apps.sendHeartbeat('app-id', {
  status: 'online',
  metadata: {
    version: '1.2.3',
    port: 3000,
  },
})
```

### Health Monitoring

```typescript
// Check platform health
const health = await client.getHealth()
const isHealthy = await client.isHealthy()

console.log(health.data)
// {
//   status: 'ok',
//   timestamp: '2023-12-01T10:00:00.000Z',
//   uptime: 3600,
//   version: '1.0.0',
//   environment: 'development',
//   database: { status: 'connected', type: 'PostgreSQL' },
//   memory: { used: 45, total: 128 }
// }
```

## 🔧 Advanced Usage

### Error Handling

```typescript
import { ApiErrorResponse } from '@izzywdev/fuzefront-api-client'

try {
  await client.auth.login({ email: 'wrong@email.com', password: 'wrong' })
} catch (error) {
  if (error instanceof Error && 'response' in error) {
    const apiError = error as ApiErrorResponse
    console.error('API Error:', apiError.response?.data.error)
    console.error('Status Code:', apiError.response?.status)
  }
}
```

### Token Management

```typescript
// Set token manually
client.setToken('your-jwt-token')

// Get current token
const token = client.getToken()

// Clear token
client.clearToken()

// The token is automatically managed during login/logout
await client.login('user@example.com', 'password')
// Token is now set for all subsequent requests

await client.logout()
// Token is now cleared
```

### Custom Headers

```typescript
const client = new FuzeFrontClient({
  baseURL: 'https://api.example.com',
  headers: {
    'X-Custom-Header': 'custom-value',
    'X-Client-Version': '1.0.0',
  },
})
```

### Timeout Configuration

```typescript
const client = new FuzeFrontClient({
  baseURL: 'https://api.example.com',
  timeout: 30000, // 30 seconds
})
```

## 📝 TypeScript Support

The SDK is built with TypeScript and provides full type safety:

```typescript
import { User, App, CreateAppRequest } from '@izzywdev/fuzefront-api-client'

// All responses are properly typed
const userResponse = await client.auth.getCurrentUser()
const user: User = userResponse.data.user // ✅ Fully typed

const appsResponse = await client.apps.getApps()
const apps: App[] = appsResponse.data // ✅ Fully typed

// Request payloads are validated
const newApp: CreateAppRequest = {
  name: 'My App',
  url: 'https://my-app.com',
  integrationType: 'iframe', // ✅ Only valid values accepted
}
```

## 🌐 Environment Configuration

### Development

```typescript
const client = FuzeFrontClient.createForDevelopment()
// Points to http://localhost:3001
```

### Production

```typescript
const client = FuzeFrontClient.createForProduction()
// Points to https://api.frontfuse.dev
```

### Custom Environment

```typescript
const client = FuzeFrontClient.create(process.env.FUZEFRONT_API_URL)
```

## 📚 API Documentation

For complete API documentation, visit your FuzeFront backend's Swagger UI:

- **Development**: http://localhost:3001/api-docs
- **Production**: https://api.frontfuse.dev/api-docs

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Run tests
npm test

# Type checking
npm run type-check

# Linting
npm run lint
```

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- **Documentation**: Visit the Swagger UI at `/api-docs`
- **Issues**: https://github.com/izzywdev/FuzeFront/issues
- **Email**: team@fuzefront.dev
