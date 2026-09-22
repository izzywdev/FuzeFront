import type { Knex } from 'knex'
import path from 'path'

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
      directory: path.join(__dirname, 'src/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: path.join(__dirname, 'src/seeds'),
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
      directory: path.join(__dirname, 'dist/migrations'),
      extension: 'js',
      // Only load the compiled .js. Without this, knex's default loadExtensions
      // also matches the emitted .d.ts declaration files beside each compiled
      // migration and loads them as migrations. Same fix as
      // backend/src/config/database.ts.
      loadExtensions: ['.js'],
    },
    seeds: {
      directory: path.join(__dirname, 'dist/seeds'),
      loadExtensions: ['.js'],
    },
  },
}

export default config
