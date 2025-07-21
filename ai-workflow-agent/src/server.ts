import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { AIWorkflowAgent, AgentConfig } from './ai-agent';
import { logger } from './logger';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'ai-workflow-agent'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'AI Workflow Agent',
    version: '1.0.0',
    description: 'Automated GitHub workflow failure handling with AI intervention',
    endpoints: {
      health: '/health',
      webhook: '/webhook/workflow-failure',
      status: '/status'
    }
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    agent: {
      status: 'ready',
      config: {
        autoFixEnabled: process.env.AUTO_FIX_ENABLED === 'true',
        autoCommitEnabled: process.env.AUTO_COMMIT_ENABLED === 'true',
        repository: `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`,
        environment: process.env.NODE_ENV || 'development'
      }
    },
    timestamp: new Date().toISOString()
  });
});

// Webhook signature verification
function verifyWebhookSignature(req: express.Request): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  const payload = JSON.stringify(req.body);
  const secret = process.env.WEBHOOK_SECRET;
  
  if (!signature || !secret) {
    logger.error('Missing signature or webhook secret');
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return `sha256=${expectedSignature}` === signature;
}

// GitHub webhook interface
interface GitHubWorkflowWebhook {
  action: string;
  workflow_run: {
    id: number;
    status: string;
    conclusion: string;
    html_url: string;
    head_branch: string;
    repository: {
      full_name: string;
    };
  };
}

// Main webhook handler
app.post('/webhook/workflow-failure', async (req, res) => {
  logger.info('Webhook received');
  
  try {
    // Verify webhook signature
    if (!verifyWebhookSignature(req)) {
      logger.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const event: GitHubWorkflowWebhook = req.body;
    
    // Check if this is a workflow failure event
    if (event.action === 'completed' && event.workflow_run.conclusion === 'failure') {
      logger.info(`Workflow failure detected: ${event.workflow_run.html_url}`);
      
      const config: AgentConfig = {
        workflowId: event.workflow_run.id,
        repository: event.workflow_run.repository.full_name,
        branch: event.workflow_run.head_branch,
        workflowUrl: event.workflow_run.html_url,
        conclusion: event.workflow_run.conclusion
      };
      
      // Trigger AI agent intervention asynchronously
      triggerAIIntervention(config)
        .catch(error => {
          logger.error('AI intervention failed:', error);
        });
      
      res.status(200).json({ 
        message: 'Workflow failure processed', 
        workflowId: config.workflowId,
        interventionTriggered: true
      });
    } else {
      logger.info(`Ignoring non-failure event: ${event.action}/${event.workflow_run.conclusion}`);
      res.status(200).json({ 
        message: 'Event ignored (not a failure)',
        action: event.action,
        conclusion: event.workflow_run.conclusion
      });
    }
    
  } catch (error) {
    logger.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI intervention trigger (async)
async function triggerAIIntervention(config: AgentConfig): Promise<void> {
  logger.info(`Triggering AI intervention for workflow ${config.workflowId}`);
  
  try {
    const agent = new AIWorkflowAgent();
    const analysis = await agent.handleWorkflowFailure(config);
    
    logger.info(`AI intervention completed:`, {
      workflowId: config.workflowId,
      errorType: analysis.errorType,
      autoFixable: analysis.autoFixable,
      confidence: analysis.confidence
    });
    
    // You could add notification logic here (Slack, Discord, etc.)
    
  } catch (error) {
    logger.error(`AI intervention failed for workflow ${config.workflowId}:`, error);
    throw error;
  }
}

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(port, () => {
  logger.info(`AI Workflow Agent server running on port ${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Auto-fix enabled: ${process.env.AUTO_FIX_ENABLED === 'true'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app;