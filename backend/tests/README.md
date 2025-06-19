# FuzeFront Backend Authentication Tests

This directory contains comprehensive authentication tests for the FuzeFront backend API.

## Test Structure

```
tests/
├── auth.test.ts              # Original authentication tests (SQLite)
├── auth-production.test.ts   # Production database tests (PostgreSQL)
├── setup.ts                  # Test configuration and utilities
└── README.md                 # Documentation (this file)
```

## Test Categories

### 1. Unit Tests (`auth.test.ts`)

- **Purpose**: Test authentication logic with SQLite in-memory database
- **Scope**: Login, logout, token validation, rate limiting, security
- **Environment**: Test environment with SQLite
- **Usage**: Fast feedback during development

### 2. Production Tests (`auth-production.test.ts`)

- **Purpose**: Test authentication against production-like PostgreSQL setup
- **Scope**: Database connectivity, CORS, performance, security
- **Environment**: Production environment with PostgreSQL
- **Usage**: Verify production readiness

### 3. Live Tests (`scripts/test-auth.js`)

- **Purpose**: Test running backend API endpoints
- **Scope**: End-to-end authentication flow
- **Environment**: Against live backend instance
- **Usage**: Verify deployed backend functionality

## Running Tests

### Prerequisites

1. **Database Setup**:

   ```bash
   # For production tests, ensure PostgreSQL is running
   docker-compose -f docker-compose.prod.yml up -d
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

### Test Commands

#### All Tests

```bash
npm test                    # Run all tests
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Run tests with coverage report
```

#### Authentication-Specific Tests

```bash
npm run test:auth          # Run authentication unit tests
npm run test:auth:production  # Run production database tests
```

#### Live API Tests

```bash
npm run test:auth:live     # Test against localhost:3001 (default)
npm run test:auth:live:prod   # Test against localhost:3004 (production)

# Custom backend URL
node scripts/test-auth.js http://your-backend-url:port
```

## Test Scenarios

### Authentication Flow Tests

- ✅ **Valid Login**: Test successful authentication with correct credentials
- ✅ **Invalid Login**: Test rejection of wrong credentials
- ✅ **Token Validation**: Test JWT token generation and validation
- ✅ **User Info Retrieval**: Test protected endpoint access
- ✅ **Logout**: Test session termination
- ✅ **Token Expiration**: Test expired token rejection

### Security Tests

- ✅ **CORS Configuration**: Test cross-origin request handling
- ✅ **Rate Limiting**: Test login attempt rate limiting
- ✅ **Input Validation**: Test XSS and SQL injection protection
- ✅ **Security Headers**: Test security header presence

### Database Tests

- ✅ **Connection**: Test database connectivity
- ✅ **Schema Validation**: Test required tables exist
- ✅ **Session Management**: Test session creation/deletion
- ✅ **User Lookup**: Test user authentication against database

### Performance Tests

- ✅ **Response Time**: Test authentication response times
- ✅ **Concurrent Requests**: Test handling multiple simultaneous logins
- ✅ **Load Testing**: Test system under authentication load

## Environment Configuration

### Test Environment Variables

```bash
NODE_ENV=test
JWT_SECRET=test-jwt-secret-key-for-testing-only
USE_POSTGRES=true
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fuzefront_platform_test
DB_USER=postgres
DB_PASSWORD=postgres
FRONTEND_URL=http://localhost:3000
```

### Production Test Environment

```bash
NODE_ENV=production
JWT_SECRET=test-jwt-secret-key-for-ci-testing-only
USE_POSTGRES=true
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fuzefront_platform_prod
DB_USER=postgres
DB_PASSWORD=postgres
FRONTEND_URL=http://localhost:8085
```

## CI/CD Integration

### GitHub Actions

The tests are automatically run in CI/CD via `.github/workflows/backend-tests.yml`:

- **Triggers**: Push/PR to main branches, backend file changes
- **Matrix**: Node.js 18.x and 20.x
- **Services**: PostgreSQL 15
- **Coverage**: Codecov integration
- **Artifacts**: Test results and coverage reports

### Local CI Simulation

```bash
# Simulate CI environment locally
export NODE_ENV=test
export JWT_SECRET=test-jwt-secret-key-for-testing-only
export USE_POSTGRES=true
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=fuzefront_platform_test
export DB_USER=postgres
export DB_PASSWORD=postgres

npm run test:coverage
```

## Test Data

### Default Test User

```json
{
  "email": "admin@frontfuse.dev",
  "password": "admin123",
  "roles": ["admin", "user"]
}
```

### Test Database

- **Development**: SQLite (in-memory)
- **Production Tests**: PostgreSQL (fuzefront_platform_prod)
- **CI/CD**: PostgreSQL (fuzefront_platform_test)

## Debugging Failed Tests

### Common Issues

1. **Database Connection Failures**:

   ```bash
   # Check if PostgreSQL is running
   docker ps | grep postgres

   # Check database connectivity
   psql -h localhost -p 5432 -U postgres -d fuzefront_platform_prod
   ```

2. **Port Conflicts**:

   ```bash
   # Check if backend is running on expected port
   netstat -an | grep :3004
   curl http://localhost:3004/health
   ```

3. **Environment Variables**:
   ```bash
   # Verify environment variables are set
   echo $NODE_ENV
   echo $JWT_SECRET
   echo $DB_HOST
   ```

### Test Debugging

```bash
# Run specific test with verbose output
npm test -- --testNamePattern="should login with valid credentials" --verbose

# Run tests with debug logging
DEBUG=* npm test

# Run single test file
npm test auth.test.ts
```

## Coverage Reports

Test coverage reports are generated in the `coverage/` directory:

- **HTML Report**: `coverage/lcov-report/index.html`
- **LCOV Format**: `coverage/lcov.info`
- **Text Summary**: Console output during test run

### Coverage Targets

- **Statements**: > 90%
- **Branches**: > 85%
- **Functions**: > 90%
- **Lines**: > 90%

## Contributing

When adding new authentication features:

1. **Add Unit Tests**: Update `auth.test.ts` with new test cases
2. **Add Production Tests**: Update `auth-production.test.ts` for database-specific tests
3. **Update Live Tests**: Modify `scripts/test-auth.js` for new endpoints
4. **Update Documentation**: Update this README with new test scenarios
5. **Verify CI/CD**: Ensure tests pass in GitHub Actions

### Test Writing Guidelines

1. **Descriptive Names**: Use clear, descriptive test names
2. **Arrange-Act-Assert**: Follow AAA pattern
3. **Cleanup**: Always clean up test data
4. **Isolation**: Tests should not depend on each other
5. **Error Cases**: Test both success and failure scenarios

## Security Considerations

- **Test Credentials**: Use only test credentials, never production
- **JWT Secrets**: Use test-specific JWT secrets
- **Database Isolation**: Use separate test databases
- **Sensitive Data**: Never commit real passwords or secrets
- **Rate Limiting**: Test rate limiting to prevent abuse

## Monitoring and Alerts

In production, monitor authentication metrics:

- **Login Success Rate**: Should be > 95%
- **Response Times**: Should be < 500ms
- **Error Rates**: Should be < 1%
- **Token Validation**: Should be < 100ms
- **Database Queries**: Should be optimized

## Support

For issues with authentication tests:

1. **Check Logs**: Review test output and backend logs
2. **Verify Setup**: Ensure database and backend are running
3. **Environment**: Verify environment variables are correct
4. **Documentation**: Review this README and test comments
5. **Team Support**: Contact the development team
