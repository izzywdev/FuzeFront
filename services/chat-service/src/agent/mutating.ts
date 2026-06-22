// mutating.ts — the executable confirmation gate for mutating tools (plan §6c/§6d).
//
// When a mutating tool is about to run, it does NOT execute immediately. Instead
// it is prepared here:
//   1. Re-check the caller's LIVE permission via Permit (fail-closed).
//   2. On DENY  → emit a `tool_denied` event; nothing is registered.
//   3. On ALLOW → register a pending confirmation and emit `tool_pending`
//      carrying the confirmationId. The browser shows a ConfirmationCard and
//      POSTs /chat/confirm/:id, where the tool actually executes + is audited.
//
// This helper + the /chat/confirm/:id route form the complete pending → confirm
// → execute → audit loop. FOLLOW-UP: loop.ts does not yet emit model-initiated
// mutating tool calls (it is read-only RAG today); wiring those tool calls into
// the agent loop so the model can *propose* a mutation is the remaining work.
// This helper is the gate they will call once that wiring lands.

import type { AgentTool, ToolContext } from './tools/types';
import type { PermitCheck } from './permit';
import type { PendingTool } from './confirmation';
import type { AgentEvent } from './loop';

export interface PermitGate {
  check(check: PermitCheck): Promise<boolean>;
}

export interface ConfirmationRegistrar {
  register(tool: PendingTool): { confirmationId: string };
}

export interface MutatingGateDeps {
  permit: PermitGate;
  confirmations: ConfirmationRegistrar;
}

/**
 * Run the permit re-check and either deny or register a pending confirmation.
 * Returns the SSE event the caller should emit. Never executes the tool — that
 * happens at /chat/confirm/:id after the user confirms.
 */
export async function prepareMutatingTool(
  tool: Pick<AgentTool, 'name' | 'description' | 'permit'>,
  args: Record<string, unknown>,
  ctx: ToolContext,
  deps: MutatingGateDeps,
): Promise<{ event: AgentEvent }> {
  const allowed = await deps.permit.check({
    user: ctx.userId,
    action: tool.permit.action,
    resource: tool.permit.resource,
    tenant: ctx.orgId,
  });

  if (!allowed) {
    return {
      event: {
        type: 'tool_denied',
        toolName: tool.name,
        reason: `Permission denied: ${tool.permit.resource}:${tool.permit.action}.`,
      },
    };
  }

  const { confirmationId } = deps.confirmations.register({
    userId: ctx.userId,
    toolName: tool.name,
    args,
  });

  return {
    event: {
      type: 'tool_pending',
      confirmationId,
      toolName: tool.name,
      args,
      description: tool.description,
    },
  };
}
