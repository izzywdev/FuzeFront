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

/**
 * Collapse a missing org to SQL NULL. The route derives orgId as
 * `req.body.orgId || req.orgId || ''`, so "no org" arrives as an empty string.
 * Storing '' would make it a tenant distinct from NULL and split one user's
 * continuous thread in two.
 */
function normaliseOrgId(orgId?: string | null): string | null {
  return orgId ? orgId : null;
}

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
        org_id: normaliseOrgId(input.orgId),
        title: input.title ?? null,
      })
      .returning(COLUMNS);
    return toConversation(row);
  }

  /**
   * Resolve the caller's ONE ongoing thread for this (user, app, org) scope,
   * creating it only on first ever use — the Slack/WhatsApp-style continuous
   * conversation decided in #120 / FF-EPIC-02-S4.
   *
   * Before this existed, POST /chat/stream called create() whenever the client
   * omitted conversationId, so continuity depended entirely on the client
   * echoing the id back: a fresh browser, a cleared store, or any consumer that
   * did not implement resume silently forked a new thread every turn. Resolving
   * server-side makes the single thread a property of the service rather than of
   * client good behaviour.
   *
   * Reads the most-recently-updated row for the scope — the exact lookup
   * migration 002's (user_id, app_id, org_id, updated_at DESC) index was added
   * to serve. Most-recent rather than a unique constraint: pre-existing
   * multi-conversation rows predate the continuous-thread decision and a unique
   * index would fail against them.
   *
   * Benign race: two concurrent first-ever turns for the same scope can both
   * miss and both insert. The next turn settles on the most-recently-updated
   * one. Not worth a lock — the window is one request wide and the only cost is
   * a stray empty thread.
   */
  async getOrCreateContinuous(input: CreateConversationInput): Promise<Conversation> {
    const orgId = normaliseOrgId(input.orgId);
    const query = this.knex(TABLE).where({ user_id: input.userId, app_id: input.appId });

    if (orgId === null) {
      // Rows written before create() normalised '' to NULL may hold either, so
      // "no org" must match both — otherwise a legacy '' row is invisible here
      // and every turn would fork a new thread for that scope.
      query.andWhere((builder: Knex.QueryBuilder) =>
        builder.whereNull('org_id').orWhere({ org_id: '' }),
      );
    } else {
      query.andWhere({ org_id: orgId });
    }

    const row: ConversationRow | undefined = await query
      .orderBy('updated_at', 'desc')
      .first(COLUMNS);

    return row ? toConversation(row) : this.create(input);
  }

  /** Bump updated_at on an owned conversation (after a new message). */
  async touch(id: string, userId: string): Promise<void> {
    await this.knex(TABLE)
      .where({ id, user_id: userId })
      .update({ updated_at: this.knex.fn.now() });
  }
}
