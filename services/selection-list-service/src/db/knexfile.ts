// knexfile.ts — Knex configuration for selection-list-service.
//
// DATABASE_URL (from SealedSecret) takes precedence. Individual DB_* env vars
// are used for local development parity with the FuzeInfra docker-compose stack.
// The cluster-internal PostgreSQL host: postgres.fuzeinfra.svc.cluster.local:5432.
// Each microservice gets its own role + database; the bootstrap Job creates them.
// Role: selection_list_svc  Database: fuzefront_selection_list

import type { Knex } from 'knex';
import path from 'path';

const connectionFromUrl = (url: string): Knex.PgConnectionConfig => ({ connectionString: url });

const connectionFromEnv = (): Knex.PgConnectionConfig => ({
  host: process.env.DB_HOST || 'postgres.fuzeinfra.svc.cluster.local',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'fuzefront_selection_list',
  user: process.env.DB_USER || 'selection_list_svc',
  password: process.env.DB_PASSWORD || '',
});

const connection = process.env.DATABASE_URL
  ? connectionFromUrl(process.env.DATABASE_URL)
  : connectionFromEnv();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection,
    pool: { min: 2, max: 10 },
    acquireConnectionTimeout: 10000,
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'migrations'),
      extension: 'ts',
    },
  },

  // `test` is PRODUCTION's artifact layout with DEVELOPMENT's posture: it loads
  // the COMPILED migrations out of dist, but leaves NODE_ENV free to mean "this
  // is a test environment" everywhere else.
  //
  // Without it NODE_ENV does double duty -- it picks the knex config AND gates
  // every test affordance in the service (the allow-all authz no-op in
  // middleware/authz.ts, the non-production flag escape hatch in flags.ts).
  // The integration job therefore had to run the service as NODE_ENV=production
  // just to get dist migrations, which switched all of those off and left the
  // suite unable to authenticate or authorize. Falling back to `development`
  // instead is not an option either: it points knex at src/db/migrations with
  // `loadExtensions: ['.ts']`, which against a dist tree picks up the emitted
  // .d.ts files and dies with "must have both an up and down function".
  test: {
    client: 'pg',
    connection: {
      ...connection,
      ssl: process.env.DB_SSL === 'false' ? false : true,
    },
    pool: { min: 2, max: 10 },
    acquireConnectionTimeout: 10000,
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, '../../dist/db/migrations'),
      extension: 'js',
      loadExtensions: ['.js'],
    },
  },

  production: {
    client: 'pg',
    connection: {
      ...(process.env.DATABASE_URL
        ? connectionFromUrl(process.env.DATABASE_URL)
        : connectionFromEnv()),
      ssl: process.env.DB_SSL === 'false' ? false : true,
    },
    pool: { min: 2, max: 10 },
    acquireConnectionTimeout: 10000,
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, '../../dist/db/migrations'),
      extension: 'js',
      // Only load compiled JS. tsc emits `.d.ts` (and `.d.ts.map`) alongside
      // each `.js` in the dist dir; knex's default loadExtensions includes
      // `.ts`, so it would otherwise treat `foo.d.ts` as a migration and fail
      // validation ("must have both an up and down function"). Restricting to
      // `.js` ignores the declaration files. `extension` above only governs
      // stub creation, not which files the migrator loads.
      loadExtensions: ['.js'],
    },
  },
};

export default config;
