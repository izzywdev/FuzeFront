// migrate.ts — CLI entrypoint for the notification-db-migrate Job.
//
// Runs the knex migrations in `db/migrations` to latest and exits. Invoked by
// the Helm `notification-db-migrate` pre-install/pre-upgrade hook as
// `node dist/db/migrate.js`, mirroring how the notification-service Job invokes
// `node dist/rag/index-docs.js`.
//
// Why a programmatic runner rather than `npm run migrate`: that script is
// `knex --knexfile src/db/knexfile.ts`, which needs ts-node — a devDependency
// the production image does not install. Reusing the app's own `db` handle also
// guarantees the Job migrates exactly the database the service then connects to.
//
// Idempotent: knex records applied migrations in `knex_migrations`, so re-running
// on every upgrade is a no-op once the schema is current.

import { db } from './index';

export async function run(): Promise<string[]> {
  const [, applied]: [number, string[]] = await db.migrate.latest();
  return applied;
}

async function main(): Promise<void> {
  const applied = await run();

  if (applied.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[notification-migrate] Schema already up to date; nothing to apply.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[notification-migrate] Applied ${applied.length} migration(s):`);
  applied.forEach((name) => {
    // eslint-disable-next-line no-console
    console.log(`[notification-migrate]   - ${name}`);
  });
}

// Only self-execute as a CLI, so tests can import `run` without side effects.
if (require.main === module) {
  main()
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('[notification-migrate] Migration failed:', err);
      // Fail loudly and non-zero: the Job is a pre-upgrade hook, so a silent
      // success here would let notification-service start against a schema-less DB.
      await db.destroy().catch(() => {});
      process.exit(1);
    });
}
