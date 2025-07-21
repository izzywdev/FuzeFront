import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from './logger';

export interface ChatMessage {
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    workflow_run?: number;
    commit_sha?: string;
    error_type?: string;
  };
}

export interface SessionMetadata {
  workflowId: number;
  repository: string;
  branch: string;
  startTime: string;
  trigger: string;
  status: 'active' | 'completed' | 'failed';
}

export class ChatHistoryManager {
  private chatDir: string;
  private currentSessionFile: string = '';
  private sessionMetadata: SessionMetadata | null = null;

  constructor(baseDir: string = '../docs/chats') {
    this.chatDir = path.resolve(__dirname, baseDir);
  }

  async initializeSession(workflowId: number, repository: string, branch: string = 'main') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionId = `${timestamp}_workflow-${workflowId}_intervention`;
    
    this.currentSessionFile = path.join(this.chatDir, `${sessionId}.md`);
    
    this.sessionMetadata = {
      workflowId,
      repository,
      branch,
      startTime: new Date().toISOString(),
      trigger: 'workflow_failure',
      status: 'active'
    };

    await fs.mkdir(this.chatDir, { recursive: true });
    
    const header = `# AI Workflow Intervention Session

**Repository**: ${repository}
**Branch**: ${branch}
**Workflow ID**: ${workflowId}
**Session ID**: ${sessionId}
**Started**: ${this.sessionMetadata.startTime}
**Trigger**: Automatic workflow failure detection
**Status**: ${this.sessionMetadata.status}

## Context
This session was automatically triggered by a GitHub workflow failure. The AI agent is analyzing the failure and attempting to resolve it based on previous conversation context.

## Previous Context Summary
${await this.loadPreviousContextSummary()}

## Current Session Log

`;
    
    await fs.writeFile(this.currentSessionFile, header);
    logger.info(`Initialized chat session: ${sessionId}`);
  }

  async appendMessage(message: ChatMessage) {
    if (!this.currentSessionFile) {
      throw new Error('No active session. Call initializeSession first.');
    }

    const roleIcon = message.role === 'user' ? '👤' : '🤖';
    const formattedMessage = `
### ${roleIcon} ${message.role === 'user' ? 'User' : 'AI Assistant'} (${message.timestamp})

${message.content}

${message.metadata ? `**Metadata**: ${JSON.stringify(message.metadata, null, 2)}` : ''}

---

`;
    
    await fs.appendFile(this.currentSessionFile, formattedMessage);
    logger.debug(`Appended message to session: ${message.role}`);
  }

  async updateSessionStatus(status: 'active' | 'completed' | 'failed', summary?: string) {
    if (!this.sessionMetadata) return;

    this.sessionMetadata.status = status;
    
    const statusUpdate = `
## Session Status Update

**Status**: ${status}
**Updated**: ${new Date().toISOString()}
${summary ? `**Summary**: ${summary}` : ''}

`;
    
    await fs.appendFile(this.currentSessionFile, statusUpdate);
    logger.info(`Updated session status: ${status}`);
  }

  async exportToRepository(): Promise<string> {
    if (!this.currentSessionFile) {
      throw new Error('No active session to export');
    }

    try {
      const relativePath = path.relative(process.cwd(), this.currentSessionFile);
      
      // Add the chat file to git
      execSync(`git add "${relativePath}"`, { cwd: process.cwd() });
      
      // Create commit message
      const commitMessage = `docs: add AI agent intervention session for workflow ${this.sessionMetadata?.workflowId}

Session Details:
- Workflow ID: ${this.sessionMetadata?.workflowId}
- Repository: ${this.sessionMetadata?.repository}
- Branch: ${this.sessionMetadata?.branch}
- Status: ${this.sessionMetadata?.status}

🤖 Generated with AI Workflow Agent

Co-Authored-By: Claude <noreply@anthropic.com>`;

      // Commit the changes
      execSync(`git commit -m "${commitMessage}"`, { cwd: process.cwd() });
      
      // Push to remote
      execSync('git push origin HEAD', { cwd: process.cwd() });
      
      logger.info(`Exported session to repository: ${relativePath}`);
      return relativePath;
    } catch (error) {
      logger.error('Failed to export session to repository:', error);
      throw new Error(`Failed to export session: ${error}`);
    }
  }

  async loadPreviousContext(limit: number = 3): Promise<string> {
    try {
      const files = await fs.readdir(this.chatDir);
      const chatFiles = files
        .filter(f => f.endsWith('.md') && f.includes('intervention'))
        .sort()
        .slice(-limit);

      if (chatFiles.length === 0) {
        return 'No previous intervention sessions found.';
      }

      let context = '# Previous Intervention Sessions\n\n';
      
      for (const file of chatFiles) {
        const filePath = path.join(this.chatDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        
        // Extract key information from the session
        const lines = content.split('\n');
        const headerEnd = lines.findIndex(line => line.includes('## Current Session Log'));
        const sessionHeader = lines.slice(0, headerEnd).join('\n');
        
        context += `## ${file}\n${sessionHeader}\n\n`;
      }

      return context;
    } catch (error) {
      logger.error('Failed to load previous context:', error);
      return 'Error loading previous context.';
    }
  }

  private async loadPreviousContextSummary(): Promise<string> {
    try {
      const files = await fs.readdir(this.chatDir);
      const recentFiles = files
        .filter(f => f.endsWith('.md'))
        .sort()
        .slice(-2);

      if (recentFiles.length === 0) {
        return 'No previous sessions found.';
      }

      return `Found ${recentFiles.length} recent session(s): ${recentFiles.join(', ')}`;
    } catch (error) {
      return 'Error loading previous sessions.';
    }
  }

  async getSessionMetadata(): Promise<SessionMetadata | null> {
    return this.sessionMetadata;
  }

  async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.chatDir);
      return files.filter(f => f.endsWith('.md')).sort();
    } catch (error) {
      logger.error('Failed to list sessions:', error);
      return [];
    }
  }
}