import { Knex } from 'knex'

/**
 * Migration 010 — Create the api_tokens table.
 *
 * Backs FuzeFront API tokens: both personal access tokens (PAT, owner_type='user')
 * and organization / service tokens (owner_type='org').
 *
 * Token design:
 *   - Opaque tokens stored as SHA-256 hash only (token_hash).
 *   - token_prefix (22-char base62) serves as the plaintext lookup key.
 *     Because it carries a UNIQUE constraint Postgres already creates a B-tree
 *     index for it — no redundant standalone index is added.
 *
 * owner_id is intentionally NOT a FK: it is polymorphic — it may reference
 * users.id (PAT) or organizations.id (service token) depending on owner_type.
 * A single FK cannot express this. Application-layer validation enforces
 * referential integrity based on owner_type.
 *
 * created_by DOES get a real FK to users(id) with ON DELETE SET NULL so that
 * a service token survives its creator being offboarded.
 */
export async function up(knex: Knex): Promise<void> {
  // Guard the enum creation with the idempotent DO block pattern (see 009).
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE api_token_owner_type_enum AS ENUM ('user', 'org');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  const hasApiTokens = await knex.schema.hasTable('api_tokens')
  if (!hasApiTokens) {
    await knex.schema.createTable('api_tokens', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      // 22-char base62 prefix; plaintext lookup key.
      // UNIQUE creates its own index — no redundant standalone index added.
      table.string('token_prefix', 32).notNullable().unique()

      // SHA-256 hex of "prefix.body" — 64 chars.
      table.string('token_hash', 64).notNullable()

      // Polymorphic owner (user PAT or org service token).
      // NO FK on owner_id — polymorphic; app layer validates based on owner_type.
      table
        .enum('owner_type', null, {
          useNative: true,
          existingType: true,
          enumName: 'api_token_owner_type_enum',
        })
        .notNullable()
      table.uuid('owner_id').notNullable()

      // Human-readable label.
      table.string('name', 255).notNullable()

      // JSON array of scope strings, e.g. ["App:read","App:install"].
      table.jsonb('scopes').notNullable().defaultTo('[]')

      // null = never expires.
      table.timestamp('expires_at', { useTz: true }).nullable()

      table.timestamp('last_used_at', { useTz: true }).nullable()

      // Creator FK — ON DELETE SET NULL so the token outlives its creator.
      table
        .uuid('created_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // null = active; non-null = revoked.
      table.timestamp('revoked_at', { useTz: true }).nullable()

      table.timestamps(true, true)

      // Indexes (token_prefix UNIQUE already indexed; skip redundant standalone).
      table.index(['owner_type', 'owner_id'])
      table.index(['created_by'])
      table.index(['expires_at'])
      table.index(['revoked_at'])
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('api_tokens')
  await knex.raw('DROP TYPE IF EXISTS api_token_owner_type_enum')
}
