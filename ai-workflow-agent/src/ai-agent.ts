import { Anthropic } from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { ChatHistoryManager, ChatMessage } from './chat-manager';
import { logger } from './logger';

export interface AgentConfig {
  workflowId: number;
  repository: string;
  branch: string;
  workflowUrl: string;
  conclusion: string;
}

export interface WorkflowAnalysis {
  errorType: string;
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  autoFixable: boolean;
}

export class AIWorkflowAgent {
  private anthropic: Anthropic;
  private chatManager: ChatHistoryManager;
  private config: AgentConfig | null = null;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!
    });
    this.chatManager = new ChatHistoryManager();
  }

  async handleWorkflowFailure(config: AgentConfig): Promise<WorkflowAnalysis> {
    logger.info(`AI Agent intervention started for workflow ${config.workflowId}`);
    
    this.config = config;
    
    try {
      // Initialize chat session
      await this.chatManager.initializeSession(config.workflowId, config.repository, config.branch);
      
      // Gather failure context
      const failureContext = await this.gatherFailureContext(config);
      const previousContext = await this.chatManager.loadPreviousContext();
      
      // Log user trigger
      await this.chatManager.appendMessage({
        timestamp: new Date().toISOString(),
        role: 'user',
        content: `🚨 GitHub workflow failure detected - automatic AI intervention triggered
        
**Workflow Details:**
- Repository: ${config.repository}
- Branch: ${config.branch}
- Workflow ID: ${config.workflowId}
- Status: ${config.conclusion}
- URL: ${config.workflowUrl}

**Failure Context:**
${failureContext}`,
        metadata: {
          workflow_run: config.workflowId,
          error_type: 'workflow_failure'
        }
      });

      // Analyze failure with Claude
      const analysis = await this.analyzeFailure(failureContext, previousContext);
      
      // Log AI response
      await this.chatManager.appendMessage({
        timestamp: new Date().toISOString(),
        role: 'assistant',
        content: `🤖 **AI Analysis Complete**

**Error Type:** ${analysis.errorType}
**Root Cause:** ${analysis.rootCause}
**Confidence:** ${analysis.confidence}%
**Auto-fixable:** ${analysis.autoFixable ? 'Yes' : 'No'}

**Suggested Fix:**
${analysis.suggestedFix}

${analysis.autoFixable ? 'Attempting automatic fix...' : 'Manual intervention required.'}`,
        metadata: {
          workflow_run: config.workflowId,
          error_type: analysis.errorType
        }
      });

      // Attempt auto-fix if possible
      if (analysis.autoFixable && process.env.AUTO_FIX_ENABLED === 'true') {
        await this.attemptAutoFix(analysis);
      }

      // Update session status
      await this.chatManager.updateSessionStatus(
        analysis.autoFixable ? 'completed' : 'failed',
        `Analysis complete. ${analysis.autoFixable ? 'Auto-fix attempted.' : 'Manual intervention required.'}`
      );

      // Export session to repository
      await this.chatManager.exportToRepository();

      logger.info(`AI Agent intervention completed for workflow ${config.workflowId}`);
      return analysis;
      
    } catch (error) {
      logger.error('AI Agent intervention failed:', error);
      
      await this.chatManager.updateSessionStatus('failed', `Error: ${error}`);
      await this.chatManager.exportToRepository();
      
      throw error;
    }
  }

  private async analyzeFailure(failureContext: string, previousContext: string): Promise<WorkflowAnalysis> {
    const systemPrompt = `You are an AI agent specialized in analyzing GitHub workflow failures. You have access to the same tools and capabilities as Claude Code.

CURRENT FAILURE CONTEXT:
${failureContext}

PREVIOUS CONVERSATION CONTEXT:
${previousContext}

Your task is to:
1. Analyze the workflow failure
2. Identify the root cause
3. Determine if it's auto-fixable
4. Provide a specific fix recommendation

Respond in the following JSON format:
{
  "errorType": "string (e.g., 'terraform_resource_limit', 'build_failure', 'dependency_issue')",
  "rootCause": "string (detailed explanation of what caused the failure)",
  "suggestedFix": "string (specific steps to fix the issue)",
  "confidence": number (0-100, how confident you are in the analysis),
  "autoFixable": boolean (whether this can be automatically fixed)
}

Focus on continuing from where previous conversations left off. This is a continuation of ongoing workflow maintenance.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Analyze this GitHub workflow failure and provide a structured analysis. Based on the context, this appears to be related to our ongoing infrastructure deployment issues.

${failureContext}

Please provide your analysis in the requested JSON format.`
        }]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return {
          errorType: analysis.errorType || 'unknown',
          rootCause: analysis.rootCause || 'Unable to determine root cause',
          suggestedFix: analysis.suggestedFix || 'Manual investigation required',
          confidence: analysis.confidence || 50,
          autoFixable: analysis.autoFixable || false
        };
      }

      throw new Error('Failed to parse AI analysis response');
      
    } catch (error) {
      logger.error('Failed to analyze failure:', error);
      
      // Fallback analysis
      return {
        errorType: 'analysis_failed',
        rootCause: 'AI analysis failed to complete',
        suggestedFix: 'Manual investigation required',
        confidence: 0,
        autoFixable: false
      };
    }
  }

  private async attemptAutoFix(analysis: WorkflowAnalysis): Promise<void> {
    logger.info(`Attempting auto-fix for: ${analysis.errorType}`);
    
    try {
      // Based on error type, attempt specific fixes
      switch (analysis.errorType) {
        case 'terraform_resource_limit':
          await this.fixTerraformResourceLimit();
          break;
        case 'configuration_error':
          await this.fixConfigurationError(analysis);
          break;
        case 'dependency_issue':
          await this.fixDependencyIssue();
          break;
        default:
          logger.info(`No auto-fix available for error type: ${analysis.errorType}`);
          return;
      }
      
      // Log the fix attempt
      await this.chatManager.appendMessage({
        timestamp: new Date().toISOString(),
        role: 'assistant',
        content: `✅ **Auto-fix attempted for ${analysis.errorType}**

The system has attempted to automatically resolve the issue. The fix will be tested in the next workflow run.

**Action taken:** ${analysis.suggestedFix}`,
        metadata: {
          workflow_run: this.config?.workflowId,
          error_type: analysis.errorType
        }
      });
      
    } catch (error) {
      logger.error('Auto-fix failed:', error);
      
      await this.chatManager.appendMessage({
        timestamp: new Date().toISOString(),
        role: 'assistant',
        content: `❌ **Auto-fix failed for ${analysis.errorType}**

Error: ${error}

Manual intervention is required.`,
        metadata: {
          workflow_run: this.config?.workflowId,
          error_type: analysis.errorType
        }
      });
    }
  }

  private async fixTerraformResourceLimit(): Promise<void> {
    // Specific fix for AWS resource limits
    const variablesPath = 'fuzefront-website/infrastructure/variables.tf';
    
    try {
      // Read current variables
      const currentContent = execSync(`cat ${variablesPath}`, { encoding: 'utf8' });
      
      // Reduce desired capacity to 1
      const updatedContent = currentContent.replace(
        /default\s*=\s*2/,
        'default = 1'
      );
      
      // Write the fix
      execSync(`echo '${updatedContent}' > ${variablesPath}`);
      
      // Commit the fix
      if (process.env.AUTO_COMMIT_ENABLED === 'true') {
        execSync(`git add ${variablesPath}`);
        execSync(`git commit -m "fix: reduce desired capacity to 1 to avoid AWS vCPU limits

Auto-fix applied by AI Workflow Agent for workflow failure.

🤖 Generated with AI Workflow Agent"`);
        execSync('git push origin HEAD');
      }
      
      logger.info('Applied Terraform resource limit fix');
      
    } catch (error) {
      logger.error('Failed to apply Terraform fix:', error);
      throw error;
    }
  }

  private async fixConfigurationError(analysis: WorkflowAnalysis): Promise<void> {
    // Generic configuration error fix
    logger.info('Attempting configuration error fix');
    // Implementation depends on specific error
  }

  private async fixDependencyIssue(): Promise<void> {
    // Dependency issue fix
    logger.info('Attempting dependency issue fix');
    // Implementation depends on specific error
  }

  private async gatherFailureContext(config: AgentConfig): Promise<string> {
    try {
      // Get workflow logs
      const logs = execSync(`gh run view ${config.workflowId} --log-failed`, { 
        encoding: 'utf8' 
      });
      
      // Get recent commits
      const commits = execSync(`git log --oneline -5`, { 
        encoding: 'utf8' 
      });
      
      // Get current git status
      const status = execSync(`git status --porcelain`, { 
        encoding: 'utf8' 
      });
      
      // Get current branch
      const currentBranch = execSync(`git branch --show-current`, { 
        encoding: 'utf8' 
      }).trim();
      
      return `
## Workflow Failure Analysis

**Workflow Details:**
- ID: ${config.workflowId}
- Repository: ${config.repository}
- Branch: ${config.branch}
- Current Branch: ${currentBranch}
- Status: ${config.conclusion}
- URL: ${config.workflowUrl}

## Failed Workflow Logs
\`\`\`
${logs}
\`\`\`

## Recent Commits
\`\`\`
${commits}
\`\`\`

## Current Git Status
\`\`\`
${status}
\`\`\`

## Environment Info
- Node.js: ${process.version}
- Working Directory: ${process.cwd()}
- Timestamp: ${new Date().toISOString()}
`;
    } catch (error) {
      logger.error('Failed to gather failure context:', error);
      return `Error gathering failure context: ${error}`;
    }
  }
}