"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Idempotent admin bootstrap for the security service.
 *
 * Run as a Helm post-install/post-upgrade hook Job (see
 * templates/security-seed-job.yaml). Unlike the dev knex seed
 * (001_initial_users.ts), this is NON-destructive — it inserts the admin user
 * ONLY if it doesn't already exist, so it's safe to run on every rollout.
 *
 * Credentials come from env (sourced from fuzefront-secrets / values), never
 * hard-coded:
 *   FUZEFRONT_ADMIN_EMAIL     (default <EMAIL>)
 *   FUZEFRONT_ADMIN_PASSWORD  (required; sealed in fuzefront-secrets)
 * DB connection uses the same DB_* env the service uses.
 */
const knex_1 = __importDefault(require("knex"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = require("crypto");
async function main() {
    const email = (process.env.FUZEFRONT_ADMIN_EMAIL || '<EMAIL>').toLowerCase();
    const password = process.env.FUZEFRONT_ADMIN_PASSWORD;
    if (!password) {
        // Non-fatal: skip rather than fail the rollout hook. Seal FUZEFRONT_ADMIN_PASSWORD
        // into fuzefront-secrets to enable the admin bootstrap.
        console.warn('⚠️  FUZEFRONT_ADMIN_PASSWORD not set — skipping admin seed (no-op)');
        return;
    }
    const db = (0, knex_1.default)({
        client: 'pg',
        connection: {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            database: process.env.DB_NAME || 'fuzefront_platform',
            user: process.env.DB_USER || 'fuzefront_user',
            password: process.env.DB_PASSWORD,
        },
    });
    try {
        const existing = await db('users').where({ email }).first();
        if (existing) {
            console.log(`✅ admin user ${email} already exists — nothing to do`);
            return;
        }
        await db('users').insert({
            id: (0, crypto_1.randomUUID)(),
            email,
            password_hash: await bcrypt_1.default.hash(password, 10),
            first_name: 'Admin',
            last_name: 'User',
            roles: JSON.stringify(['admin', 'user']),
            created_at: new Date(),
            updated_at: new Date(),
        });
        console.log(`✅ seeded admin user ${email}`);
    }
    finally {
        await db.destroy();
    }
}
main().catch(err => {
    console.error('❌ seed-admin failed:', err);
    process.exit(1);
});
//# sourceMappingURL=seed-admin.js.map