# FrontFuse Module Federation Implementation Guide

This guide demonstrates how to implement a complete module federation system with runtime app registration using FrontFuse.

## Architecture Overview

FrontFuse implements a **runtime module federation** system where:

1. **Hub Portal** (Frontend) - Acts as the container application that dynamically loads micro-frontends
2. **Backend API** - Manages app registry and provides WebSocket notifications
3. **Micro-frontends** - Independent applications that can self-register and be loaded dynamically
4. **SDK** - Provides utilities for module federation, heartbeat, and communication

## Key Features

- ✅ **Runtime App Discovery** - Apps register themselves at runtime, no build-time knowledge required
- ✅ **Dynamic Module Loading** - Load micro-frontends on-demand using Module Federation
- ✅ **Self-Registration** - Apps can register themselves with the hub via REST API
- ✅ **Health Monitoring** - Heartbeat system to track app availability
- ✅ **WebSocket Notifications** - Real-time updates when apps register/change status
- ✅ **Docker Support** - Containerized deployment for micro-frontends
- ✅ **Shared Dependencies** - Efficient sharing of React and other dependencies

## Quick Start

### 1. Start the FrontFuse Platform

```bash
# Install dependencies
npm run install:all

# Initialize database
npm run db:init

# Start backend and frontend
npm run dev
```

### 2. Create a New Micro-frontend

```bash
# Create new Vite React app
npm create vite@latest my-app -- --template react-ts
cd my-app

# Install module federation plugin
npm install @originjs/vite-plugin-federation --save-dev

# Install FrontFuse SDK
npm install @frontfuse/sdk-react
```

### 3. Configure Module Federation

Update `vite.config.ts`:

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
        './MyApp': './src/App',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18.0.0',
        } as any,
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.0.0',
        } as any,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3003, // Use unique port
    cors: true,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
})
```

### 4. Add Self-Registration

Create `src/registration.ts`:

```typescript
import { createHeartbeat } from '@frontfuse/sdk-react'

export async function registerWithHub() {
  const hubApiUrl = 'http://localhost:3001'

  try {
    const response = await fetch(`${hubApiUrl}/api/apps/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'My App',
        url: 'http://localhost:3003',
        integrationType: 'module-federation',
        remoteUrl: 'http://localhost:3003',
        scope: 'myApp',
        module: './MyApp',
        description: 'My awesome micro-frontend',
      }),
    })

    if (response.ok) {
      const app = await response.json()
      console.log('✅ Registered with FrontFuse hub:', app)

      // Start heartbeat
      const heartbeat = createHeartbeat({
        appId: app.id,
        backendUrl: hubApiUrl,
        interval: 30000,
      })
      heartbeat.start()

      return app.id
    }
  } catch (error) {
    console.error('❌ Registration failed:', error)
  }
}

export async function autoRegister() {
  // Only register when running standalone
  if (
    window.location.port === '3003' &&
    (!window.parent || window.parent === window)
  ) {
    await registerWithHub()
  }
}
```

Update `src/main.tsx`:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { autoRegister } from './registration'

// Auto-register with FrontFuse hub
autoRegister().catch(console.error)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### 5. Build and Run

```bash
# Development
npm run dev

# Production build
npm run build
npm run preview
```

## Docker Deployment

### 1. Create Dockerfile

```dockerfile
# Multi-stage build for production
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3003
CMD ["nginx", "-g", "daemon off;"]
```

### 2. Create nginx.conf

```nginx
server {
    listen 3003;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Enable CORS for module federation
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;

    # Serve static files
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Special handling for remoteEntry.js
    location /remoteEntry.js {
        add_header 'Cache-Control' 'no-cache, no-store, must-revalidate';
        try_files $uri =404;
    }
}
```

### 3. Build and Run Container

```bash
# Build image
docker build -t my-app .

# Run container
docker run -p 3003:3003 my-app
```

## Integration Types

FrontFuse supports three integration types:

### 1. Module Federation (Recommended)

- **Best Performance** - Shared dependencies, no iframe overhead
- **Type Safety** - Full TypeScript support
- **Rich Integration** - Direct access to host context

```typescript
{
  integrationType: 'module-federation',
  remoteUrl: 'http://localhost:3003',
  scope: 'myApp',
  module: './MyApp'
}
```

### 2. IFrame

- **Maximum Isolation** - Complete sandboxing
- **Technology Agnostic** - Any framework/technology
- **Simple Integration** - Just provide a URL

```typescript
{
  integrationType: 'iframe',
  url: 'http://localhost:3003'
}
```

### 3. Web Components

- **Standards Based** - Native browser support
- **Framework Agnostic** - Works with any framework
- **Good Isolation** - Shadow DOM encapsulation

```typescript
{
  integrationType: 'web-component',
  remoteUrl: 'http://localhost:3003/my-component.js',
  scope: 'my-component'
}
```

## SDK Features

The FrontFuse SDK provides:

### Module Federation Utilities

```typescript
import { loadApp, clearModuleCache } from '@frontfuse/sdk-react'

// Load a federated module
const module = await loadApp({
  remoteUrl: 'http://localhost:3003',
  scope: 'myApp',
  module: './MyApp',
})

// Clear cache for development
clearModuleCache()
```

### Heartbeat System

```typescript
import { createHeartbeat } from '@frontfuse/sdk-react'

const heartbeat = createHeartbeat({
  appId: 'my-app-id',
  backendUrl: 'http://localhost:3001',
  interval: 30000,
  metadata: {
    version: '1.0.0',
    capabilities: ['feature-a', 'feature-b'],
  },
})

heartbeat.start()
```

### Context Integration

```typescript
import { useCurrentUser, usePlatformContext } from '@frontfuse/sdk-react'

function MyComponent() {
  const { user } = useCurrentUser()
  const { state, dispatch } = usePlatformContext()

  return <div>Hello {user?.name}</div>
}
```

## Best Practices

### 1. Dependency Management

- Always use `singleton: true` for React and React DOM
- Align dependency versions across micro-frontends
- Use workspace dependencies for shared packages

### 2. Error Handling

- Implement error boundaries in your components
- Provide fallback UIs for loading failures
- Use retry logic for network failures

### 3. Performance

- Lazy load components with `React.lazy()`
- Implement proper caching strategies
- Monitor bundle sizes

### 4. Security

- Validate all external inputs
- Use proper CORS configuration
- Implement authentication/authorization

### 5. Development

- Use consistent port ranges for apps
- Implement proper logging
- Use TypeScript for better DX

## Troubleshooting

### Common Issues

1. **Module not found errors**

   - Check that remoteEntry.js is accessible
   - Verify scope and module names match
   - Ensure CORS is properly configured

2. **React hook errors**

   - Ensure React is configured as singleton
   - Check for version mismatches
   - Verify shared configuration

3. **Build failures**
   - Check TypeScript configuration
   - Verify all dependencies are installed
   - Ensure proper module federation setup

### Debug Mode

Enable debug logging:

```typescript
// In your app
localStorage.setItem('frontfuse:debug', 'true')
```

## Example Apps

The repository includes several example applications:

- **task-manager-app** - Complete module federation example
- **frontend** - Hub portal container application
- **backend** - API server with app registry

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests and documentation
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
