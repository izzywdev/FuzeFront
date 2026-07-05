import { Knex } from 'knex';

// Migration: create all four chat tables in a single file.
// SQL is the exact schema from plan §6e.
// FK references: users(id) and organizations(id) are owned by the backend in
// the same fuzefront_platform database. This migration assumes those tables exist.
// down() drops tables in reverse FK dependency order.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id),
      org_id      UUID REFERENCES organizations(id),
      title       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id  UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role             TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
      content          JSONB NOT NULL,
      tool_call_id     TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS chat_audit_log (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id  UUID REFERENCES chat_conversations(id),
      user_id          UUID NOT NULL,
      org_id           UUID,
      tool_name        TEXT NOT NULL,
      args             JSONB NOT NULL,
      result           JSONB,
      permit_decision  TEXT NOT NULL CHECK (permit_decision IN ('allowed','denied')),
      confirmed        BOOLEAN DEFAULT FALSE,
      executed_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS chat_feedback (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id     UUID NOT NULL,
      rating      TEXT NOT NULL CHECK (rating IN ('positive','negative')),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop in reverse FK dependency order
  await knex.raw('DROP TABLE IF EXISTS chat_feedback');
  await knex.raw('DROP TABLE IF EXISTS chat_audit_log');
  await knex.raw('DROP TABLE IF EXISTS chat_messages');
  await knex.raw('DROP TABLE IF EXISTS chat_conversations');
}
