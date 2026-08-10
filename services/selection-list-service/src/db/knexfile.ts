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
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 10 },
    acquireConnectionTimeout: 10000,
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, '../../dist/db/migrations'),
      extension: 'js',
    },
  },
};

export default config;
