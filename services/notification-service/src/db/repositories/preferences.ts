import { Knex } from 'knex';
import { NotificationCategory } from './notifications';

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push';

export const CATEGORIES: readonly NotificationCategory[] = [
  'system',
  'billing',
  'security',
  'app',
  'social',
];

export const CHANNELS: readonly NotificationChannel[] = [
  'in_app',
  'email',
  'sms',
  'push',
];

/**
 * Category defaults, applied when a user has stored no explicit choice.
 *
 * `security` is deliberately ON for every channel and, per `isMutable` below,
 * cannot be turned off for in-app: a user must not be able to silence the
 * notification that tells them someone signed into their account.
 */
const DEFAULTS: Record<NotificationCategory, Record<NotificationChannel, boolean>> = {
  system: { in_app: true, email: false, sms: false, push: false },
  billing: { in_app: true, email: true, sms: false, push: false },
  security: { in_app: true, email: true, sms: false, push: true },
  app: { in_app: true, email: false, sms: false, push: false },
  social: { in_app: true, email: false, sms: false, push: false },
};

/** In-app security notifications are not optional. Everything else is. */
export function isMutable(
  category: NotificationCategory,
  channel: NotificationChannel
): boolean {
  return !(category === 'security' && channel === 'in_app');
}

export interface PreferenceRow {
  user_id: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

export type PreferenceMap = Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
>;

export class PreferencesRepository {
  constructor(private readonly db: Knex) {}

  /** The FULL matrix: defaults overlaid with the user's explicit choices. The
   *  table stays sparse, but the API always answers a complete picture. */
  async get(userId: string): Promise<PreferenceMap> {
    const rows = (await this.db<PreferenceRow>('notification_preferences').where(
      'user_id',
      userId
    )) as PreferenceRow[];

    const map = JSON.parse(JSON.stringify(DEFAULTS)) as PreferenceMap;
    for (const row of rows) {
      if (!map[row.category]) continue;
      if (!isMutable(row.category, row.channel)) continue;
      map[row.category][row.channel] = row.enabled;
    }
    return map;
  }

  /**
   * Upsert explicit choices. Immutable pairs are silently ignored rather than
   * rejected: the client sends the whole matrix back, and failing the entire
   * save because it echoed a value it cannot change would be hostile.
   */
  async set(
    userId: string,
    updates: Array<{
      category: NotificationCategory;
      channel: NotificationChannel;
      enabled: boolean;
    }>
  ): Promise<PreferenceMap> {
    const writable = updates.filter(
      u =>
        CATEGORIES.includes(u.category) &&
        CHANNELS.includes(u.channel) &&
        isMutable(u.category, u.channel)
    );

    if (writable.length > 0) {
      await this.db('notification_preferences')
        .insert(
          writable.map(u => ({
            user_id: userId,
            category: u.category,
            channel: u.channel,
            enabled: u.enabled,
          }))
        )
        .onConflict(['user_id', 'category', 'channel'])
        .merge(['enabled', 'updated_at']);
    }

    return this.get(userId);
  }

  /**
   * Does this user want `category` on `channel`?
   * Used by the publish path to skip a fan-out the recipient has opted out of.
   */
  async isEnabled(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel
  ): Promise<boolean> {
    if (!isMutable(category, channel)) return true;

    const row = (await this.db<PreferenceRow>('notification_preferences')
      .where('user_id', userId)
      .where('category', category)
      .where('channel', channel)
      .first()) as PreferenceRow | undefined;

    return row ? row.enabled : DEFAULTS[category][channel];
  }
}
