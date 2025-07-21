# AI Workflow Agent

Automated AI agent for handling GitHub workflow failures with intelligent analysis and auto-remediation capabilities.

## Features

- 🤖 **Automatic AI Intervention**: Triggers on workflow failures
- 📝 **Chat History Preservation**: Maintains conversation context across sessions
- 🔧 **Auto-Fix Capabilities**: Attempts to resolve common issues automatically
- 📊 **Detailed Analysis**: Provides root cause analysis and confidence scoring
- 🔄 **Seamless Handoff**: Continues from previous conversations
- 📋 **Comprehensive Logging**: Full audit trail of all actions

## Architecture

```
GitHub Workflow Failure → Webhook → AI Agent → Analysis → Auto-Fix → Chat Export
```

## Quick Start

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit with your credentials
nano .env
```

Required environment variables:
- `ANTHROPIC_API_KEY`: Your Anthropic API key
- `GITHUB_TOKEN`: GitHub personal access token with repo permissions
- `WEBHOOK_SECRET`: Secret for webhook signature verification
- `AI_AGENT_WEBHOOK_URL`: URL where your agent will be deployed

### 2. Install Dependencies

```bash
npm install
```

### 3. Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### 4. Deployment Options

#### Option A: Docker (Recommended)

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f ai-workflow-agent

# Stop
docker-compose down
```

#### Option B: Local with ngrok (Development)

```bash
# Terminal 1: Start the agent
npm run dev

# Terminal 2: Expose with ngrok
ngrok http 3000

# Use the ngrok URL in GitHub webhook settings
```

#### Option C: Cloud Deployment

**Railway (Recommended)**:
1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy automatically

**Vercel**:
1. Import project to Vercel
2. Configure environment variables
3. Deploy

**AWS/Google Cloud**:
1. Build Docker image
2. Push to container registry
3. Deploy to container service

### 5. GitHub Configuration

#### Add Webhook Secrets

In your GitHub repository settings → Secrets and variables → Actions:

```
AI_AGENT_WEBHOOK_URL=https://your-agent-domain.com/webhook/workflow-failure
AI_AGENT_WEBHOOK_SECRET=your-webhook-secret-here
```

#### The AI Agent Webhook workflow is already configured in:
`.github/workflows/ai-agent-webhook.yml`

## How It Works

### 1. Failure Detection
- GitHub workflow fails
- AI Agent webhook workflow triggers
- Sends notification to AI Agent service

### 2. AI Analysis
- Agent loads previous conversation context
- Analyzes failure logs and git history
- Determines root cause and confidence level
- Suggests fix and auto-fix capability

### 3. Auto-Remediation
- If auto-fixable, attempts resolution
- Creates commits with fixes
- Logs all actions in chat history

### 4. Chat Export
- Saves complete session to `docs/chats/`
- Commits chat history to repository
- Maintains context for future sessions

## Configuration

### Environment Variables

```env
# Required
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GITHUB_TOKEN=your_github_token_here
WEBHOOK_SECRET=your_webhook_secret_here

# Optional
AUTO_FIX_ENABLED=true
AUTO_COMMIT_ENABLED=true
MAX_RETRIES=3
LOG_LEVEL=info
```

### Auto-Fix Capabilities

The agent can automatically fix:
- **Resource Limits**: AWS vCPU quota issues
- **Configuration Errors**: Common workflow misconfigurations
- **Dependency Issues**: Package version conflicts
- **Build Failures**: Common build problems

### Chat History Structure

Chat sessions are stored in `docs/chats/` with the format:
```
YYYY-MM-DDTHH-MM-SS_workflow-{ID}_intervention.md
```

Each session includes:
- Workflow failure details
- AI analysis and confidence
- Auto-fix attempts
- Complete conversation history
- Metadata and timestamps

## API Endpoints

### GET /health
Health check endpoint
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### GET /status
Service status and configuration
```json
{
  "agent": {
    "status": "ready",
    "config": {
      "autoFixEnabled": true,
      "autoCommitEnabled": true,
      "repository": "user/repo"
    }
  }
}
```

### POST /webhook/workflow-failure
GitHub webhook endpoint (secured with signature verification)

## Development

### Project Structure

```
ai-workflow-agent/
├── src/
│   ├── server.ts          # Express server and webhook handler
│   ├── ai-agent.ts        # AI agent logic and analysis
│   ├── chat-manager.ts    # Chat history management
│   └── logger.ts          # Logging configuration
├── docs/
│   └── chats/             # Chat history storage
├── logs/                  # Application logs
├── Dockerfile             # Container configuration
├── docker-compose.yml     # Docker orchestration
└── README.md             # This file
```

### Adding New Auto-Fix Capabilities

1. **Add error type detection** in `ai-agent.ts`
2. **Implement fix logic** in `attemptAutoFix()`
3. **Add test cases** for the new fix
4. **Update documentation**

Example:
```typescript
case 'new_error_type':
  await this.fixNewErrorType(analysis);
  break;
```

### Testing

```bash
# Run tests
npm test

# Test webhook locally
curl -X POST http://localhost:3000/webhook/workflow-failure \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"action": "completed", "workflow_run": {...}}'
```

## Security

- ✅ Webhook signature verification
- ✅ Secure environment variable handling
- ✅ Non-root Docker container
- ✅ Input validation and sanitization
- ✅ Rate limiting (via GitHub)

## Monitoring

- Application logs in `/logs/`
- Health check endpoint at `/health`
- Optional Prometheus integration
- Chat history audit trail

## Troubleshooting

### Common Issues

1. **Webhook not receiving events**
   - Check GitHub webhook configuration
   - Verify webhook URL is accessible
   - Check webhook secret matches

2. **AI analysis fails**
   - Verify Anthropic API key is valid
   - Check API rate limits
   - Review error logs

3. **Auto-fix not working**
   - Check `AUTO_FIX_ENABLED=true`
   - Verify GitHub token permissions
   - Review git configuration

4. **Chat history not saving**
   - Check write permissions on `docs/chats/`
   - Verify git configuration
   - Check commit permissions

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug
npm run dev
```

### Logs

```bash
# View application logs
tail -f logs/combined.log

# View error logs only
tail -f logs/error.log

# Docker logs
docker-compose logs -f ai-workflow-agent
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review application logs
3. Create an issue in the GitHub repository
4. Check the chat history for context

---

🤖 **AI Workflow Agent** - Intelligent workflow failure handling with seamless conversation continuity