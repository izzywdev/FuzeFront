import { Knex } from 'knex'

/**
 * FFRNT-307 / FFRNT-304 — Org invitations v2 (security-service slice).
 *
 * Frozen contract: `packages/security/openapi.yaml` 0.10.2 (tag `organizations`,
 * `MemberType`, `InviteeRef`, the `bindToken` signup flow).
 *
 * Adds, ADDITIVELY and IDEMPOTENTLY (every statement is guarded, so running
 * `up()` twice — including on a fresh security-only test DB — is a no-op the
 * second time):
 *
 *  1. `member_type_enum` (`employee` | `customer`) and a `member_type` column on
 *     BOTH `organization_memberships` and `organization_invitations`. It is
 *     ORTHOGONAL to the access role. Back-compat: every pre-existing row is
 *     backfilled to `employee` by the column default (existing members/invites
 *     are internal ones; `customer` is new with the root-org customer invite).
 *  2. `invitation_channel_enum` (`email` | `whatsapp`) and the invitee identity
 *     on `organization_invitations`:
 *       - `channel`           NOT NULL DEFAULT 'email' (all existing invites are email)
 *       - `phone`             e.164 contact for a `whatsapp` invite
 *       - `invitee_user_id`   set when the invitee is an EXISTING account-holder
 *                             (`InviteeRef.kind = 'account'`)
 *       - `email`             DROP NOT NULL — a whatsapp invitee has no email.
 *     A CHECK keeps the row honest: an `email` invite must carry an email, a
 *     `whatsapp` invite must carry a phone.
 *  3. The signup bind-token carrier: `bind_token` (SHA-256 hex DIGEST of the
 *     single-use, server-minted token — the plaintext is only ever handed to the
 *     invitee in the `202` accept response, never stored) + `bind_token_expires_at`
 *     (short-lived).
 *
 * No data is rewritten or dropped. `down()` is a best-effort inverse (see notes).
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE member_type_enum AS ENUM ('employee', 'customer');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE invitation_channel_enum AS ENUM ('email', 'whatsapp');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  // 1a. organization_memberships.member_type
  if (!(await knex.schema.hasColumn('organization_memberships', 'member_type'))) {
    await knex.raw(`
      ALTER TABLE organization_memberships
        ADD COLUMN member_type member_type_enum NOT NULL DEFAULT 'employee'
    `)
  }

  // 1b + 2 + 3. organization_invitations
  if (!(await knex.schema.hasColumn('organization_invitations', 'member_type'))) {
    await knex.raw(`
      ALTER TABLE organization_invitations
        ADD COLUMN member_type member_type_enum NOT NULL DEFAULT 'employee'
    `)
  }
  if (!(await knex.schema.hasColumn('organization_invitations', 'channel'))) {
    await knex.raw(`
      ALTER TABLE organization_invitations
        ADD COLUMN channel invitation_channel_enum NOT NULL DEFAULT 'email'
    `)
  }
  if (!(await knex.schema.hasColumn('organization_invitations', 'phone'))) {
    await knex.raw(`ALTER TABLE organization_invitations ADD COLUMN phone VARCHAR(32) NULL`)
  }
  if (!(await knex.schema.hasColumn('organization_invitations', 'invitee_user_id'))) {
    await knex.raw(`
      ALTER TABLE organization_invitations
        ADD COLUMN invitee_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL
    `)
  }
  if (!(await knex.schema.hasColumn('organization_invitations', 'bind_token'))) {
    await knex.raw(`ALTER TABLE organization_invitations ADD COLUMN bind_token VARCHAR(128) NULL`)
  }
  if (!(await knex.schema.hasColumn('organization_invitations', 'bind_token_expires_at'))) {
    await knex.raw(
      `ALTER TABLE organization_invitations ADD COLUMN bind_token_expires_at TIMESTAMPTZ NULL`
    )
  }

  // email becomes optional (a whatsapp invitee has only a phone). Dropping NOT
  // NULL is idempotent in Postgres.
  await knex.raw(`ALTER TABLE organization_invitations ALTER COLUMN email DROP NOT NULL`)

  // The identity must match the channel. Existing rows are all channel='email'
  // with an email, so adding the constraint cannot be violated by legacy data.
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE organization_invitations
        ADD CONSTRAINT organization_invitations_channel_identity_chk
        CHECK (
          (channel = 'email' AND email IS NOT NULL)
          OR (channel = 'whatsapp' AND phone IS NOT NULL)
        );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  await knex.raw(
    `CREATE INDEX IF NOT EXISTS organization_invitations_phone_idx ON organization_invitations (phone)`
  )
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS organization_invitations_invitee_user_id_idx ON organization_invitations (invitee_user_id)`
  )
  // Bind-token lookup (signup redeem). Partial: only live carriers are indexed.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_bind_token_uq
      ON organization_invitations (bind_token)
      WHERE bind_token IS NOT NULL
  `)
  // Cursor pagination walks (created_at DESC, id DESC) within an org.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS organization_invitations_org_created_idx
      ON organization_invitations (organization_id, created_at DESC, id DESC)
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS organization_invitations_org_created_idx`)
  await knex.raw(`DROP INDEX IF EXISTS organization_invitations_bind_token_uq`)
  await knex.raw(`DROP INDEX IF EXISTS organization_invitations_invitee_user_id_idx`)
  await knex.raw(`DROP INDEX IF EXISTS organization_invitations_phone_idx`)
  await knex.raw(
    `ALTER TABLE organization_invitations DROP CONSTRAINT IF EXISTS organization_invitations_channel_identity_chk`
  )
  for (const col of [
    'bind_token_expires_at',
    'bind_token',
    'invitee_user_id',
    'phone',
    'channel',
    'member_type',
  ]) {
    if (await knex.schema.hasColumn('organization_invitations', col)) {
      await knex.raw(`ALTER TABLE organization_invitations DROP COLUMN ${col}`)
    }
  }
  if (await knex.schema.hasColumn('organization_memberships', 'member_type')) {
    await knex.raw(`ALTER TABLE organization_memberships DROP COLUMN member_type`)
  }
  // `email` is only restored to NOT NULL when no email-less (whatsapp) rows
  // remain. Deleting them to force the constraint would be destructive, so if
  // any exist the column is deliberately left nullable.
  const nullEmail = await knex('organization_invitations').whereNull('email').first()
  if (!nullEmail) {
    await knex.raw(`ALTER TABLE organization_invitations ALTER COLUMN email SET NOT NULL`)
  }
  await knex.raw(`DROP TYPE IF EXISTS invitation_channel_enum`)
  await knex.raw(`DROP TYPE IF EXISTS member_type_enum`)
}
