# FuzeFront Developer Guide

Complete guide for building microfrontend applications with FuzeFront platform.

## 📦 Available Packages

### 1. **React SDK** - `@izzywdev/fuzefront-sdk-react`

For React microfrontend applications with platform integration.

### 2. **API Client** - `@izzywdev/fuzefront-api-client`

For direct API communication from any JavaScript/TypeScript application.

## 🚀 Quick Setup Guide

### Option A: Building a React Microfrontend

Perfect for applications that will be embedded in the FuzeFront platform.

```bash
npm install @izzywdev/fuzefront-sdk-react
```

```tsx
// App.tsx
import React from 'react'
import { PlatformProvider, useCurrentUser } from '@izzywdev/fuzefront-sdk-react'

function App() {
  return (
    <PlatformProvider>
      <MyMicrofrontend />
    </PlatformProvider>
  )
}

function MyMicrofrontend() {
  const { user, isAuthenticated } = useCurrentUser()

  if (!isAuthenticated) {
    return <div>Please login through the platform</div>
  }

  return (
    <div>
      <h1>Welcome {user.firstName}!</h1>
      <p>Your app content here...</p>
    </div>
  )
}

export default App
```

### Option B: Building a Standalone Application

Perfect for admin tools, external services, or standalone applications.

```bash
npm install @izzywdev/fuzefront-api-client
```

```typescript
// api.ts
import { FuzeFrontClient } from '@izzywdev/fuzefront-api-client'

const client = FuzeFrontClient.createForDevelopment()

// Login
const loginResponse = await client.login('admin@frontfuse.dev', 'admin123')
const user = loginResponse.data.user

// Manage applications
const apps = await client.apps.getApps()
const newApp = await client.apps.createModuleFederationApp({
  name: 'My New App',
  url: 'https://my-app.com',
  remoteUrl: 'https://my-app.com/remoteEntry.js',
  scope: 'myApp',
  module: './App',
})
```

## 🔧 Advanced Usage: Using Both Together

For maximum flexibility, use both packages in a single application:

```bash
npm install @izzywdev/fuzefront-sdk-react @izzywdev/fuzefront-api-client
```

```tsx
// hooks/useApi.ts
import { useMemo } from 'react'
import { FuzeFrontClient } from '@izzywdev/fuzefront-api-client'
import { useCurrentUser } from '@izzywdev/fuzefront-sdk-react'

export function useApi() {
  const { user, isAuthenticated } = useCurrentUser()

  const client = useMemo(() => {
    const apiClient = FuzeFrontClient.createForDevelopment()

    // If we have a user session, we might have a token
    if (isAuthenticated && user.token) {
      apiClient.setToken(user.token)
    }

    return apiClient
  }, [isAuthenticated, user])

  return client
}

// components/AppManager.tsx
import React, { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { App } from '@izzywdev/fuzefront-api-client'

export function AppManager() {
  const client = useApi()
  const [apps, setApps] = useState<App[]>([])

  useEffect(() => {
    async function loadApps() {
      try {
        const response = await client.apps.getApps()
        setApps(response.data)
      } catch (error) {
        console.error('Failed to load apps:', error)
      }
    }

    loadApps()
  }, [client])

  const handleCreateApp = async () => {
    try {
      const newApp = await client.apps.createIframeApp({
        name: 'New Dashboard',
        url: 'https://dashboard.example.com',
      })
      setApps([...apps, newApp.data])
    } catch (error) {
      console.error('Failed to create app:', error)
    }
  }

  return (
    <div>
      <h2>Application Manager</h2>
      <button onClick={handleCreateApp}>Add New App</button>

      <div className="apps-grid">
        {apps.map(app => (
          <div key={app.id} className="app-card">
            <h3>{app.name}</h3>
            <p>{app.description}</p>
            <span className={app.isHealthy ? 'healthy' : 'unhealthy'}>
              {app.isHealthy ? '✅ Healthy' : '❌ Unhealthy'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

## 🌐 Environment Configuration

### Development Environment

```typescript
// For React SDK
const platformConfig = {
  backendUrl: 'http://localhost:3001',
  // React SDK auto-detects development mode
}

// For API Client
const client = FuzeFrontClient.createForDevelopment()
// Points to http://localhost:3001
```

### Production Environment

```typescript
// For React SDK - configure via environment variables
// REACT_APP_FUZEFRONT_BACKEND_URL=https://api.frontfuse.dev

// For API Client
const client = FuzeFrontClient.createForProduction()
// Points to https://api.frontfuse.dev
```

### Custom Environment

```typescript
// React SDK
<PlatformProvider config={{
  backendUrl: process.env.REACT_APP_API_URL
}}>

// API Client
const client = new FuzeFrontClient({
  baseURL: process.env.REACT_APP_API_URL,
  timeout: 15000
});
```

## 📚 API Documentation

### Interactive Documentation (Swagger UI)

- **Development**: http://localhost:3001/api-docs
- **Production**: https://api.frontfuse.dev/api-docs

### Package Documentation

- **React SDK**: [SDK README](https://github.com/izzywdev/FuzeFront/blob/main/sdk/README.md)
- **API Client**: [API Client README](https://github.com/izzywdev/FuzeFront/blob/main/api-client/README.md)

## 🔐 Authentication Patterns

### Pattern 1: Platform-Managed Auth (React SDK)

```tsx
// The platform handles authentication
function MyApp() {
  const { user, isAuthenticated } = useCurrentUser()

  // User is automatically authenticated by the platform
  if (!isAuthenticated) return <div>Loading...</div>

  return <div>Hello {user.firstName}!</div>
}
```

### Pattern 2: Direct Authentication (API Client)

```typescript
// Manual authentication for standalone apps
const client = FuzeFrontClient.createForProduction()

async function loginUser(email: string, password: string) {
  try {
    const response = await client.login(email, password)
    localStorage.setItem('auth-token', response.data.token)
    return response.data.user
  } catch (error) {
    console.error('Login failed:', error)
    throw error
  }
}
```

### Pattern 3: Token Sharing

```tsx
// Share authentication between React SDK and API Client
function useSharedAuth() {
  const { user } = useCurrentUser()
  const client = useApi()

  useEffect(() => {
    // If React SDK has auth, share it with API client
    if (user?.token) {
      client.setToken(user.token)
    }
  }, [user, client])

  return { user, client }
}
```

## 🚀 Deployment Examples

### Module Federation App (remoteEntry.js)

```javascript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'myApp',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App',
      },
      shared: ['react', 'react-dom'],
    }),
  ],
})
```

### Self-Registration Example

```tsx
// App.tsx - Auto-register with the platform
import { useEffect } from 'react'
import { registerWithHub, createHeartbeat } from '@izzywdev/fuzefront-sdk-react'

function App() {
  useEffect(() => {
    async function registerApp() {
      const appId = await registerWithHub({
        name: 'My Awesome App',
        url: window.location.origin,
        integrationType: 'module-federation',
        remoteUrl: `${window.location.origin}/assets/remoteEntry.js`,
        scope: 'myApp',
        module: './App',
        description: 'My awesome microfrontend application',
      })

      if (appId) {
        const heartbeat = createHeartbeat({
          appId,
          backendUrl: 'https://api.frontfuse.dev',
          interval: 30000,
        })
        heartbeat.start()
      }
    }

    registerApp()
  }, [])

  return <YourAppContent />
}
```

## 📊 Monitoring & Health Checks

### App Health Monitoring

```typescript
// Send periodic health updates
const client = FuzeFrontClient.createForProduction()

setInterval(async () => {
  await client.apps.sendHeartbeat('your-app-id', {
    status: 'online',
    metadata: {
      version: '1.2.3',
      uptime: Date.now() - startTime,
      memory: process.memoryUsage().heapUsed,
      activeUsers: getActiveUserCount(),
    },
  })
}, 30000)
```

### Platform Health Check

```typescript
// Check if the platform is healthy
const isHealthy = await client.isHealthy()
const health = await client.getHealth()

console.log('Platform Status:', health.data.status)
console.log('Database:', health.data.database?.status)
console.log('Memory Usage:', health.data.memory)
```

## 🛠️ Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure your app URL is registered in the platform
2. **Authentication Issues**: Check token validity with `client.auth.verifyToken()`
3. **Module Federation**: Verify `remoteUrl` is accessible and correctly formatted
4. **Health Checks**: Ensure heartbeat endpoint is reachable

### Debug Mode

```typescript
// Enable debug logging
const client = new FuzeFrontClient({
  baseURL: 'http://localhost:3001',
  timeout: 30000,
  headers: {
    'X-Debug': 'true',
  },
})
```

## 🤝 Support

- **Swagger API Docs**: http://localhost:3001/api-docs
- **GitHub Issues**: https://github.com/izzywdev/FuzeFront/issues
- **Email**: team@fuzefront.dev

---

**Ready to build amazing microfrontends? Start with the pattern that fits your needs! 🚀**
