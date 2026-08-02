import { Knex } from 'knex';

export type NotificationCategory =
  | 'system'
  | 'billing'
  | 'security'
  | 'app'
  | 'social';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface NotificationRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  app_id: string | null;
  type: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  action_url: string | null;
  action_label: string | null;
  data: Record<string, unknown> | null;
  dedupe_key: string | null;
  read_at: Date | null;
  seen_at: Date | null;
  archived_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

/** The wire shape. Snake_case stays inside this module. */
export interface NotificationDTO {
  id: string;
  type: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  actionUrl: string | null;
  actionLabel: string | null;
  data: Record<string, unknown>;
  organizationId: string | null;
  appId: string | null;
  readAt: string | null;
  seenAt: string | null;
  createdAt: string;
}

export function toDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    severity: row.severity,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    actionLabel: row.action_label,
    data: row.data ?? {},
    organizationId: row.organization_id,
    appId: row.app_id,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    seenAt: row.seen_at ? new Date(row.seen_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export interface ListQuery {
  userId: string;
  organizationId?: string;
  category?: NotificationCategory;
  status?: 'unread' | 'read' | 'all';
  limit: number;
  /** ISO timestamp of the last item on the previous page. */
  cursor?: string;
}

export interface CreateInput {
  userId: string;
  organizationId?: string | null;
  appId?: string | null;
  type: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
  expiresAt?: string | null;
}

export class NotificationsRepository {
  constructor(private readonly db: Knex) {}

  /**
   * The inbox read.
   *
   * `userId` is ALWAYS applied and always comes from the verified token — see
   * middleware/auth.ts. Cursor pagination on `created_at` rather than OFFSET so
   * a live arrival during paging cannot shift rows across page boundaries.
   */
  async list(query: ListQuery): Promise<{
    notifications: NotificationDTO[];
    nextCursor: string | null;
  }> {
    let q = this.db<NotificationRow>('notifications')
      .where('user_id', query.userId)
      .whereNull('archived_at');

    if (query.organizationId) {
      // Account-wide notifications (no org) stay visible while an org filter is
      // applied — a security alert must not disappear because the user happens
      // to be looking at one workspace.
      q = q.where(function (this: Knex.QueryBuilder) {
        this.where('organization_id', query.organizationId).orWhereNull(
          'organization_id'
        );
      });
    }
    if (query.category) q = q.where('category', query.category);
    if (query.status === 'unread') q = q.whereNull('read_at');
    if (query.status === 'read') q = q.whereNotNull('read_at');
    if (query.cursor) q = q.where('created_at', '<', query.cursor);

    // Fetch one extra to learn whether another page exists without a COUNT.
    const rows = await q
      .orderBy('created_at', 'desc')
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const nextCursor =
      rows.length > query.limit && page.length > 0
        ? new Date(page[page.length - 1].created_at).toISOString()
        : null;

    return { notifications: page.map(toDTO), nextCursor };
  }

  /** The badge. Hits the partial index; excludes archived and expired rows. */
  async unreadCount(userId: string, organizationId?: string): Promise<number> {
    let q = this.db('notifications')
      .where('user_id', userId)
      .whereNull('read_at')
      .whereNull('archived_at');

    if (organizationId) {
      q = q.where(function (this: Knex.QueryBuilder) {
        this.where('organization_id', organizationId).orWhereNull(
          'organization_id'
        );
      });
    }

    const [{ count }] = await q.count({ count: '*' });
    return Number(count);
  }

  /**
   * Mark one notification read.
   *
   * The `user_id` predicate is what makes this safe: an id belonging to someone
   * else matches zero rows and reports not-found, so a guessed id cannot be
   * used to probe or mutate another mailbox.
   */
  async markRead(userId: string, id: string): Promise<boolean> {
    const updated = await this.db('notifications')
      .where('id', id)
      .where('user_id', userId)
      .whereNull('read_at')
      .update({ read_at: this.db.fn.now() });
    if (updated > 0) return true;

    // Already read is a SUCCESS — this endpoint is idempotent. Only a row that
    // does not belong to the caller is a miss.
    const exists = await this.db('notifications')
      .where('id', id)
      .where('user_id', userId)
      .first();
    return Boolean(exists);
  }

  async markUnread(userId: string, id: string): Promise<boolean> {
    const updated = await this.db('notifications')
      .where('id', id)
      .where('user_id', userId)
      .update({ read_at: null });
    return updated > 0;
  }

  async markAllRead(userId: string, organizationId?: string): Promise<number> {
    let q = this.db('notifications')
      .where('user_id', userId)
      .whereNull('read_at')
      .whereNull('archived_at');

    if (organizationId) {
      q = q.where(function (this: Knex.QueryBuilder) {
        this.where('organization_id', organizationId).orWhereNull(
          'organization_id'
        );
      });
    }

    return q.update({ read_at: this.db.fn.now() });
  }

  /** Badge cleared. Distinct from read — see the migration's column comment. */
  async markAllSeen(userId: string, organizationId?: string): Promise<number> {
    let q = this.db('notifications')
      .where('user_id', userId)
      .whereNull('seen_at')
      .whereNull('archived_at');

    if (organizationId) {
      q = q.where(function (this: Knex.QueryBuilder) {
        this.where('organization_id', organizationId).orWhereNull(
          'organization_id'
        );
      });
    }

    return q.update({ seen_at: this.db.fn.now() });
  }

  async archive(userId: string, id: string): Promise<boolean> {
    const updated = await this.db('notifications')
      .where('id', id)
      .where('user_id', userId)
      .whereNull('archived_at')
      .update({ archived_at: this.db.fn.now() });
    return updated > 0;
  }

  /**
   * Create one notification.
   *
   * Returns null when a live row with the same `(user_id, dedupe_key)` already
   * exists — a retried producer is a no-op, not a duplicate in someone's inbox.
   * The unique index is the enforcement; this is the graceful path.
   */
  async create(input: CreateInput): Promise<NotificationDTO | null> {
    const insert = {
      user_id: input.userId,
      organization_id: input.organizationId ?? null,
      app_id: input.appId ?? null,
      type: input.type,
      category: input.category ?? 'system',
      severity: input.severity ?? 'info',
      title: input.title,
      body: input.body ?? null,
      action_url: input.actionUrl ?? null,
      action_label: input.actionLabel ?? null,
      data: JSON.stringify(input.data ?? {}),
      dedupe_key: input.dedupeKey ?? null,
      expires_at: input.expiresAt ?? null,
    };

    try {
      // Untyped builder: NotificationRow describes what comes BACK, while the
      // jsonb column goes IN as a serialized string.
      const [row] = await this.db('notifications').insert(insert).returning('*');
      return toDTO(row as NotificationRow);
    } catch (error: any) {
      if (error?.code === '23505') return null; // unique violation → deduped
      throw error;
    }
  }

  /** Sweep expired rows. Called by the scheduled cleanup, not on the hot path. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    return this.db('notifications')
      .whereNotNull('expires_at')
      .where('expires_at', '<', now)
      .del();
  }
}
