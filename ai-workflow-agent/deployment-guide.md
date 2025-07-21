# AI Workflow Agent Deployment Guide

This guide covers different deployment options for the AI Workflow Agent.

## 🚀 Deployment Options

### Option 1: Railway (Recommended for Production)

Railway provides easy deployment with automatic HTTPS and scaling.

#### Steps:
1. **Create Railway Account**: Go to [railway.app](https://railway.app)
2. **Connect GitHub**: Link your repository
3. **Deploy Project**:
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli
   
   # Login and deploy
   railway login
   railway link
   railway up
   ```
4. **Configure Environment Variables** in Railway dashboard:
   - `ANTHROPIC_API_KEY`
   - `GITHUB_TOKEN`
   - `WEBHOOK_SECRET`
   - `NODE_ENV=production`
   - `AUTO_FIX_ENABLED=true`
   - `AUTO_COMMIT_ENABLED=true`

5. **Set Domain**: Railway provides automatic domain or configure custom domain

#### Railway Configuration File:
```toml
# railway.toml
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "always"

[[services]]
name = "ai-workflow-agent"
```

### Option 2: Vercel (Serverless)

Good for low-traffic scenarios with automatic scaling.

#### Steps:
1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Configure for Serverless**:
   ```json
   // vercel.json
   {
     "version": 2,
     "builds": [
       {
         "src": "dist/server.js",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       {
         "src": "/(.*)",
         "dest": "dist/server.js"
       }
     ],
     "env": {
       "NODE_ENV": "production"
     }
   }
   ```

3. **Deploy**:
   ```bash
   vercel --prod
   ```

### Option 3: AWS (Container Service)

For enterprise deployments with full control.

#### Using AWS App Runner:
1. **Build and Push Docker Image**:
   ```bash
   # Build image
   docker build -t ai-workflow-agent .
   
   # Tag for ECR
   docker tag ai-workflow-agent:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/ai-workflow-agent:latest
   
   # Push to ECR
   docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/ai-workflow-agent:latest
   ```

2. **Create App Runner Service**:
   ```yaml
   # apprunner.yaml
   version: 1.0
   runtime: docker
   build:
     commands:
       build:
         - echo "No build commands"
   run:
     runtime-version: latest
     command: npm start
     network:
       port: 3000
   env:
     - name: NODE_ENV
       value: production
   ```

### Option 4: Google Cloud Run

Serverless container platform with automatic scaling.

#### Steps:
1. **Deploy to Cloud Run**:
   ```bash
   # Build and deploy
   gcloud run deploy ai-workflow-agent \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars NODE_ENV=production
   ```

2. **Set Environment Variables**:
   ```bash
   gcloud run services update ai-workflow-agent \
     --set-env-vars ANTHROPIC_API_KEY=your_key \
     --set-env-vars GITHUB_TOKEN=your_token \
     --set-env-vars WEBHOOK_SECRET=your_secret
   ```

### Option 5: Local with ngrok (Development)

For development and testing.

#### Steps:
1. **Install ngrok**: Download from [ngrok.com](https://ngrok.com)

2. **Start Application**:
   ```bash
   npm run dev
   ```

3. **Expose with ngrok**:
   ```bash
   ngrok http 3000
   ```

4. **Use ngrok URL** in GitHub webhook configuration

## 📋 GitHub Configuration

### 1. Repository Secrets

Add these secrets in your GitHub repository:
- **Settings → Secrets and variables → Actions**

```
AI_AGENT_WEBHOOK_URL=https://your-deployed-domain.com/webhook/workflow-failure
AI_AGENT_WEBHOOK_SECRET=your-webhook-secret-here
```

### 2. Webhook Configuration

The webhook is automatically configured via the workflow file, but you can also set it up manually:

- **Repository Settings → Webhooks**
- **URL**: `https://your-domain.com/webhook/workflow-failure`
- **Content type**: `application/json`
- **Secret**: Your webhook secret
- **Events**: Select "Workflow runs"

## 🔧 Configuration Examples

### Production Environment Variables
```env
NODE_ENV=production
PORT=3000
ANTHROPIC_API_KEY=your_anthropic_key
GITHUB_TOKEN=your_github_token
WEBHOOK_SECRET=your_webhook_secret
GITHUB_OWNER=your_username
GITHUB_REPO=your_repo
AUTO_FIX_ENABLED=true
AUTO_COMMIT_ENABLED=true
MAX_RETRIES=3
LOG_LEVEL=info
```

### Docker Compose Production
```yaml
version: '3.8'
services:
  ai-workflow-agent:
    image: ai-workflow-agent:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    volumes:
      - ./logs:/app/logs
      - ./docs/chats:/app/docs/chats
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 🔒 Security Considerations

### 1. Environment Variables
- Never commit `.env` files
- Use secure secret management (Railway, Vercel, AWS Secrets Manager)
- Rotate secrets regularly

### 2. Network Security
- Use HTTPS in production
- Configure firewall rules
- Implement rate limiting

### 3. GitHub Token Permissions
Minimal required permissions:
- `Contents: Write` (for commits)
- `Issues: Write` (for fallback notifications)
- `Metadata: Read` (for repository access)
- `Actions: Read` (for workflow information)

## 📊 Monitoring Setup

### 1. Health Checks
All deployment options support health checks at `/health`

### 2. Logging
- Application logs in `/logs` directory
- Structured JSON logging
- Log rotation in production

### 3. Alerts
Configure alerts for:
- Service downtime
- Webhook failures
- AI API errors
- Auto-fix failures

## 🧪 Testing Your Deployment

### 1. Health Check
```bash
curl https://your-domain.com/health
```

### 2. Test Webhook
```bash
curl -X POST https://your-domain.com/webhook/workflow-failure \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=test" \
  -d '{"action": "completed", "workflow_run": {"conclusion": "failure"}}'
```

### 3. Trigger Test Failure
Create a failing workflow to test the complete system:
```yaml
name: Test Failure
on: workflow_dispatch
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
```

## 🚨 Troubleshooting

### Common Issues:

1. **Webhook not receiving events**
   - Check GitHub webhook configuration
   - Verify URL is accessible
   - Check webhook logs

2. **AI analysis fails**
   - Verify Anthropic API key
   - Check API rate limits
   - Review error logs

3. **Auto-fix not working**
   - Check GitHub token permissions
   - Verify git configuration
   - Review commit logs

4. **Chat history not saving**
   - Check write permissions
   - Verify git configuration
   - Check disk space

### Debug Commands:
```bash
# Check service health
curl https://your-domain.com/health

# Check service status
curl https://your-domain.com/status

# View logs (Docker)
docker-compose logs -f ai-workflow-agent

# Test webhook locally
ngrok http 3000
```

## 🔄 Maintenance

### Regular Tasks:
1. **Update Dependencies**: `npm update`
2. **Rotate Secrets**: Update API keys and tokens
3. **Review Logs**: Check for errors and optimization opportunities
4. **Update Documentation**: Keep chat histories organized
5. **Backup Chat History**: Regular backups of `docs/chats/`

### Scaling Considerations:
- **Multiple Repositories**: Deploy separate instances or use multi-tenant configuration
- **High Traffic**: Use cloud-native scaling features
- **Enterprise**: Consider clustering and load balancing

---

🤖 **AI Workflow Agent** - Intelligent workflow failure handling with seamless conversation continuity