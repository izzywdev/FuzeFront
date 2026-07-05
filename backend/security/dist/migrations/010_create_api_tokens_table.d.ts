import { Knex } from 'knex';
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
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=010_create_api_tokens_table.d.ts.map