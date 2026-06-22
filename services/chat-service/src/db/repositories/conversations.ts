// conversations.ts — chat_conversations repository (plan §6e / §10d).
//
// Every read and write is scoped by `userId` derived from the JWT — NEVER from a
// request-body field. findById additionally scopes by user_id so a user cannot
// fetch another user's conversation by guessing its id (§10d data isolation).

import type { Knex } from 'knex';

export interface ConversationRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationInput {
  userId: string;
  orgId?: string | null;
  title?: string | null;
}

const TABLE = 'chat_conversations';

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationsRepository {
  constructor(private readonly knex: Knex) {}

  /** List the authenticated user's conversations, most-recently-updated first. */
  async list(userId: string): Promise<Conversation[]> {
    const rows: ConversationRow[] = await this.knex(TABLE)
      .where({ user_id: userId })
      .orderBy('updated_at', 'desc');
    return rows.map(toConversation);
  }

  /** Fetch one conversation, scoped by id AND userId. */
  async findById(id: string, userId: string): Promise<Conversation | null> {
    const row: ConversationRow | undefined = await this.knex(TABLE)
      .where({ id, user_id: userId })
      .first();
    return row ? toConversation(row) : null;
  }

  /** Create a new conversation owned by `userId`. */
  async create(input: CreateConversationInput): Promise<Conversation> {
    const [row]: ConversationRow[] = await this.knex(TABLE)
      .insert({
        user_id: input.userId,
        org_id: input.orgId ?? null,
        title: input.title ?? null,
      })
      .returning(['id', 'title', 'created_at', 'updated_at']);
    return toConversation(row);
  }

  /** Bump updated_at on an owned conversation (after a new message). */
  async touch(id: string, userId: string): Promise<void> {
    await this.knex(TABLE)
      .where({ id, user_id: userId })
      .update({ updated_at: this.knex.fn.now() });
  }
}
