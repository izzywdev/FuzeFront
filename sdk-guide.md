# FuzeFront SDK - Developer Guide

[![npm version](https://badge.fury.io/js/%40izzywdev%2Ffuzefront-sdk-react.svg)](https://badge.fury.io/js/%40izzywdev%2Ffuzefront-sdk-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The **FuzeFront SDK** enables seamless integration of React applications with the FuzeFront microfrontend platform, providing runtime Module Federation, self-registration, heartbeat monitoring, and menu injection capabilities.

## 🚀 Quick Start

### Installation

```bash
npm install @izzywdev/fuzefront-sdk-react
# or
yarn add @izzywdev/fuzefront-sdk-react
```

### Basic Setup

1. **Wrap your app with PlatformProvider**:

```tsx
import React from 'react'
import { PlatformProvider } from '@izzywdev/fuzefront-sdk-react'
import YourApp from './YourApp'

function App() {
  return (
    <PlatformProvider>
      <YourApp />
    </PlatformProvider>
  )
}

export default App
```

2. **Configure Module Federation** (vite.config.ts):

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'your-app',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App',
      },
      shared: ['react', 'react-dom'],
    }),
  ],
  build: {
    target: 'esnext',
  },
})
```

3. **Self-register your app**:

```tsx
import { useEffect } from 'react'
import { registerWithHub, createHeartbeat } from '@izzywdev/fuzefront-sdk-react'

function YourApp() {
  useEffect(() => {
    const register = async () => {
      const appId = await registerWithHub({
        name: 'Your App',
        url: 'http://localhost:3001',
        integrationType: 'module-federation',
        remoteUrl: 'http://localhost:3001/assets/remoteEntry.js',
        scope: 'yourApp',
        module: './App',
        description: 'Your awesome microfrontend',
      })

      if (appId) {
        const heartbeat = createHeartbeat({
          appId,
          backendUrl: 'http://localhost:3003',
          interval: 30000,
        })
        heartbeat.start()
      }
    }

    register()
  }, [])

  return <div>Your App Content</div>
}
```

## 📖 Core Concepts

### 1. **Platform Integration**

FuzeFront supports three integration types:

- **Module Federation**: Dynamic loading with shared dependencies
- **Iframe**: Sandboxed embedding
- **Web Components**: Custom element integration

### 2. **Self-Registration**

Apps can register themselves at runtime:

```typescript
import { registerWithHub } from '@fuzefront/sdk-react'

const appId = await registerWithHub({
  name: 'My App',
  url: 'https://my-app.netlify.app',
  integrationType: 'module-federation',
  remoteUrl: 'https://my-app.netlify.app/assets/remoteEntry.js',
  scope: 'myApp',
  module: './App',
  iconUrl: 'https://my-app.netlify.app/icon.svg',
  description: 'A powerful React microfrontend',
})
```

### 3. **Health Monitoring**

Keep your app alive with heartbeats:

```typescript
import { createHeartbeat } from '@fuzefront/sdk-react'

const heartbeat = createHeartbeat({
  appId: 'your-app-id',
  backendUrl: 'https://api.frontfuse.dev',
  interval: 30000, // 30 seconds
  metadata: {
    version: '1.2.3',
    buildTime: '2023-12-01T10:00:00Z',
    capabilities: ['notifications', 'offline-mode'],
  },
})

heartbeat.start()

// Stop heartbeat when app unmounts
heartbeat.stop()
```

## 🎯 Hooks API

### useCurrentUser

Access current user information:

```tsx
import { useCurrentUser } from '@izzywdev/fuzefront-sdk-react'

function UserProfile() {
  const { user, isAuthenticated, setUser } = useCurrentUser()

  if (!isAuthenticated) {
    return <div>Please log in</div>
  }

  return (
    <div>
      <h1>Welcome, {user.firstName}!</h1>
      <p>Email: {user.email}</p>
      <p>Roles: {user.roles.join(', ')}</p>
    </div>
  )
}
```

### useGlobalMenu

Inject menu items into the platform:

```tsx
import { useGlobalMenu } from '@izzywdev/fuzefront-sdk-react'

function MyApp() {
  const { addAppMenuItems, removeAppMenuItems } = useGlobalMenu()

  useEffect(() => {
    const menuItems = [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: '📊',
        action: () => navigate('/dashboard'),
        order: 1,
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: '⚙️',
        action: () => navigate('/settings'),
        order: 2,
      },
    ]

    addAppMenuItems('my-app-id', menuItems)

    return () => removeAppMenuItems('my-app-id')
  }, [])

  return <div>App Content</div>
}
```

### useSocketBus

Real-time communication between apps:

```tsx
import { useSocketBus } from '@frontfuse/sdk-react'

function NotificationComponent() {
  const { on, emit, isConnected } = useSocketBus()

  useEffect(() => {
    // Listen for notifications
    on('notification', data => {
      console.log('Received notification:', data)
    })

    // Send notification to other apps
    emit(
      'user-action',
      {
        action: 'button-clicked',
        timestamp: Date.now(),
      },
      'target-app-id'
    )
  }, [on, emit])

  return (
    <div>
      Connection status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
    </div>
  )
}
```

## 🔧 Advanced Configuration

### Environment Detection

```typescript
// Check if running in FrontFuse platform
const isPlatformMode = window.__FRONTFUSE_PLATFORM__ === true

// Access platform context
const platformContext = window.__FRONTFUSE_CONTEXT__

if (isPlatformMode) {
  console.log('Running in FrontFuse platform')
  console.log('Current user:', platformContext.user)
  console.log('Available apps:', platformContext.apps)
} else {
  console.log('Running standalone')
}
```

### Custom Error Handling

```tsx
import { PlatformProvider } from '@frontfuse/sdk-react'

function App() {
  const handleError = (error: Error, errorInfo: any) => {
    console.error('Platform error:', error, errorInfo)
    // Send to error tracking service
  }

  return (
    <PlatformProvider onError={handleError}>
      <YourApp />
    </PlatformProvider>
  )
}
```

### Development vs Production

```typescript
const config = {
  hubApiUrl:
    process.env.NODE_ENV === 'production'
      ? 'https://api.frontfuse.dev'
      : 'http://localhost:3003',

  remoteUrl:
    process.env.NODE_ENV === 'production'
      ? 'https://my-app.netlify.app/assets/remoteEntry.js'
      : 'http://localhost:3001/assets/remoteEntry.js',
}
```

## 📱 Integration Examples

### React Router Integration

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useGlobalMenu } from '@frontfuse/sdk-react'

function App() {
  const { addAppMenuItems } = useGlobalMenu()
  const navigate = useNavigate()

  useEffect(() => {
    addAppMenuItems('my-app', [
      {
        id: 'home',
        label: 'Home',
        icon: '🏠',
        action: () => navigate('/'),
        order: 1,
      },
      {
        id: 'products',
        label: 'Products',
        icon: '📦',
        action: () => navigate('/products'),
        order: 2,
      },
    ])
  }, [])

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/products" element={<ProductsPage />} />
    </Routes>
  )
}
```

### State Management Integration

```tsx
import { useCurrentUser } from '@frontfuse/sdk-react'
import { useAppStore } from './store'

function AppWithStore() {
  const { user } = useCurrentUser()
  const setUser = useAppStore(state => state.setUser)

  useEffect(() => {
    if (user) {
      setUser(user)
    }
  }, [user, setUser])

  return <div>App with integrated state</div>
}
```

## 🧪 Testing

### Unit Testing

```tsx
import { render, screen } from '@testing-library/react'
import { PlatformProvider } from '@frontfuse/sdk-react'
import MyComponent from './MyComponent'

// Mock platform context
const mockPlatformContext = {
  user: { id: '1', email: 'test@example.com', roles: ['user'] },
  isAuthenticated: true,
}

test('renders component with platform context', () => {
  render(
    <PlatformProvider value={mockPlatformContext}>
      <MyComponent />
    </PlatformProvider>
  )

  expect(screen.getByText('Welcome')).toBeInTheDocument()
})
```

### E2E Testing

```typescript
// cypress/integration/platform.spec.ts
describe('FrontFuse Integration', () => {
  it('should register app and show in platform', () => {
    cy.visit('http://localhost:3001')
    cy.wait(2000) // Wait for registration

    cy.visit('http://localhost:5173') // Platform URL
    cy.get('[data-testid="app-selector"]').click()
    cy.contains('My App').should('be.visible')
  })
})
```

## 🚀 Deployment

### Building for Production

```bash
# Build your app
npm run build

# The dist folder will contain:
# - assets/remoteEntry.js (Module Federation entry)
# - index.html (standalone version)
# - other assets
```

### Docker Deployment

```dockerfile
FROM node:18-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### CDN Deployment

```typescript
// For CDN deployments, use absolute URLs
const config = {
  remoteUrl: 'https://cdn.example.com/my-app/assets/remoteEntry.js',
  url: 'https://my-app.example.com',
}
```

## 🔍 Troubleshooting

### Common Issues

1. **Module Federation not loading**:

   ```
   Error: Module not found
   ```

   - Check `remoteUrl` is accessible
   - Verify `scope` and `module` names match your config
   - Ensure shared dependencies are configured correctly

2. **Heartbeat failing**:

   ```
   Failed to send heartbeat: 404
   ```

   - Verify `backendUrl` is correct
   - Check if app is registered with correct ID
   - Ensure backend is running and accessible

3. **Menu items not appearing**:
   - Verify app is registered and active
   - Check `addAppMenuItems` is called with correct app ID
   - Ensure component is mounted when calling the hook

### Debug Mode

```typescript
// Enable debug logging
localStorage.setItem('frontfuse:debug', 'true')

// Check platform status
console.log('Platform detected:', window.__FRONTFUSE_PLATFORM__)
console.log('Platform context:', window.__FRONTFUSE_CONTEXT__)
```

## 📚 API Reference

### Types

```typescript
interface User {
  id: string
  email: string
  firstName?: string
  lastName?: string
  roles: string[]
  defaultAppId?: string
}

interface App {
  id: string
  name: string
  url: string
  iconUrl?: string
  isActive: boolean
  isHealthy?: boolean
  integrationType: 'module-federation' | 'iframe' | 'web-component'
  remoteUrl?: string
  scope?: string
  module?: string
  description?: string
}

interface MenuItem {
  id: string
  label: string
  icon?: string
  route?: string
  action?: () => void
  children?: MenuItem[]
  category?: 'portal' | 'app'
  appId?: string
  order?: number
}
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

## 🔗 Links

- [Platform Documentation](https://docs.frontfuse.dev)
- [GitHub Repository](https://github.com/frontfuse/platform)
- [npm Package](https://www.npmjs.com/package/@frontfuse/sdk-react)
- [Discord Community](https://discord.gg/frontfuse)

---

Made with ❤️ by the FrontFuse team
