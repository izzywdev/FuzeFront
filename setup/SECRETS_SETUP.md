# GitHub Secrets Setup Guide for FuzeFront

This guide provides commands to create all necessary GitHub secrets for the FuzeFront repository using GitHub CLI.

## Prerequisites

1. Install GitHub CLI: `gh auth login`
2. Ensure you have admin access to the repository
3. Generate necessary API keys and tokens from external services

## Core Application Secrets

### 1. JWT Secret (Critical - Required for Authentication)

```bash
# Generate a secure random JWT secret (32+ characters)
JWT_SECRET=$(openssl rand -base64 32)
gh secret set JWT_SECRET --body="$JWT_SECRET"
```

### 2. Database Configuration

```bash
# For production database (PostgreSQL example)
gh secret set DATABASE_URL --body="postgresql://username:password@host:5432/fuzefront_prod"

# For development/staging (SQLite)
gh secret set DATABASE_URL --body="./database.sqlite"
```

### 3. Frontend URL

```bash
# Production frontend URL
gh secret set FRONTEND_URL --body="https://frontfuse.yourcompany.com"
```

## Container Registry & Deployment Secrets

### 4. Docker Registry Credentials

```bash
# For GitHub Container Registry (recommended)
gh secret set DOCKER_REGISTRY --body="ghcr.io"
gh secret set DOCKER_USERNAME --body="your-github-username"

# Generate Personal Access Token with packages:write scope
gh secret set DOCKER_PASSWORD --body="ghp_your-personal-access-token"
```

### 5. Alternative Container Registries

```bash
# For Docker Hub
gh secret set DOCKER_REGISTRY --body="docker.io"
gh secret set DOCKER_USERNAME --body="your-dockerhub-username"
gh secret set DOCKER_PASSWORD --body="your-dockerhub-token"

# For AWS ECR
gh secret set AWS_ACCESS_KEY_ID --body="AKIA..."
gh secret set AWS_SECRET_ACCESS_KEY --body="your-aws-secret"
gh secret set AWS_REGION --body="us-west-2"
```

## NPM Publishing Secrets

### 6. NPM Registry Token

```bash
# Get your NPM access token from https://www.npmjs.com/settings/tokens
gh secret set NPM_TOKEN --body="npm_your-npm-access-token"
```

## Security Tool API Keys

### 7. Snyk Security Scanning

```bash
# Get your Snyk API token from https://app.snyk.io/account
gh secret set SNYK_TOKEN --body="your-snyk-api-token"
```

### 8. Trivy Container Scanning

```bash
# Optional: Trivy API token for enhanced features
gh secret set TRIVY_TOKEN --body="your-trivy-api-token"
```

### 9. TruffleHog Secret Scanning

```bash
# Get your TruffleHog API token from https://app.trufflehog.com/
gh secret set TRUFFLEHOG_TOKEN --body="your-trufflehog-api-token"
```

## Monitoring & Alerting Secrets

### 10. Security Webhook for Alerts

```bash
# Slack webhook for security alerts
gh secret set SECURITY_WEBHOOK_URL --body="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# Or Discord webhook
gh secret set SECURITY_WEBHOOK_URL --body="https://discord.com/api/webhooks/YOUR_WEBHOOK"
```

### 11. Error Monitoring (Sentry)

```bash
# Get your Sentry DSN from your project settings
gh secret set SENTRY_DSN --body="https://your-key@sentry.io/project-id"
```

## Cloud Provider Secrets (Optional - for deployment)

### 12. AWS Deployment

```bash
gh secret set AWS_ACCESS_KEY_ID --body="AKIA..."
gh secret set AWS_SECRET_ACCESS_KEY --body="your-aws-secret"
gh secret set AWS_REGION --body="us-west-2"
```

### 13. Azure Deployment

```bash
gh secret set AZURE_CLIENT_ID --body="your-azure-client-id"
gh secret set AZURE_CLIENT_SECRET --body="your-azure-client-secret"
gh secret set AZURE_TENANT_ID --body="your-azure-tenant-id"
gh secret set AZURE_SUBSCRIPTION_ID --body="your-azure-subscription-id"
```

### 14. Google Cloud Platform

```bash
gh secret set GCP_SERVICE_ACCOUNT_KEY --body='{"type": "service_account", ...}'
gh secret set GCP_PROJECT_ID --body="your-gcp-project-id"
```

## External Service Integration Secrets

### 15. GitHub Advanced Security

```bash
# These are automatically available in GitHub Actions:
# - GITHUB_TOKEN (automatically provided)
# - For private repos, enable GitHub Advanced Security in repo settings
```

### 16. Database Credentials (Production)

```bash
# PostgreSQL
gh secret set POSTGRES_USER --body="frontfuse_user"
gh secret set POSTGRES_PASSWORD --body="secure-database-password"
gh secret set POSTGRES_DB --body="frontfuse_prod"

# Redis (for caching/sessions)
gh secret set REDIS_URL --body="redis://user:password@host:6379"
```

## Verification Commands

### Check which secrets are set:

```bash
gh secret list
```

### Update a secret:

```bash
gh secret set SECRET_NAME --body="new-value"
```

### Delete a secret:

```bash
gh secret delete SECRET_NAME
```

## Required Secrets Priority

### **Critical (Required for CI/CD to work):**

1. `JWT_SECRET` - Application authentication
2. `DOCKER_USERNAME` - Container registry access
3. `DOCKER_PASSWORD` - Container registry access

### **Important (Required for full functionality):**

4. `NPM_TOKEN` - Package publishing
5. `DATABASE_URL` - Production database
6. `FRONTEND_URL` - CORS configuration

### **Optional (Enhanced features):**

7. `SNYK_TOKEN` - Enhanced security scanning
8. `SECURITY_WEBHOOK_URL` - Automated alerts
9. `SENTRY_DSN` - Error monitoring

## Quick Setup Script

Create all essential secrets at once:

```bash
#!/bin/bash
# quick-secrets-setup.sh

echo "Setting up FrontFuse GitHub Secrets..."

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 32)
gh secret set JWT_SECRET --body="$JWT_SECRET"

# Set basic configuration
gh secret set DATABASE_URL --body="./database.sqlite"
gh secret set FRONTEND_URL --body="http://localhost:5173"

# GitHub Container Registry (replace with your username)
read -p "Enter your GitHub username: " GITHUB_USER
gh secret set DOCKER_REGISTRY --body="ghcr.io"
gh secret set DOCKER_USERNAME --body="$GITHUB_USER"

# You'll need to set DOCKER_PASSWORD manually with your PAT
echo "⚠️  Please set DOCKER_PASSWORD manually with your GitHub Personal Access Token"
echo "gh secret set DOCKER_PASSWORD --body=\"your-github-pat\""

echo "✅ Basic secrets configured! Check the full guide for optional secrets."
```

## Environment Configuration

After setting up secrets, ensure your environments reference them correctly:

- **Development**: Use `.env` files locally
- **Staging**: GitHub environments with restricted access
- **Production**: GitHub environments with additional protection rules

## Security Best Practices

1. **Rotate secrets regularly** (every 90 days)
2. **Use least privilege** access for service accounts
3. **Monitor secret usage** in GitHub Actions logs
4. **Enable secret scanning** on the repository
5. **Use environment-specific secrets** for staging vs production
