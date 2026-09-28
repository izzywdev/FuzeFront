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

  // CI / integration-test environment.
  //
  // WHY IT EXISTS. src/db/index.ts selects this config by NODE_ENV, and the
  // integration job needs a NODE_ENV that is NOT 'production' so the
  // FLAGS_FORCE_ON escape hatch in ../flags.ts can enable the release flag
  // (that hatch is hard-gated to non-production on purpose). Without a 'test'
  // entry here, NODE_ENV=test would resolve to `undefined` and the service
  // would not connect at all.
  //
  // It mirrors `production` rather than `development` in one respect that
  // matters: the job runs the COMPILED service (dist/index.js), so migrations
  // must be loaded from dist as `.js`, with loadExtensions restricted so the
  // `.d.ts` files tsc emits alongside them are not mistaken for migrations —
  // see the production block's comment for that failure mode. SSL defaults
  // OFF here (a CI Postgres container serves plaintext), the inverse of
  // production's default.
  test: {
    client: 'pg',
    connection: {
      ...(process.env.DATABASE_URL
        ? connectionFromUrl(process.env.DATABASE_URL)
        : connectionFromEnv()),
      ssl: process.env.DB_SSL === 'true',
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
};

export default config;
