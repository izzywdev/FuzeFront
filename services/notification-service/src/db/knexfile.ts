import type { Knex } from 'knex';
import path from 'path';

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'fuzefront_platform',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, '../db/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  },

  production: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'fuzefront_platform',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, '../../dist/db/migrations'),
      extension: 'js',
      // Only load the compiled .js (or .ts in dev). Without this, knex's
      // default loadExtensions also matches the emitted .d.ts declaration files
      // beside each compiled migration and loads them as migrations -> either
      // "does not provide an export named 'Knex'" or "must have both an up and
      // down function". Same fix as backend/src/config/database.ts.
      loadExtensions: ['.js'],
    },
  },
};

export default config;
