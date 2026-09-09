// migrate.ts — CLI entrypoint for the devportal-db-migrate Job.
//
// Idempotent: knex records applied migrations in `knex_migrations`, so
// re-running on every upgrade is a no-op once the schema is current.
// The Job is a Helm pre-install/pre-upgrade hook that runs:
//   node dist/db/migrate.js

import { db } from './index';

export async function run(): Promise<string[]> {
  const [, applied]: [number, string[]] = await db.migrate.latest();
  return applied;
}

async function main(): Promise<void> {
  const applied = await run();

  if (applied.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[devportal-migrate] Schema already up to date; nothing to apply.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[devportal-migrate] Applied ${applied.length} migration(s):`);
  applied.forEach((name) => {
    // eslint-disable-next-line no-console
    console.log(`[devportal-migrate]   - ${name}`);
  });
}

if (require.main === module) {
  main()
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('[devportal-migrate] Migration failed:', err);
      await db.destroy().catch(() => {});
      process.exit(1);
    });
}
