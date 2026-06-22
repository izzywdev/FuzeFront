// audit.ts — chat_audit_log repository (plan §6e). Every mutating tool execution
// (allowed OR denied) is recorded here for the immutable audit trail (§6d/§10c).
//
// Like messages.ts, the JSONB columns (args, result) are JSON-stringified on
// write so knex/pg stores valid JSONB regardless of driver coercion. user_id /
// org_id always come from the JWT-derived caller identity, never the body (§10d).

import type { Knex } from 'knex';

export type PermitDecision = 'allowed' | 'denied';

export interface AuditEntry {
  conversationId?: string | null;
  userId: string;
  orgId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  permitDecision: PermitDecision;
  confirmed: boolean;
}

const TABLE = 'chat_audit_log';

export class AuditLogRepository {
  constructor(private readonly knex: Knex) {}

  /** Insert one audit row. result is omitted (NULL) when not provided. */
  async record(entry: AuditEntry): Promise<void> {
    await this.knex(TABLE).insert({
      conversation_id: entry.conversationId ?? null,
      user_id: entry.userId,
      org_id: entry.orgId ?? null,
      tool_name: entry.toolName,
      args: JSON.stringify(entry.args),
      result: entry.result === undefined ? null : JSON.stringify(entry.result),
      permit_decision: entry.permitDecision,
      confirmed: entry.confirmed,
    });
  }
}
