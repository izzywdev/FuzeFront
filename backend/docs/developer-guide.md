# FrontFuse Developer Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Getting Started](#getting-started)
4. [Creating Your First App](#creating-your-first-app)
5. [Integration Types](#integration-types)
6. [Module Federation Setup](#module-federation-setup)
7. [Using the FrontFuse SDK](#using-the-frontfuse-sdk)
8. [User Session Management](#user-session-management)
9. [Menu Integration](#menu-integration)
10. [Deployment Guide](#deployment-guide)
11. [Best Practices](#best-practices)
12. [Troubleshooting](#troubleshooting)

## Introduction

FrontFuse is a microfrontend hosting platform that enables you to build, deploy, and manage federated applications seamlessly. This guide will walk you through creating and deploying your own pluggable applications.

## Architecture Overview

FrontFuse uses a hub-and-spoke architecture where:

- **Platform Core**: The main portal that hosts and manages all applications
- **Federated Apps**: Independent applications that integrate with the platform
- **SDK**: Shared utilities and context for seamless integration
- **API**: Backend services for authentication, app management, and communication

### Key Components

- **Module Federation**: For dynamic loading of React applications
- **JWT Authentication**: Secure user sessions across all apps
- **WebSocket Communication**: Real-time updates and notifications
- **Shared Context**: User data, menu items, and platform state

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- React 18+ knowledge
- Basic understanding of Module Federation
- Git for version control

### Development Environment Setup

1. **Clone the FrontFuse repository**:

   ```bash
   git clone https://github.com/your-org/frontfuse.git
   cd frontfuse
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Start the development environment**:

   ```bash
   # Terminal 1 - Backend
   npm run dev:backend

   # Terminal 2 - Frontend
   npm run dev:frontend

   # Terminal 3 - Example app (optional)
   npm run dev:task-manager
   ```

4. **Access the platform**:
   - Platform: http://localhost:5173
   - API Docs: http://localhost:3001/api-docs
   - Task Manager Example: http://localhost:3002

## Creating Your First App

### 1. Project Setup

Create a new React application with Vite:

```bash
npm create vite@latest my-frontfuse-app -- --template react-ts
cd my-frontfuse-app
npm install
```

### 2. Install FrontFuse SDK

```bash
npm install @frontfuse/sdk
```

### 3. Configure Module Federation

Install the Module Federation plugin:

```bash
npm install @originjs/vite-plugin-federation --save-dev
```

Update your `vite.config.ts`:

```typescript
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
        './App': './src/App.tsx',
      },
      shared: ['react', 'react-dom'],
    }),
  ],
  build: {
    modulePreload: false,
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
})
```

### 4. Basic App Structure

Update your `src/App.tsx`:

```typescript
import React, { useEffect } from 'react'
import { PlatformProvider, useCurrentUser, useGlobalMenu } from '@frontfuse/sdk'

function AppContent() {
  const { user, isAuthenticated } = useCurrentUser()
  const { addAppMenuItems, removeAppMenuItems } = useGlobalMenu()

  useEffect(() => {
    // Register menu items when app loads
    if (isAuthenticated) {
      addAppMenuItems('myApp', [
        {
          id: 'my-dashboard',
          label: 'My Dashboard',
          path: '/my-dashboard',
          icon: '📊',
          category: 'app',
          appId: 'myApp',
          order: 1
        },
        {
          id: 'my-settings',
          label: 'Settings',
          path: '/my-settings',
          icon: '⚙️',
          category: 'app',
          appId: 'myApp',
          order: 2
        }
      ])
    }

    // Cleanup on unmount
    return () => {
      removeAppMenuItems('myApp')
    }
  }, [isAuthenticated, addAppMenuItems, removeAppMenuItems])

  if (!isAuthenticated) {
    return <div>Please log in to access this application.</div>
  }

  return (
    <div className="my-app">
      <h1>Welcome to My App, {user?.firstName}!</h1>
      <p>Your email: {user?.email}</p>
      <p>Your roles: {user?.roles?.join(', ')}</p>

      {/* Your app content here */}
    </div>
  )
}

function App() {
  return (
    <PlatformProvider>
      <AppContent />
    </PlatformProvider>
  )
}

export default App
```

### 5. Package.json Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "dev": "vite --port 3003",
    "build": "tsc && vite build",
    "preview": "vite preview --port 3003",
    "serve": "vite preview --port 3003"
  }
}
```

## Integration Types

FrontFuse supports three integration types:

### 1. Module Federation (Recommended)

- **Best for**: React applications
- **Pros**: Shared dependencies, seamless integration, optimal performance
- **Cons**: Requires build configuration

### 2. Iframe

- **Best for**: Legacy applications, non-React apps
- **Pros**: Technology agnostic, easy integration
- **Cons**: Limited communication, styling challenges

### 3. Web Components

- **Best for**: Framework-agnostic components
- **Pros**: Standard-based, reusable
- **Cons**: Limited React integration

## Module Federation Setup

### Advanced Configuration

For production-ready Module Federation:

```typescript
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
        './App': './src/App.tsx',
        './routes': './src/routes.tsx', // Optional: expose routing
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18.0.0',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.0.0',
        },
        '@frontfuse/sdk': {
          singleton: true,
        },
      },
    }),
  ],
  build: {
    modulePreload: false,
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    rollupOptions: {
      external: ['react', 'react-dom'],
    },
  },
  server: {
    port: 3003,
    cors: true,
  },
})
```

### Error Boundaries

Implement error boundaries for robust federation:

```typescript
// src/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Microfrontend error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong in this application.</h2>
          <details>
            <summary>Error details</summary>
            <pre>{this.state.error?.stack}</pre>
          </details>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
```

## Using the FrontFuse SDK

### Available Hooks

#### useCurrentUser

```typescript
import { useCurrentUser } from '@frontfuse/sdk'

function MyComponent() {
  const { user, isAuthenticated, isLoading } = useCurrentUser()

  if (isLoading) return <div>Loading...</div>
  if (!isAuthenticated) return <div>Please log in</div>

  return <div>Hello, {user.firstName}!</div>
}
```

#### useGlobalMenu

```typescript
import { useGlobalMenu } from '@frontfuse/sdk'

function MyComponent() {
  const {
    addAppMenuItems,
    removeAppMenuItems,
    portalMenuItems,
    appMenuItems
  } = useGlobalMenu()

  // Add menu items
  const handleAddMenu = () => {
    addAppMenuItems('myApp', [
      {
        id: 'new-item',
        label: 'New Feature',
        path: '/new-feature',
        icon: '✨',
        category: 'app',
        appId: 'myApp'
      }
    ])
  }

  return <button onClick={handleAddMenu}>Add Menu Item</button>
}
```

#### useAppContext

```typescript
import { useAppContext } from '@frontfuse/sdk'

function MyComponent() {
  const { state, dispatch } = useAppContext()

  // Access platform state
  const { user, apps, menuItems } = state

  return <div>Platform has {apps.length} apps</div>
}
```

## User Session Management

### Accessing User Data

```typescript
import { useCurrentUser } from '@frontfuse/sdk'

function UserProfile() {
  const { user, isAuthenticated } = useCurrentUser()

  if (!isAuthenticated) {
    return <div>Please log in</div>
  }

  return (
    <div className="user-profile">
      <h2>{user.firstName} {user.lastName}</h2>
      <p>Email: {user.email}</p>
      <p>Roles: {user.roles.join(', ')}</p>
      <p>User ID: {user.id}</p>
    </div>
  )
}
```

### Storing User-Specific Data

```typescript
import { useCurrentUser } from '@frontfuse/sdk'

function useUserStorage(key: string) {
  const { user } = useCurrentUser()

  const userKey = user ? `${key}_${user.id}` : key

  const setItem = (value: any) => {
    localStorage.setItem(userKey, JSON.stringify(value))
  }

  const getItem = () => {
    const item = localStorage.getItem(userKey)
    return item ? JSON.parse(item) : null
  }

  const removeItem = () => {
    localStorage.removeItem(userKey)
  }

  return { setItem, getItem, removeItem }
}

// Usage
function MyComponent() {
  const { setItem, getItem } = useUserStorage('myAppData')

  const saveData = () => {
    setItem({ preferences: { theme: 'dark' } })
  }

  const loadData = () => {
    const data = getItem()
    console.log('User data:', data)
  }

  return (
    <div>
      <button onClick={saveData}>Save Data</button>
      <button onClick={loadData}>Load Data</button>
    </div>
  )
}
```

## Menu Integration

### Menu Item Structure

```typescript
interface MenuItem {
  id: string
  label: string
  path: string
  icon?: string
  category: 'portal' | 'app' | 'system'
  appId?: string
  order?: number
  roles?: string[]
  isActive?: boolean
}
```

### Dynamic Menu Management

```typescript
import { useGlobalMenu, useCurrentUser } from '@frontfuse/sdk'
import { useEffect } from 'react'

function MenuManager() {
  const { addAppMenuItems, removeAppMenuItems } = useGlobalMenu()
  const { user, isAuthenticated } = useCurrentUser()

  useEffect(() => {
    if (!isAuthenticated) return

    const menuItems = [
      {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/dashboard',
        icon: '📊',
        category: 'app' as const,
        appId: 'myApp',
        order: 1,
      },
    ]

    // Add admin-only items
    if (user?.roles?.includes('admin')) {
      menuItems.push({
        id: 'admin-panel',
        label: 'Admin Panel',
        path: '/admin',
        icon: '⚙️',
        category: 'app' as const,
        appId: 'myApp',
        order: 10,
      })
    }

    addAppMenuItems('myApp', menuItems)

    // Cleanup
    return () => removeAppMenuItems('myApp')
  }, [isAuthenticated, user?.roles, addAppMenuItems, removeAppMenuItems])

  return null
}
```

## Deployment Guide

### 1. Build Your Application

```bash
npm run build
```

### 2. Deploy to Static Hosting

#### Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist
```

#### Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

#### AWS S3 + CloudFront

```bash
# Build and sync to S3
npm run build
aws s3 sync dist/ s3://your-bucket-name --delete
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

### 3. Register Your App

Once deployed, register your app with FrontFuse:

```bash
curl -X POST http://localhost:3001/api/apps \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "My App",
    "url": "https://my-app.netlify.app",
    "iconUrl": "https://my-app.netlify.app/icon.svg",
    "integrationType": "module-federation",
    "remoteUrl": "https://my-app.netlify.app/assets/remoteEntry.js",
    "scope": "myApp",
    "module": "./App",
    "description": "My awesome microfrontend application"
  }'
```

### 4. Environment Configuration

Create environment-specific configurations:

```typescript
// src/config/index.ts
const config = {
  development: {
    apiUrl: 'http://localhost:3001',
    appUrl: 'http://localhost:3003',
  },
  production: {
    apiUrl: 'https://api.frontfuse.dev',
    appUrl: 'https://my-app.netlify.app',
  },
}

export default config[process.env.NODE_ENV || 'development']
```

## Best Practices

### 1. Performance Optimization

- **Lazy Loading**: Load components only when needed
- **Code Splitting**: Split your app into smaller chunks
- **Shared Dependencies**: Use Module Federation shared dependencies
- **Caching**: Implement proper caching strategies

```typescript
// Lazy loading example
import { lazy, Suspense } from 'react'

const LazyComponent = lazy(() => import('./LazyComponent'))

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LazyComponent />
    </Suspense>
  )
}
```

### 2. Error Handling

- Always wrap your app in error boundaries
- Implement graceful fallbacks
- Log errors for debugging

### 3. Security

- Validate user permissions before rendering sensitive content
- Sanitize user inputs
- Use HTTPS in production

```typescript
// Permission checking
function AdminPanel() {
  const { user } = useCurrentUser()

  if (!user?.roles?.includes('admin')) {
    return <div>Access denied</div>
  }

  return <div>Admin content</div>
}
```

### 4. Testing

```typescript
// src/__tests__/App.test.tsx
import { render, screen } from '@testing-library/react'
import { PlatformProvider } from '@frontfuse/sdk'
import App from '../App'

// Mock the SDK
jest.mock('@frontfuse/sdk', () => ({
  PlatformProvider: ({ children }: any) => children,
  useCurrentUser: () => ({
    user: { firstName: 'Test', email: 'test@example.com', roles: ['user'] },
    isAuthenticated: true
  }),
  useGlobalMenu: () => ({
    addAppMenuItems: jest.fn(),
    removeAppMenuItems: jest.fn()
  })
}))

test('renders app content', () => {
  render(<App />)
  expect(screen.getByText(/Welcome to My App, Test!/)).toBeInTheDocument()
})
```

## Troubleshooting

### Common Issues

#### 1. Module Federation Loading Errors

```
Error: Loading chunk failed
```

**Solution**: Check that your `remoteUrl` is correct and accessible.

#### 2. Shared Dependency Conflicts

```
Error: Shared module is not available for eager consumption
```

**Solution**: Ensure shared dependencies are properly configured in both host and remote.

#### 3. Authentication Issues

```
User is undefined
```

**Solution**: Ensure your app is wrapped in `PlatformProvider` and the user is logged in.

#### 4. Menu Items Not Appearing

**Solution**: Check that you're calling `addAppMenuItems` after authentication and with the correct format.

### Debug Mode

Enable debug mode in development:

```typescript
// src/App.tsx
if (process.env.NODE_ENV === 'development') {
  window.__FRONTFUSE_DEBUG__ = true
}
```

### Health Check Endpoint

Implement a health check for your app:

```typescript
// src/health.ts
export const healthCheck = () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: process.env.npm_package_version || '1.0.0',
})

// Expose via HTTP endpoint if needed
```

## Support

- **Documentation**: https://docs.frontfuse.dev
- **GitHub Issues**: https://github.com/your-org/frontfuse/issues
- **Discord Community**: https://discord.gg/frontfuse
- **Email Support**: support@frontfuse.dev

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

FrontFuse is licensed under the MIT License. See [LICENSE](LICENSE) for details.
