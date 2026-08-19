import { Knex } from 'knex';

// Migration 002 — multi-app chat scope + history pagination support.
//
// chat-service serves the whole Fuze family: consuming apps (fuzefront shell,
// mendys, ...) bring their own subject identifiers, so chat identity can no
// longer be foreign-keyed to the backend-owned users/organizations tables in
// fuzefront_platform. Identity columns become opaque TEXT (existing UUIDs cast
// losslessly) and every conversation gains an `app_id` tenant column.
//
// Also adds the two indexes cursor pagination relies on:
//   - chat_conversations (user_id, app_id, org_id, updated_at DESC) for the
//     scoped "most recent conversation" lookup, and
//   - chat_messages (conversation_id, created_at, id) for keyset paging.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_user_id_fkey`,
  );
  await knex.raw(
    `ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_org_id_fkey`,
  );
  await knex.raw(`ALTER TABLE chat_conversations ALTER COLUMN user_id TYPE TEXT`);
  await knex.raw(`ALTER TABLE chat_conversations ALTER COLUMN org_id TYPE TEXT`);
  await knex.raw(
    `ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT 'fuzefront'`,
  );

  await knex.raw(`ALTER TABLE chat_audit_log ALTER COLUMN user_id TYPE TEXT`);
  await knex.raw(`ALTER TABLE chat_audit_log ALTER COLUMN org_id TYPE TEXT`);
  await knex.raw(`ALTER TABLE chat_feedback ALTER COLUMN user_id TYPE TEXT`);

  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_chat_conversations_scope
       ON chat_conversations (user_id, app_id, org_id, updated_at DESC)`,
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created
       ON chat_messages (conversation_id, created_at, id)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_chat_messages_conv_created`);
  await knex.raw(`DROP INDEX IF EXISTS idx_chat_conversations_scope`);

  await knex.raw(`ALTER TABLE chat_conversations DROP COLUMN IF EXISTS app_id`);

  // Reverting TEXT -> UUID only succeeds while every stored id is a UUID
  // (i.e. before any external app has written non-UUID subjects).
  await knex.raw(
    `ALTER TABLE chat_conversations ALTER COLUMN user_id TYPE UUID USING user_id::uuid`,
  );
  await knex.raw(
    `ALTER TABLE chat_conversations ALTER COLUMN org_id TYPE UUID USING org_id::uuid`,
  );
  await knex.raw(`ALTER TABLE chat_audit_log ALTER COLUMN user_id TYPE UUID USING user_id::uuid`);
  await knex.raw(`ALTER TABLE chat_audit_log ALTER COLUMN org_id TYPE UUID USING org_id::uuid`);
  await knex.raw(`ALTER TABLE chat_feedback ALTER COLUMN user_id TYPE UUID USING user_id::uuid`);

  await knex.raw(
    `ALTER TABLE chat_conversations
       ADD CONSTRAINT chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)`,
  );
  await knex.raw(
    `ALTER TABLE chat_conversations
       ADD CONSTRAINT chat_conversations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id)`,
  );
}
