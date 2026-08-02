import { Knex } from 'knex';

/**
 * Notification schema.
 *
 * ONE ROW PER RECIPIENT, not per event. Fan-out happens at write time
 * (`/internal/publish` expands a recipient list into rows) so the read path —
 * which runs on every page load, for every user — is a single indexed scan on
 * `(user_id, created_at desc)` and the badge is a partial-index count. The
 * alternative (an events table joined to a per-user read-state table) makes the
 * hot read a join and the badge an anti-join, for no gain: notification bodies
 * are small and already rendered per recipient.
 *
 * Tables:
 *   notifications            the inbox
 *   notification_preferences per (user, category, channel) opt-in
 *   notification_deliveries  per-notification out-of-band delivery attempts
 */
export async function up(knex: Knex): Promise<void> {
  // --- enums (idempotent; this DB is shared with the platform schema) -------
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE notification_category_enum AS ENUM
        ('system', 'billing', 'security', 'app', 'social');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE notification_severity_enum AS ENUM
        ('info', 'success', 'warning', 'error');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE notification_channel_enum AS ENUM
        ('in_app', 'email', 'sms', 'push');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE notification_delivery_status_enum AS ENUM
        ('pending', 'sent', 'failed', 'skipped');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // --- notifications --------------------------------------------------------
  if (!(await knex.schema.hasTable('notifications'))) {
    await knex.schema.createTable('notifications', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      // The fan-out anchor. NOT a foreign key to `users`: notification-service
      // owns its own tables and must not couple its writes to the platform
      // schema's lifecycle. Orphan rows are swept, not cascaded.
      table.uuid('user_id').notNullable();

      // Nullable: a notification may be account-wide rather than org-scoped.
      table.uuid('organization_id').nullable();
      table.uuid('app_id').nullable();

      // Dotted event type, e.g. 'billing.invoice.paid'. Free-form on purpose —
      // producers are other services and a closed enum here would make every
      // new event type a migration in this repo.
      table.string('type', 128).notNullable();

      table
        .enum('category', null, {
          useNative: true,
          existingType: true,
          enumName: 'notification_category_enum',
        })
        .notNullable()
        .defaultTo('system');

      table
        .enum('severity', null, {
          useNative: true,
          existingType: true,
          enumName: 'notification_severity_enum',
        })
        .notNullable()
        .defaultTo('info');

      table.string('title', 200).notNullable();
      table.text('body').nullable();
      table.string('action_url', 500).nullable();
      table.string('action_label', 80).nullable();
      table.jsonb('data').notNullable().defaultTo('{}');

      // Producer-supplied idempotency key. A retried producer must not
      // double-post the same event to the same person.
      table.string('dedupe_key', 200).nullable();

      // read / seen are DIFFERENT questions. `seen_at` is "the badge was
      // cleared, the user looked"; `read_at` is "this specific item was
      // opened". Collapsing them would make opening the panel silently mark
      // everything read.
      table.timestamp('read_at').nullable();
      table.timestamp('seen_at').nullable();
      table.timestamp('archived_at').nullable();
      table.timestamp('expires_at').nullable();

      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    // The inbox read.
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS notifications_user_created_idx
        ON notifications (user_id, created_at DESC);
    `);
    // The badge — a partial index so the count touches only unread rows.
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
        ON notifications (user_id)
        WHERE read_at IS NULL AND archived_at IS NULL;
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS notifications_org_created_idx
        ON notifications (organization_id, created_at DESC)
        WHERE organization_id IS NOT NULL;
    `);
    // Idempotency, scoped to live rows so an archived notification does not
    // block a legitimate re-send of the same event later.
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
        ON notifications (user_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL AND archived_at IS NULL;
    `);
    // The expiry sweep.
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS notifications_expires_idx
        ON notifications (expires_at)
        WHERE expires_at IS NOT NULL;
    `);
  }

  // --- notification_preferences --------------------------------------------
  if (!(await knex.schema.hasTable('notification_preferences'))) {
    await knex.schema.createTable('notification_preferences', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable();

      table
        .enum('category', null, {
          useNative: true,
          existingType: true,
          enumName: 'notification_category_enum',
        })
        .notNullable();

      table
        .enum('channel', null, {
          useNative: true,
          existingType: true,
          enumName: 'notification_channel_enum',
        })
        .notNullable();

      table.boolean('enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      // An ABSENT row means "the category default", so the table stays sparse:
      // only explicit choices are stored, and adding a category does not
      // require backfilling a row per user.
      table.unique(['user_id', 'category', 'channel']);
      table.index(['user_id']);
    });
  }

  // --- notification_deliveries ---------------------------------------------
  // Written for out-of-band channels (email / sms / push). This service only
  // delivers in_app today; the table exists so a delivery worker consuming the
  // existing email-service / sms-service is an ADDITIVE change rather than a
  // schema migration on a table that already holds production data.
  if (!(await knex.schema.hasTable('notification_deliveries'))) {
    await knex.schema.createTable('notification_deliveries', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      table
        .uuid('notification_id')
        .notNullable()
        .references('id')
        .inTable('notifications')
        .onDelete('CASCADE');

      table
        .enum('channel', null, {
          useNative: true,
          existingType: true,
          enumName: 'notification_channel_enum',
        })
        .notNullable();

      table
        .enum('status', null, {
          useNative: true,
          existingType: true,
          enumName: 'notification_delivery_status_enum',
        })
        .notNullable()
        .defaultTo('pending');

      table.integer('attempts').notNullable().defaultTo(0);
      table.text('last_error').nullable();
      table.timestamp('delivered_at').nullable();
      table.timestamps(true, true);

      table.unique(['notification_id', 'channel']);
      table.index(['status']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_deliveries');
  await knex.schema.dropTableIfExists('notification_preferences');
  await knex.schema.dropTableIfExists('notifications');

  await knex.raw('DROP TYPE IF EXISTS notification_delivery_status_enum');
  await knex.raw('DROP TYPE IF EXISTS notification_channel_enum');
  await knex.raw('DROP TYPE IF EXISTS notification_severity_enum');
  await knex.raw('DROP TYPE IF EXISTS notification_category_enum');
}
