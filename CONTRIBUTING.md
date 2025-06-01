# Contributing to FrontFuse

Thank you for your interest in contributing to FrontFuse! This document provides guidelines and information for contributors.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)
- [Community](#community)

## 🤝 Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+** (required for latest dependencies)
- **npm 10+**
- **Git**
- **Code Editor** (VS Code recommended with TypeScript extensions)

### Local Development Setup

1. **Fork and Clone**

   ```bash
   git clone https://github.com/your-username/FrontFuse.git
   cd FrontFuse
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Start Development Servers**

   ```bash
   npm run dev
   ```

   - Frontend: http://localhost:5173
   - Backend: http://localhost:3001
   - API Docs: http://localhost:3001/api-docs

4. **Start Task Manager (Optional)**
   ```bash
   cd task-manager-app
   npm run dev
   ```
   - Task Manager: http://localhost:3002

## 🔄 Development Workflow

### Branch Strategy

- **`master`**: Production-ready code, protected branch
- **Feature branches**: `feat/feature-name`
- **Bug fixes**: `fix/bug-description`
- **Documentation**: `docs/topic`
- **Builds/CI**: `build/improvement`

### Making Changes

1. **Create Feature Branch**

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make Your Changes**

   - Follow coding standards
   - Add tests for new features
   - Update documentation

3. **Test Locally**

   ```bash
   npm run type-check    # TypeScript validation
   npm run lint         # Code linting
   npm run test        # Run tests
   npm run build       # Build verification
   ```

4. **Commit Changes**

   ```bash
   git add .
   git commit -m "feat(component): add new feature"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feat/your-feature-name
   ```

## 🏗️ Project Structure

```
FrontFuse/
├── frontend/          # React container shell
├── backend/           # Express.js API server
├── shared/            # Shared utilities and types
├── sdk/               # FrontFuse SDK for app developers
├── task-manager-app/  # Example federated app
├── docs/              # Documentation
├── scripts/           # Build and utility scripts
└── .github/           # CI/CD workflows
```

### Key Technologies

- **Frontend**: React 18, TypeScript, Vite, Module Federation
- **Backend**: Node.js, Express, SQLite, Socket.IO
- **Build**: Lerna, Concurrently, Docker
- **CI/CD**: GitHub Actions, Automated testing

## 📝 Coding Standards

### TypeScript

- **Strict mode enabled**: All code must pass TypeScript strict checks
- **Explicit types**: Use explicit types for function parameters and returns
- **Interface over type**: Prefer interfaces for object shapes

```typescript
// ✅ Good
interface User {
  id: string
  name: string
  email: string
}

const getUser = (id: string): Promise<User | null> => {
  // implementation
}

// ❌ Avoid
const getUser = (id: any) => {
  // implementation
}
```

### React Components

- **Functional components**: Use hooks over class components
- **TypeScript props**: Always type component props
- **Component naming**: PascalCase for components, camelCase for functions

```typescript
// ✅ Good
interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

const Button: React.FC<ButtonProps> = ({ onClick, children, variant = 'primary' }) => {
  return (
    <button className={`btn btn-${variant}`} onClick={onClick}>
      {children}
    </button>
  );
};
```

### Styling

- **CSS Modules or styled-components** for component styling
- **Responsive design**: Mobile-first approach
- **Accessibility**: WCAG 2.1 compliance
- **Dark/Light themes**: Support both themes

### API Design

- **RESTful conventions**: Use standard HTTP methods and status codes
- **OpenAPI/Swagger**: Document all endpoints
- **Error handling**: Consistent error response format
- **Validation**: Validate all inputs

## 📦 Commit Guidelines

We follow [Conventional Commits](https://conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **build**: Build system or dependencies
- **ci**: CI configuration changes
- **refactor**: Code refactoring
- **test**: Adding or updating tests
- **perf**: Performance improvements

### Scopes

- **frontend**: Container shell changes
- **backend**: API server changes
- **shared**: Shared utilities
- **sdk**: SDK package changes
- **task-manager**: Task manager app
- **auth**: Authentication system
- **ui**: User interface components
- **api**: API endpoints
- **websocket**: WebSocket functionality
- **build**: Build configuration
- **deps**: Dependencies

### Examples

```bash
feat(frontend): add user profile management
fix(backend): resolve port conflict on startup
docs(sdk): update integration guide
build(ci): add automated security scanning
```

## 🔍 Pull Request Process

### Before Submitting

- [ ] **Tests pass**: All automated tests must pass
- [ ] **Type check**: No TypeScript errors
- [ ] **Linting**: Code follows style guidelines
- [ ] **Documentation**: Update relevant documentation
- [ ] **Security**: No security vulnerabilities introduced

### PR Requirements

1. **Clear Title**: Use conventional commit format
2. **Description**: Explain what and why
3. **Testing**: Describe how you tested the changes
4. **Screenshots**: For UI changes, include before/after
5. **Breaking Changes**: Clearly mark any breaking changes

### PR Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Screenshots (if applicable)

## Checklist

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
```

### Review Process

1. **Automated Checks**: CI must pass
2. **Code Review**: At least one reviewer approval
3. **Testing**: Reviewers test functionality
4. **Merge**: Squash and merge when approved

## 🧪 Testing

### Frontend Testing

```bash
cd frontend
npm test              # Run unit tests
npm run test:e2e     # Run end-to-end tests
```

### Backend Testing

```bash
cd backend
npm test              # Run API tests
npm run test:integration  # Integration tests
```

### Test Requirements

- **Unit tests**: For business logic and utilities
- **Integration tests**: For API endpoints
- **Component tests**: For React components
- **E2E tests**: For critical user flows

## 📚 Documentation

### Required Documentation

- **API changes**: Update OpenAPI specifications
- **New features**: Update user guides
- **SDK changes**: Update developer documentation
- **Configuration**: Update setup instructions

### Documentation Standards

- **Clear examples**: Provide working code examples
- **Screenshots**: Include visuals for UI features
- **Versioning**: Document breaking changes
- **Accessibility**: Include accessibility considerations

## 👥 Community

### Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Questions and community chat
- **Documentation**: Check existing docs first

### Contributing Areas

- **Core Platform**: Container shell and federation
- **Backend API**: Authentication, app management
- **SDK Development**: Developer experience tools
- **Documentation**: Guides and examples
- **Testing**: Test coverage and quality
- **Performance**: Optimization and monitoring

### Recognition

Contributors are recognized in:

- README.md contributors section
- Release notes for significant contributions
- GitHub contributor statistics

## 🔒 Security

For security vulnerabilities, please see our [Security Policy](SECURITY.md).

## 📄 License

By contributing to FrontFuse, you agree that your contributions will be licensed under the same license as the project.

---

**Thank you for contributing to FrontFuse!** 🎉

Your contributions help make microfrontend development more accessible and powerful for everyone.
