# FrontFuse Platform

A modern microfrontend platform built with Node.js, TypeScript, React, and Vite, supporting multiple integration types including Module Federation, Iframe, and Web Components.

## 🚀 Features

- **Multi-Integration Support**: Module Federation, Iframe, and Web Components
- **Real-time App Status**: WebSocket-based heartbeat system for live app monitoring
- **Authentication & Authorization**: JWT-based auth with role management
- **Modern UI**: Dark/light themes, responsive design, internationalization (English/Hebrew)
- **9-Dots App Selector**: Google/Atlassian-style app launcher with health indicators
- **Avatar User Menu**: Modern user management interface
- **Health Monitoring**: Real-time app health checks with visual indicators
- **WebSocket Communication**: Real-time updates and notifications
- **Smart Navigation**: Context-aware routing and deep linking

## 📦 Architecture

This is a monorepo managed with **Lerna** containing:

- **`backend/`** - Node.js/Express API server with SQLite database
- **`frontend/`** - React/Vite main platform interface
- **`shared/`** - Shared types, contexts, and utilities
- **`sdk/`** - React SDK for microfrontend integration
- **`task-manager-app/`** - Example microfrontend application

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, TypeScript, SQLite, Socket.IO
- **Frontend**: React, TypeScript, Vite, CSS Custom Properties
- **Monorepo**: Lerna, npm workspaces
- **Code Quality**: ESLint, Prettier, Husky, lint-staged, commitlint
- **Integration**: Module Federation, Iframe, Web Components

## 🏃‍♂️ Quick Start

### Prerequisites

- Node.js 18+
- npm 8+
- Git

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd frontfuse-platform

# Install all dependencies
npm install

# Initialize database
npm run db:init
npm run db:seed

# Start development servers
npm run dev
```

This will start:

- Backend API server on `http://localhost:3001`
- Frontend platform on `http://localhost:5173`
- Task manager example on `http://localhost:3002`

### Demo Accounts

- **Admin**: `admin@frontfuse.dev` / `admin123`
- **User**: `user@frontfuse.dev` / `user123`

## 🔧 Development

### Available Scripts

```bash
# Development
npm run dev                 # Start all services
npm run dev:backend        # Start backend only
npm run dev:frontend       # Start frontend only

# Building
npm run build              # Build all packages
npm run type-check         # Type check all packages
npm run lint               # Lint all packages

# Database
npm run db:init            # Initialize database
npm run db:seed            # Seed with demo data

# Version Management
npm run version            # Version packages with Lerna
npm run publish            # Publish packages
```

### Package Scripts

Each package has its own scripts:

```bash
cd frontend && npm run dev     # Start frontend dev server
cd backend && npm run dev      # Start backend dev server
cd shared && npm run build     # Build shared package
cd sdk && npm run build        # Build SDK package
```

## 🎯 Default App Icons

The platform automatically assigns icons based on integration type:

- **Module Federation**: 🔗 (Link icon with blue gradient)
- **Iframe**: 🖼️ (Frame icon with green gradient)
- **Web Component**: ⚡ (Lightning icon with purple gradient)

## 💓 Heartbeat System

Apps can report their status using the heartbeat API:

```typescript
import { createHeartbeat } from '@frontfuse/sdk'

const heartbeat = createHeartbeat({
  appId: 'your-app-uuid',
  backendUrl: 'http://localhost:3001',
  interval: 30000, // 30 seconds
  metadata: { version: '1.0.0' },
})

// Start sending heartbeats
heartbeat.start()

// Stop when app unloads
window.addEventListener('beforeunload', () => {
  heartbeat.stop()
})
```

## 🔌 Integration Types

### Module Federation

```typescript
// App registration
{
  integrationType: 'module-federation',
  remoteUrl: 'https://myapp.example.com',
  scope: 'myApp',
  module: './App'
}
```

### Iframe

```typescript
// App registration
{
  integrationType: 'iframe',
  url: 'https://myapp.example.com'
}
```

### Web Component

```typescript
// App registration
{
  integrationType: 'web-component',
  remoteUrl: 'https://myapp.example.com/component.js',
  scope: 'my-web-component'
}
```

## 🎨 Theming

The platform supports dark/light themes using CSS custom properties:

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --text-primary: #212529;
  --accent-color: #007bff;
}

[data-theme='dark'] {
  --bg-primary: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --text-primary: #ffffff;
  --accent-color: #4dabf7;
}
```

## 🌐 Internationalization

Supports English and Hebrew with RTL layout:

```typescript
import { useLanguage } from './contexts/LanguageContext';

function MyComponent() {
  const { t, language, setLanguage } = useLanguage();

  return (
    <div>
      <h1>{t('welcome')}</h1>
      <button onClick={() => setLanguage('he')}>עברית</button>
    </div>
  );
}
```

## 📝 Commit Convention

This project uses [Conventional Commits](https://conventionalcommits.org/):

```bash
feat(frontend): Add new app selector component
fix(backend): Resolve authentication token validation
docs(readme): Update installation instructions
chore(deps): Update dependencies
```

### Allowed Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting changes
- `refactor` - Code refactoring
- `perf` - Performance improvements
- `test` - Adding tests
- `chore` - Maintenance tasks
- `ci` - CI/CD changes
- `build` - Build system changes

### Allowed Scopes

- `backend`, `frontend`, `shared`, `sdk`, `task-manager`
- `auth`, `ui`, `api`, `websocket`, `heartbeat`
- `theme`, `i18n`, `build`, `deps`

## 🔒 Security

- JWT-based authentication
- Role-based access control (RBAC)
- CORS configuration
- Helmet.js security headers
- Input validation and sanitization

## 🚀 Deployment

### Production Build

```bash
npm run build
```

### Environment Variables

```bash
# Backend
PORT=3001
NODE_ENV=production
JWT_SECRET=your-secret-key
DB_PATH=/path/to/database.sqlite
FRONTEND_URL=https://your-domain.com

# Frontend
VITE_BACKEND_URL=https://api.your-domain.com
```

## 📊 Database Schema

The platform uses SQLite with the following main tables:

- **users** - User accounts and authentication
- **apps** - Registered microfrontend applications
- **sessions** - User sessions (if using session-based auth)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/amazing-feature`
3. Make your changes following the coding standards
4. Commit using conventional commits: `git commit -m "feat(scope): Add amazing feature"`
5. Push to the branch: `git push origin feat/amazing-feature`
6. Open a Pull Request

### Pre-commit Hooks

The project uses Husky for Git hooks:

- **pre-commit**: Runs linting, formatting, and type checking
- **commit-msg**: Validates commit message format

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📧 Email: support@frontfuse.dev
- 📖 Documentation: [docs.frontfuse.dev](https://docs.frontfuse.dev)
- 🐛 Issues: [GitHub Issues](https://github.com/your-org/frontfuse-platform/issues)

## 🗺️ Roadmap

- [ ] Plugin system for custom integrations
- [ ] Advanced analytics and monitoring
- [ ] Multi-tenant support
- [ ] Docker containerization
- [ ] Kubernetes deployment manifests
- [ ] Advanced caching strategies
- [ ] Performance monitoring dashboard
