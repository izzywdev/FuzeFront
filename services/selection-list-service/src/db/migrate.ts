// migrate.ts — CLI entrypoint for the selection-list-db-migrate Job.
//
// Idempotent: knex records applied migrations in `knex_migrations`, so
// re-running on every upgrade is a no-op once the schema is current.
// The Job is a Helm pre-install/pre-upgrade hook that runs:
//   node dist/db/migrate.js

import { db } from './index';
import { logger } from '../lib/logger';

const log = logger.child({ component: 'selection-list-migrate' });

export async function run(): Promise<string[]> {
  const [, applied]: [number, string[]] = await db.migrate.latest();
  return applied;
}

async function main(): Promise<void> {
  const applied = await run();

  if (applied.length === 0) {
    log.info('Schema already up to date; nothing to apply.');
    return;
  }

  log.info({ count: applied.length, migrations: applied }, 'Applied migration(s)');
}

if (require.main === module) {
  main()
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch(async (err) => {
      log.fatal({ err }, 'Migration failed');
      await db.destroy().catch(() => {});
      process.exit(1);
    });
}
