/**
 * SQL-shape tests for the billing schema migration.
 *
 * Strategy: no live DB required. We read the .sql file and assert it
 * contains the required schema, tables, FK, and UNIQUE constraints.
 * This guards DDL shape in CI without testcontainers/pg-mem.
 *
 * An integration test gated behind DATABASE_URL is included below —
 * it is skipped automatically when no DB is configured.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createPool, runMigrations } from '../src/db';

const SQL_PATH = path.join(
  __dirname,
  '../src/migrations/001_billing_schema.sql',
);

describe('001_billing_schema.sql — DDL shape', () => {
  let sql: string;

  beforeAll(() => {
    sql = fs.readFileSync(SQL_PATH, 'utf8');
  });

  it('loads the migration file', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('creates the pgcrypto extension idempotently', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  });

  it('creates billing schema idempotently', () => {
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS billing/i);
  });

  it('creates billing.customers table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.customers/i);
  });

  it('creates billing.subscriptions table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.subscriptions/i);
  });

  it('creates billing.stripe_events table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.stripe_events/i);
  });

  it('creates billing.usage_events table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.usage_events/i);
  });

  it('creates billing.plans table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.plans/i);
  });

  // FK constraint: subscriptions.customer_id -> customers(id)
  it('has FK from subscriptions to customers', () => {
    expect(sql).toMatch(/REFERENCES billing\.customers\(id\)/i);
  });

  // customers: stripe_customer_id UNIQUE
  it('customers has UNIQUE stripe_customer_id', () => {
    expect(sql).toMatch(/stripe_customer_id\s+TEXT\s+NOT NULL UNIQUE/i);
  });

  // customers: UNIQUE(entity_type, entity_id)
  it('customers has composite UNIQUE(entity_type, entity_id)', () => {
    expect(sql).toMatch(/UNIQUE\s*\(\s*entity_type\s*,\s*entity_id\s*\)/i);
  });

  // subscriptions: stripe_subscription_id UNIQUE
  it('subscriptions has UNIQUE stripe_subscription_id', () => {
    expect(sql).toMatch(/stripe_subscription_id\s+TEXT\s+NOT NULL UNIQUE/i);
  });

  // stripe_events: stripe_event_id UNIQUE
  it('stripe_events has UNIQUE stripe_event_id', () => {
    expect(sql).toMatch(/stripe_event_id\s+TEXT\s+NOT NULL UNIQUE/i);
  });

  // usage_events: correlation_id UNIQUE
  it('usage_events has UNIQUE correlation_id', () => {
    expect(sql).toMatch(/correlation_id\s+TEXT\s+NOT NULL UNIQUE/i);
  });

  // plans: stripe_price_id UNIQUE
  it('plans has UNIQUE stripe_price_id', () => {
    expect(sql).toMatch(/stripe_price_id\s+TEXT\s+NOT NULL UNIQUE/i);
  });

  // Key columns present
  it('customers has entity_type CHECK constraint', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*entity_type\s+IN\s*\(\s*'user'\s*,\s*'organization'\s*\)\s*\)/i);
  });

  it('subscriptions has cancel_at_period_end BOOLEAN', () => {
    expect(sql).toMatch(/cancel_at_period_end\s+BOOLEAN/i);
  });

  it('subscriptions has metadata JSONB', () => {
    expect(sql).toMatch(/metadata\s+JSONB/i);
  });

  it('usage_events has quantity BIGINT', () => {
    expect(sql).toMatch(/quantity\s+BIGINT\s+NOT NULL/i);
  });

  it('plans has features JSONB', () => {
    expect(sql).toMatch(/features\s+JSONB/i);
  });

  it('plans has is_active BOOLEAN', () => {
    expect(sql).toMatch(/is_active\s+BOOLEAN/i);
  });
});

describe('db.ts exports', () => {
  it('exports createPool function', () => {
    expect(typeof createPool).toBe('function');
  });

  it('exports runMigrations function', () => {
    expect(typeof runMigrations).toBe('function');
  });
});

// Integration test — only runs when DATABASE_URL is set
const DB_URL = process.env.DATABASE_URL;

(DB_URL ? describe : describe.skip)(
  'runMigrations integration (requires DATABASE_URL)',
  () => {
    let pool: ReturnType<typeof createPool>;

    beforeAll(async () => {
      pool = createPool(DB_URL!);
      await runMigrations(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    it('billing schema exists after migration', async () => {
      const res = await pool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'billing'`,
      );
      expect(res.rows).toHaveLength(1);
    });

    it('is idempotent — running twice does not throw', async () => {
      await expect(runMigrations(pool)).resolves.not.toThrow();
    });

    it('all five tables exist', async () => {
      const res = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'billing'
         ORDER BY table_name`,
      );
      const names = res.rows.map((r: { table_name: string }) => r.table_name).sort();
      expect(names).toEqual(
        ['customers', 'plans', 'stripe_events', 'subscriptions', 'usage_events'].sort(),
      );
    });
  },
);
