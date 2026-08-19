// messages.ts — chat_messages repository (plan §6e / §10d).
//
// Messages have no user_id column; ownership is enforced by joining to
// chat_conversations and filtering on conversations.user_id. Reads therefore
// can only ever return messages from conversations the authenticated user owns.
// `content` is stored as JSON (the column is JSONB) and parsed back on read.
//
// History reads are keyset-paginated on the (created_at, id) tuple — `id` breaks
// ties for messages sharing a timestamp — backed by the
// idx_chat_messages_conv_created index (migration 002). Cursors are message ids.

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

export interface ListMessagesPageOptions {
  /** Return messages strictly older than this message id (scroll up). */
  before?: string;
  /** Return messages strictly newer than this message id (scroll down). */
  after?: string;
  /** Page size (validated by the route). */
  limit: number;
}

export interface MessagesPage {
  /** Page content in chronological (oldest-first) order. */
  messages: StoredMessage[];
  /** Older messages exist before the first message of this page. */
  hasMoreBefore: boolean;
  /** Newer messages exist after the last message of this page. */
  hasMoreAfter: boolean;
}

/** Thrown when a before/after cursor does not identify a message in the conversation. */
export class CursorNotFoundError extends Error {
  constructor(cursor: string) {
    super(`Cursor message not found in conversation: ${cursor}`);
    this.name = 'CursorNotFoundError';
  }
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

function toStored(r: any): StoredMessage {
  return {
    id: r.id,
    role: r.role,
    content: parseContent(r.content),
    createdAt: r.created_at,
  };
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
    const rows = await this.ownedQuery(conversationId, userId)
      .orderBy(`${TABLE}.created_at`, 'asc')
      .select(...this.columns());
    return rows.map(toStored);
  }

  /**
   * One page of a conversation's history, keyset-paginated for bidirectional
   * infinite scroll. Without a cursor the newest `limit` messages are returned
   * (the WhatsApp-style "open at the bottom" page); `before`/`after` page from
   * a message id towards older/newer messages respectively.
   */
  async listPage(
    conversationId: string,
    userId: string,
    opts: ListMessagesPageOptions,
  ): Promise<MessagesPage> {
    const { before, after, limit } = opts;

    const cursorId = before ?? after;
    let anchor: { created_at: string } | undefined;
    if (cursorId) {
      anchor = await this.knex(TABLE)
        .where({ id: cursorId, conversation_id: conversationId })
        .first(['created_at']);
      if (!anchor) throw new CursorNotFoundError(cursorId);
    }

    // Fetch limit+1 rows to learn whether more exist past the page boundary.
    const query = this.ownedQuery(conversationId, userId).limit(limit + 1);

    if (before && anchor) {
      query
        .whereRaw(`(${TABLE}.created_at, ${TABLE}.id) < (?, ?)`, [anchor.created_at, before])
        .orderBy([
          { column: `${TABLE}.created_at`, order: 'desc' },
          { column: `${TABLE}.id`, order: 'desc' },
        ]);
    } else if (after && anchor) {
      query
        .whereRaw(`(${TABLE}.created_at, ${TABLE}.id) > (?, ?)`, [anchor.created_at, after])
        .orderBy([
          { column: `${TABLE}.created_at`, order: 'asc' },
          { column: `${TABLE}.id`, order: 'asc' },
        ]);
    } else {
      // Tail page: newest `limit` messages.
      query.orderBy([
        { column: `${TABLE}.created_at`, order: 'desc' },
        { column: `${TABLE}.id`, order: 'desc' },
      ]);
    }

    const rows = await query.select(...this.columns());
    const overflow = rows.length > limit;
    const page = overflow ? rows.slice(0, limit) : rows;

    // Descending fetches (tail + before) come back newest-first; restore
    // chronological order for the response.
    const descending = !after;
    const messages = (descending ? [...page].reverse() : page).map(toStored);

    if (before) {
      // The anchor (and anything after it) sits beyond the page's newest edge.
      return { messages, hasMoreBefore: overflow, hasMoreAfter: true };
    }
    if (after) {
      return { messages, hasMoreBefore: true, hasMoreAfter: overflow };
    }
    return { messages, hasMoreBefore: overflow, hasMoreAfter: false };
  }

  private ownedQuery(conversationId: string, userId: string) {
    return this.knex(TABLE)
      .join(CONVERSATIONS, `${CONVERSATIONS}.id`, `${TABLE}.conversation_id`)
      .where(`${TABLE}.conversation_id`, conversationId)
      .where(`${CONVERSATIONS}.user_id`, userId);
  }

  private columns(): string[] {
    return [
      `${TABLE}.id as id`,
      `${TABLE}.role as role`,
      `${TABLE}.content as content`,
      `${TABLE}.created_at as created_at`,
    ];
  }
}
