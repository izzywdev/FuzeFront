// executor.ts — mutating-tool execution behind the confirmation gate (plan §6c).
//
// When the browser POSTs /chat/confirm/:id, the ConfirmationStore releases the
// pending tool and hands it here. The executor is the authorization + execution
// + audit choke point for ALL mutating tools:
//
//   1. Live Permit check (§10c) — the caller's CURRENT permission, re-checked at
//      execution time (not just when the agent proposed the tool). Fail-closed.
//      A denied check writes a 'denied' audit row and returns success:false.
//   2. Execute the whitelisted tool (PlatformClient performs the real mutation,
//      forwarding the caller's JWT so the backend re-enforces auth — defence in
//      depth).
//   3. Audit-log the outcome (allowed + result, or the execution error) — always,
//      win or lose. The audit write never blocks the user response on failure.
//
// All tools are looked up by name from the registry; an unknown or non-mutating
// tool name is rejected (the confirmation flow is mutating-only).

import type { AgentTool } from './tools/types';
import type { MutatingToolContext } from './tools/mutating';
import type { PermitClient } from './permit';
import type { AuditRepository } from '../db/repositories/audit';

export interface PendingExecution {
  userId: string;
  orgId: string;
  conversationId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
  /** Caller's bearer token, forwarded to the backend by the tool. */
  token: string;
}

export interface ExecutionResult {
  success: boolean;
  /** Human-readable outcome for the tool_result event. */
  summary: string;
  result?: unknown;
}

export interface ToolExecutorDeps {
  /** Resolve a tool by name (only mutating tools are executable here). */
  getTool(name: string): AgentTool<any, any> | undefined;
  permit: Pick<PermitClient, 'check'>;
  audit: Pick<AuditRepository, 'record'>;
}

export class ToolExecutor {
  constructor(private readonly deps: ToolExecutorDeps) {}

  async execute(pending: PendingExecution): Promise<ExecutionResult> {
    const tool = this.deps.getTool(pending.toolName);

    // Unknown or read-only tool must never run through the confirm path.
    if (!tool || !tool.mutating) {
      await this.safeAudit({
        ...this.auditBase(pending),
        permitDecision: 'denied',
        result: { error: 'unknown_or_non_mutating_tool' },
      });
      return { success: false, summary: `Cannot execute "${pending.toolName}".` };
    }

    // 1. Live Permit check — fail-closed.
    const allowed = await this.deps.permit.check({
      user: pending.userId,
      action: tool.permit.action,
      resource: tool.permit.resource,
      tenant: pending.orgId,
      attributes: { args: pending.args },
    });

    if (!allowed) {
      await this.safeAudit({
        ...this.auditBase(pending),
        permitDecision: 'denied',
      });
      return { success: false, summary: 'You do not have permission to perform this action.' };
    }

    // 2. Execute.
    const ctx: MutatingToolContext = {
      userId: pending.userId,
      orgId: pending.orgId,
      token: pending.token,
    };
    try {
      const result = await tool.execute(pending.args, ctx);
      // 3. Audit success.
      await this.safeAudit({
        ...this.auditBase(pending),
        permitDecision: 'allowed',
        result,
      });
      return { success: true, summary: `${tool.name} completed.`, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.safeAudit({
        ...this.auditBase(pending),
        permitDecision: 'allowed',
        result: { error: message },
      });
      return { success: false, summary: message };
    }
  }

  private auditBase(pending: PendingExecution) {
    return {
      conversationId: pending.conversationId ?? null,
      userId: pending.userId,
      orgId: pending.orgId,
      toolName: pending.toolName,
      args: pending.args,
      confirmed: true,
    };
  }

  /** Audit writes must never throw out of the request path. */
  private async safeAudit(
    entry: Parameters<AuditRepository['record']>[0],
  ): Promise<void> {
    try {
      await this.deps.audit.record(entry);
    } catch {
      // Audit failure is logged upstream; do not block the user response.
    }
  }
}
