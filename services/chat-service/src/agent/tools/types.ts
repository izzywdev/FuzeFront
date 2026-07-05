// types.ts — agent tool contract (plan §6c/§6d).
//
// A tool declares whether it is `mutating` (mutating tools require the
// confirmation gate + Permit check before execution) and its Permit
// resource/action mapping. Read-only tools (search_docs) run inline without
// confirmation. Mutating tools (create_org, invite_member, update_settings) are
// DEFERRED per the task brief; the contract here is what they will implement.

export interface ToolContext {
  userId: string;
  orgId: string;
}

export interface PermitMapping {
  resource: string;
  action: string;
}

export interface AgentTool<Args = Record<string, unknown>, Result = unknown> {
  name: string;
  description: string;
  /** Mutating tools require confirmation + Permit allow before execution. */
  mutating: boolean;
  /** Permit resource/action this tool is gated by. */
  permit: PermitMapping;
  execute(args: Args, ctx: ToolContext): Promise<Result>;
}
