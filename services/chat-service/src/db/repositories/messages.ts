// messages.ts — chat_messages repository (plan §6e / §10d).
//
// Messages have no user_id column; ownership is enforced by joining to
// chat_conversations and filtering on conversations.user_id. Reads therefore
// can only ever return messages from conversations the authenticated user owns.
// `content` is stored as JSON (the column is JSONB) and parsed back on read.

import type { Knex } from 'knex';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface AppendMessageInput {
  conversationId: string;
  role: MessageRole;
  content: unknown;
  toolCallId?: string | null;
}

export interface StoredMessage {
  id: string;
  role: MessageRole;
  content: unknown;
  createdAt: string;
}

const TABLE = 'chat_messages';
const CONVERSATIONS = 'chat_conversations';

function parseContent(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export class MessagesRepository {
  constructor(private readonly knex: Knex) {}

  /** Append a message to a conversation. Caller has already verified ownership. */
  async append(input: AppendMessageInput): Promise<{ id: string }> {
    const [row] = await this.knex(TABLE)
      .insert({
        conversation_id: input.conversationId,
        role: input.role,
        content: JSON.stringify(input.content),
        tool_call_id: input.toolCallId ?? null,
      })
      .returning(['id']);
    return { id: row.id };
  }

  /**
   * List messages for a conversation in chronological order. Ownership is
   * enforced by joining chat_conversations and filtering by user_id.
   */
  async listForConversation(conversationId: string, userId: string): Promise<StoredMessage[]> {
    const rows = await this.knex(TABLE)
      .join(CONVERSATIONS, `${CONVERSATIONS}.id`, `${TABLE}.conversation_id`)
      .where(`${TABLE}.conversation_id`, conversationId)
      .where(`${CONVERSATIONS}.user_id`, userId)
      .orderBy(`${TABLE}.created_at`, 'asc')
      .select(
        `${TABLE}.id as id`,
        `${TABLE}.role as role`,
        `${TABLE}.content as content`,
        `${TABLE}.created_at as created_at`,
      );

    return rows.map((r: any) => ({
      id: r.id,
      role: r.role,
      content: parseContent(r.content),
      createdAt: r.created_at,
    }));
  }
}
