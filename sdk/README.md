# @apphub/sdk-react

React SDK for AppHub microfrontend platform, providing seamless integration with the AppHub container shell and runtime Module Federation capabilities.

## Installation

```bash
npm install @apphub/sdk-react
```

## Quick Start

### 1. Basic Setup

Wrap your microfrontend app with the `PlatformProvider`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { PlatformProvider } from '@apphub/sdk-react'
import App from './App'

const appConfig = {
  id: 'my-app',
  name: 'My Awesome App',
  version: '1.0.0',
  apiUrl: 'https://api.myapp.com',
  wsUrl: 'wss://api.myapp.com',
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <PlatformProvider config={appConfig} fallbackMode={true}>
    <App />
  </PlatformProvider>
)
```

### 2. Using Platform Hooks

```tsx
import React from 'react'
import {
  useCurrentUser,
  useSession,
  useGlobalMenu,
  useSocketBus,
} from '@apphub/sdk-react'

function MyComponent() {
  const { user, isAuthenticated, hasRole } = useCurrentUser()
  const { session, tenantId } = useSession()
  const { addMenuItem } = useGlobalMenu()
  const socket = useSocketBus()

  React.useEffect(() => {
    // Add custom menu item
    addMenuItem({
      id: 'my-feature',
      label: 'My Feature',
      icon: '⭐',
      action: () => console.log('Feature clicked!'),
    })

    // Listen for platform events
    socket.on('user-updated', userData => {
      console.log('User updated:', userData)
    })

    // Send events to other apps
    socket.emit('data-changed', { type: 'customer', id: 123 })
  }, [])

  if (!isAuthenticated) {
    return <div>Please log in</div>
  }

  return (
    <div>
      <h1>Welcome, {user?.firstName}!</h1>
      <p>Tenant: {tenantId}</p>
      <p>Admin Access: {hasRole('admin') ? 'Yes' : 'No'}</p>
    </div>
  )
}
```

## API Reference

### PlatformProvider

The main provider component that sets up platform context and handles fallback mode for standalone development.

```tsx
<PlatformProvider config={appConfig} fallbackMode={isDevelopment}>
  <App />
</PlatformProvider>
```

**Props:**

- `config: AppConfig` - App configuration object
- `fallbackMode?: boolean` - Enable standalone development mode (default: false)

### useCurrentUser()

Hook for accessing current user information and authentication state.

```tsx
const {
  user, // User object or null
  setUser, // Function to update user
  isAuthenticated, // Boolean auth status
  hasRole, // Function to check user roles
} = useCurrentUser()
```

### useSession()

Hook for accessing session information.

```tsx
const {
  session, // Session object or null
  setSession, // Function to update session
  tenantId, // Current tenant ID
  isExpired, // Boolean session expiry status
} = useSession()
```

### useGlobalMenu()

Hook for managing the platform's global navigation menu.

```tsx
const {
  menuItems, // Array of current menu items
  setMenuItems, // Replace all menu items
  addMenuItem, // Add a single menu item
  removeMenuItem, // Remove menu item by ID
  updateMenuItem, // Update existing menu item
} = useGlobalMenu()
```

**Menu Item Structure:**

```tsx
interface MenuItem {
  id: string
  label: string
  icon?: string
  route?: string
  action?: () => void
  children?: MenuItem[]
  visible?: boolean
}
```

### useSocketBus()

Hook for real-time communication between microfrontends.

```tsx
const {
  on, // Subscribe to events
  emit, // Send events
  isConnected, // Connection status
} = useSocketBus('my-app-id')

// Listen for events
socket.on('eventType', payload => {
  console.log('Received:', payload)
})

// Send events
socket.emit('eventType', { data: 'value' }, 'target-app-id')
```

### Module Federation Loader

Functions for dynamically loading federated modules at runtime.

```tsx
import { loadApp, clearModuleCache } from '@apphub/sdk-react'

// Load a federated module
const module = await loadApp({
  remoteUrl: 'https://my-remote-app.com',
  scope: 'myRemoteApp',
  module: './App',
})

// Clear cache (useful for development)
clearModuleCache()
```

## Development Mode

The SDK includes a fallback mode for standalone development when not running inside the AppHub platform:

```tsx
<PlatformProvider
  config={appConfig}
  fallbackMode={process.env.NODE_ENV === 'development'}
>
  <App />
</PlatformProvider>
```

In fallback mode:

- Mock user and session data is provided
- Socket events are logged to console
- Platform detection is disabled

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```tsx
import type {
  User,
  Session,
  App,
  MenuItem,
  AppConfig,
  SocketBus,
} from '@apphub/sdk-react'
```

## Integration Examples

### Adding Custom Navigation

```tsx
function MyApp() {
  const { addMenuItem, removeMenuItem } = useGlobalMenu()

  React.useEffect(() => {
    // Add menu items when component mounts
    addMenuItem({
      id: 'reports',
      label: 'Reports',
      icon: '📊',
      children: [
        {
          id: 'sales-report',
          label: 'Sales Report',
          action: () => navigate('/reports/sales'),
        },
        {
          id: 'analytics',
          label: 'Analytics',
          action: () => navigate('/reports/analytics'),
        },
      ],
    })

    // Cleanup when component unmounts
    return () => {
      removeMenuItem('reports')
    }
  }, [])
}
```

### Cross-App Communication

```tsx
function CustomerComponent() {
  const socket = useSocketBus()

  const handleCustomerUpdate = (customerId: string) => {
    // Notify other apps about customer update
    socket.emit('customer-updated', {
      customerId,
      timestamp: Date.now(),
    })
  }

  React.useEffect(() => {
    // Listen for customer updates from other apps
    socket.on('customer-updated', ({ customerId }) => {
      console.log(`Customer ${customerId} was updated by another app`)
      // Refresh customer data
      refetchCustomerData(customerId)
    })
  }, [])
}
```

### Role-Based Features

```tsx
function AdminPanel() {
  const { hasRole } = useCurrentUser()

  if (!hasRole('admin')) {
    return <div>Access denied</div>
  }

  return (
    <div>
      <h2>Admin Panel</h2>
      {/* Admin-only features */}
    </div>
  )
}
```

## Best Practices

1. **Always wrap your app** with `PlatformProvider`
2. **Use fallback mode** during development
3. **Clean up menu items** when components unmount
4. **Namespace your events** to avoid conflicts
5. **Handle authentication state** gracefully
6. **Use TypeScript** for better development experience

## Troubleshooting

### Common Issues

**Module Federation not working:**

- Ensure your webpack config includes Module Federation plugin
- Check that remote entry URLs are accessible
- Verify scope and module names match your configuration

**Socket events not received:**

- Check WebSocket URL configuration
- Verify authentication tokens are valid
- Ensure event names match between sender and receiver

**Menu items not appearing:**

- Check if you're calling `addMenuItem` after component mount
- Verify menu item IDs are unique
- Ensure `visible` property is not set to `false`

### Debug Mode

Enable debug logging:

```tsx
// In your app initialization
window.__APPHUB_DEBUG__ = true
```

This will provide additional console logging for SDK operations.

## Contributing

Issues and pull requests are welcome! Please see the main repository for contribution guidelines.

## License

MIT
