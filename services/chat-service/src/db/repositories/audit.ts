// audit.ts — chat_audit_log repository (plan §6e). Every mutating-tool execution
// (allowed or denied, confirmed or not) is recorded here as an immutable audit
// trail. user_id / org_id come from the authenticated caller (§10d), never the
// request body. `args` and `result` are stored as JSON in the JSONB columns.

import type { Knex } from 'knex';

export type PermitDecision = 'allowed' | 'denied';

export interface AuditEntry {
  conversationId?: string | null;
  userId: string;
  orgId?: string | null;
  toolName: string;
  args: unknown;
  result?: unknown;
  permitDecision: PermitDecision;
  confirmed: boolean;
}

const TABLE = 'chat_audit_log';

export class AuditRepository {
  constructor(private readonly knex: Knex) {}

  /** Append an immutable audit-log row for a mutating-tool execution attempt. */
  async record(entry: AuditEntry): Promise<{ id: string }> {
    const [row] = await this.knex(TABLE)
      .insert({
        conversation_id: entry.conversationId ?? null,
        user_id: entry.userId,
        org_id: entry.orgId ?? null,
        tool_name: entry.toolName,
        args: JSON.stringify(entry.args ?? {}),
        result: entry.result === undefined ? null : JSON.stringify(entry.result),
        permit_decision: entry.permitDecision,
        confirmed: entry.confirmed,
      })
      .returning(['id']);
    return { id: row.id };
  }
}
