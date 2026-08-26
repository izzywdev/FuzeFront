/**
 * SQL-shape tests for the config-service migrations (FFRNT-154/155).
 *
 * Strategy mirrors services/billing-service/tests/db.test.ts: no live DB
 * required — read the .sql files and assert they contain the required
 * schema/columns/constraints. Guards DDL shape in CI without testcontainers.
 */

import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../src/migrations');

function readMigration(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

function withoutComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

describe('migrations directory', () => {
  it('is ordered and every file is idempotent (no bare CREATE TABLE/INDEX without IF NOT EXISTS)', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.sort()).toEqual(['001_config_namespaces.sql', '002_config_key_definitions.sql', '003_config_values.sql']);

    for (const file of files) {
      const code = withoutComments(readMigration(file));
      const bareCreateTable = /CREATE\s+TABLE\s+(?!IF NOT EXISTS)/i;
      const bareCreateIndex = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/i;
      expect(code).not.toMatch(bareCreateTable);
      expect(code).not.toMatch(bareCreateIndex);
    }
  });

  // REGRESSION GUARD. Unqualified DDL is why config-service could never start
  // in prod: config_svc's search_path resolves to "$user", public; no config_svc
  // schema exists; so DDL targeted `public`, where a non-owner has no CREATE on
  // PG15 -> "permission denied for schema public". The `config` schema the
  // bootstrap Job provisions was never used. Every table reference must carry
  // the schema, exactly as billing-service does (billing.customers).
  it('schema-qualifies every table reference (config.<table>) — never bare', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    const tables = ['config_namespaces', 'config_key_definitions', 'config_values'];
    for (const file of files) {
      const code = withoutComments(readMigration(file));
      for (const table of tables) {
        // A bare reference is the table name NOT preceded by "config."
        const bare = new RegExp(`(?<!config\\.)\\b${table}\\b`);
        const offending = code
          .split('\n')
          .filter((l) => bare.test(l))
          // index NAMES legitimately embed the table name (config_values_scope_idx)
          .filter((l) => !/^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(l))
          .filter((l) => !/CONSTRAINT\s+config_/i.test(l));
        expect({ file, offending }).toEqual({ file, offending: [] });
      }
    }
  });

  it('does NOT run CREATE EXTENSION or CREATE SCHEMA (least-privilege runtime role cannot)', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    for (const file of files) {
      const code = withoutComments(readMigration(file));
      expect(code).not.toMatch(/CREATE\s+EXTENSION/i);
      expect(code).not.toMatch(/CREATE\s+SCHEMA/i);
    }
  });
});

describe('001_config_namespaces.sql — S2 AC1 shape', () => {
  const sql = readMigration('001_config_namespaces.sql');

  it('creates config_namespaces idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS config\.config_namespaces/i);
  });

  it('has no id DEFAULT (ids are app-minted via mintId, never gen_random_uuid())', () => {
    const table = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf(');'));
    expect(table).not.toMatch(/gen_random_uuid/i);
  });

  it('namespace is UNIQUE', () => {
    expect(sql).toMatch(/namespace\s+TEXT\s+NOT NULL UNIQUE/i);
  });
});

describe('002_config_key_definitions.sql — S2 AC1 shape', () => {
  const sql = readMigration('002_config_key_definitions.sql');

  it('creates config_key_definitions idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS config\.config_key_definitions/i);
  });

  it('has every column required by S2 AC1', () => {
    const required = [
      'display_name',
      'description',
      'help_url',
      'category',
      'sort_order',
      'tags',
      'value_type',
      'schema',
      'default_value',
      'allowed_scopes',
      'is_system',
      'is_hidden',
      'is_secret',
      'is_readonly',
      'precedence',
      'requires_restart',
      'deprecated_at',
      'replaced_by',
    ];
    for (const column of required) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('is unique on (namespace_id, key)', () => {
    expect(sql).toMatch(/UNIQUE \(namespace_id, key\)/);
  });

  it('constrains value_type to the ValueType enum', () => {
    for (const t of ['string', 'number', 'boolean', 'enum', 'json', 'duration', 'url', 'email', 'color', 'secret']) {
      expect(sql).toMatch(new RegExp(`'${t}'`));
    }
  });

  it('constrains precedence to both directions', () => {
    expect(sql).toMatch(/'most-specific-wins'/);
    expect(sql).toMatch(/'least-specific-wins'/);
  });

  it('references config_namespaces(id) with ON DELETE CASCADE (intra-service FK)', () => {
    expect(sql).toMatch(/REFERENCES config\.config_namespaces\(id\) ON DELETE CASCADE/);
  });
});

describe('003_config_values.sql — S3 AC1 shape', () => {
  const sql = readMigration('003_config_values.sql');

  it('creates config_values idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS config\.config_values/i);
  });

  it('has every column required by S3 AC1', () => {
    const required = ['definition_id', 'scope_type', 'scope_id', 'value', 'is_locked', 'lock_reason', 'set_by_user_id'];
    for (const column of required) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('references config_key_definitions(id) — intra-service FK', () => {
    expect(sql).toMatch(/REFERENCES config\.config_key_definitions\(id\) ON DELETE CASCADE/);
  });

  it('has NO real FK on scope_id (polymorphic, cross-table — S3 risk note)', () => {
    const scopeIdLine = sql.split('\n').find((l) => /^\s*scope_id\s+UUID/.test(l));
    expect(scopeIdLine).toBeDefined();
    expect(scopeIdLine).not.toMatch(/REFERENCES/);
  });

  it('CHECKs scope_id is null iff scope_type is platform', () => {
    expect(sql).toMatch(/scope_type = 'platform' AND scope_id IS NULL/);
    expect(sql).toMatch(/scope_type <> 'platform' AND scope_id IS NOT NULL/);
  });

  it('enforces (definition_id, scope_type, scope_id) uniqueness via two partial unique indexes (S3 AC1)', () => {
    // A plain UNIQUE(...) would not stop the platform singleton tier
    // (scope_id always NULL) from acquiring multiple rows per definition —
    // Postgres treats NULL <> NULL for uniqueness. Two partial indexes fix that.
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS config_values_unique_platform\s*\n\s*ON config\.config_values \(definition_id\)\s*\n\s*WHERE scope_type = 'platform'/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS config_values_unique_scoped\s*\n\s*ON config\.config_values \(definition_id, scope_type, scope_id\)\s*\n\s*WHERE scope_type <> 'platform'/);
  });
});
