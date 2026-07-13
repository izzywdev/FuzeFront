// conversations.ts — chat_conversations repository (plan §6e / §10d).
//
// Every read and write is scoped by `userId` derived from the JWT — NEVER from a
// request-body field. findById additionally scopes by user_id so a user cannot
// fetch another user's conversation by guessing its id (§10d data isolation).
//
// Conversations are additionally scoped by `app_id` (the consuming application:
// 'fuzefront', 'mendys', ...) and optionally `org_id`, so each app sees only its
// own history for the same subject (migration 002).

import type { Knex } from 'knex';

export interface ConversationRow {
  id: string;
  title: string | null;
  app_id: string;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  appId: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationInput {
  userId: string;
  appId: string;
  orgId?: string | null;
  title?: string | null;
}

export interface ListConversationsFilter {
  appId?: string;
  orgId?: string;
}

const TABLE = 'chat_conversations';
const COLUMNS = ['id', 'title', 'app_id', 'org_id', 'created_at', 'updated_at'];

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    appId: row.app_id,
    orgId: row.org_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationsRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * List the authenticated user's conversations, most-recently-updated first,
   * optionally narrowed to one app / org tenant.
   */
  async list(userId: string, filter: ListConversationsFilter = {}): Promise<Conversation[]> {
    const query = this.knex(TABLE).where({ user_id: userId });
    if (filter.appId) query.andWhere({ app_id: filter.appId });
    if (filter.orgId) query.andWhere({ org_id: filter.orgId });
    const rows: ConversationRow[] = await query.orderBy('updated_at', 'desc').select(COLUMNS);
    return rows.map(toConversation);
  }

  /** Fetch one conversation, scoped by id AND userId. */
  async findById(id: string, userId: string): Promise<Conversation | null> {
    const row: ConversationRow | undefined = await this.knex(TABLE)
      .where({ id, user_id: userId })
      .first(COLUMNS);
    return row ? toConversation(row) : null;
  }

  /** Create a new conversation owned by `userId` within an app (+ optional org). */
  async create(input: CreateConversationInput): Promise<Conversation> {
    const [row]: ConversationRow[] = await this.knex(TABLE)
      .insert({
        user_id: input.userId,
        app_id: input.appId,
        org_id: input.orgId ?? null,
        title: input.title ?? null,
      })
      .returning(COLUMNS);
    return toConversation(row);
  }

  /** Bump updated_at on an owned conversation (after a new message). */
  async touch(id: string, userId: string): Promise<void> {
    await this.knex(TABLE)
      .where({ id, user_id: userId })
      .update({ updated_at: this.knex.fn.now() });
  }
}
