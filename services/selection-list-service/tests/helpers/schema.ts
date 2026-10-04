// Schema truth for tests: table -> column names, parsed from the REAL migrations
// (src/db/migrations/*.ts) — the same files production runs.
//
// WHY. A mocked knex cannot tell `organization_id` from `org_id`, which is how
// the org-deleted handler shipped querying columns that do not exist (review M-3,
// rollout blocker B7). Tests that record the (table, column) pairs a handler
// touches and check them against THIS map catch that class of bug without a DB.
// (tests/handlers.db.test.ts additionally runs the handlers against real Postgres.)

import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');

export type SchemaMap = Record<string, Set<string>>;

let cached: SchemaMap | undefined;

export function loadSchema(): SchemaMap {
  if (cached) return cached;
  const schema: SchemaMap = {};
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.ts')).sort();
  for (const file of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // `up()` only: stop at the `down` function so DROP/ALTER-down text is ignored.
    const up = src.split(/export async function down/)[0];

    for (const m of up.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\)\s*\n?\s*`/g)) {
      const table = m[1];
      schema[table] ??= new Set();
      for (const line of m[2].split('\n')) {
        const col = line.trim().match(/^([a-z_]+)\s+(TEXT|INTEGER|BOOLEAN|TIMESTAMPTZ|JSONB|UUID)\b/i);
        if (col) schema[table].add(col[1]);
      }
    }
    for (const m of up.matchAll(/ALTER TABLE\s+(\w+)([\s\S]*?)`/g)) {
      const table = m[1];
      schema[table] ??= new Set();
      for (const add of m[2].matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)) schema[table].add(add[1]);
    }
  }
  cached = schema;
  return schema;
}

/** Returns the `table.column` pairs in `used` that do not exist in the migrations. */
export function unknownColumns(used: Array<[string, string]>): string[] {
  const schema = loadSchema();
  return used
    .filter(([table, column]) => !schema[table]?.has(column))
    .map(([table, column]) => `${table}.${column}`);
}
