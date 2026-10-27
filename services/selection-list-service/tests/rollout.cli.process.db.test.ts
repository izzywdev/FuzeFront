// rollout.cli.process.db.test.ts - the CLI as a real CHILD PROCESS with stdout PIPED (container logging, `> report.json`).
//
// Codex P2: the entry point ended with `process.exit(code)`, which discards stdout bytes still buffered in the pipe: a big
// report arrived truncated (65,536 bytes of a 1 MB write) AFTER the database changes had committed. The CLI now sets
// `process.exitCode`, waits for the write callback and lets the process end by itself. This test compiles the CLI (tsc into a
// temp dir, so it does not depend on a prior build), starts it against a real Postgres schema, makes its report larger than the
// pipe buffer, reads the pipe slowly on purpose, and asserts the COMPLETE, valid JSON arrives and the exit code survives:
// 0 (dry run), 2 (audit findings), 3 (precondition), 1 (usage and a runtime failure), and that every path terminates promptly.

import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRolloutWorld, RolloutWorld } from './helpers/rolloutWorld';
import { dbDescribe } from './helpers/testDb';

const SERVICE_DIR = path.join(__dirname, '..');
const OUT_DIR = path.join(SERVICE_DIR, '.tmp-cli-process-test');
const GROUPS = 4000; // each duplicate group adds ~400 bytes to the JSON report: > 1 MB, far over a 64 KiB pipe buffer

interface Ran {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  ms: number;
}

dbDescribe('rollout CLI as a child process, stdout piped (real Postgres)', () => {
  let w: RolloutWorld;
  const state: { db: any } = { db: undefined };

  const run = (args: string[], env: Record<string, string | undefined> = {}, slowRead = true): Promise<Ran> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(process.execPath, [path.join(OUT_DIR, 'rollout', 'cli.js'), ...args], {
        cwd: SERVICE_DIR,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'warn',
          DATABASE_URL: `${process.env.SLS_TEST_DATABASE_URL}${process.env.SLS_TEST_DATABASE_URL!.includes('?') ? '&' : '?'}options=-csearch_path%3D${w.t.schema}`,
          SELECTION_LIST_PLATFORM_ORG_ID: '',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => chunks.push(d));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      // a slow consumer: the child's pipe fills and its write is still pending when main() returns
      if (slowRead) {
        child.stdout.pause();
        setTimeout(() => child.stdout.resume(), 400);
      }
      const killer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`the CLI did not terminate within 40 s: ${args.join(' ')}`));
      }, 40_000);
      child.on('close', (code) => {
        clearTimeout(killer);
        resolve({ code, stdout: Buffer.concat(chunks), stderr, ms: Date.now() - started });
      });
    });

  beforeAll(async () => {
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json', '--outDir', OUT_DIR, '--declaration', 'false', '--declarationMap', 'false', '--sourceMap', 'false'], {
      cwd: SERVICE_DIR,
      stdio: 'pipe',
    });
    w = await createRolloutWorld(state);
    // GROUPS organizations, each holding one key under the lower-case and the UPPER-case rendering of its UUID (the same org,
    // two stored ids), with a translation so the dry run's event check passes.
    await w.db.raw(
      `INSERT INTO selection_lists (id, organization_id, key, created_by, created_at, visibility)
       SELECT 'front_sl_' || md5(g::text || v.s), CASE v.s WHEN 'a' THEN lower(o.u) ELSE upper(o.u) END, 'key-' || g, 'x',
              now() - CASE v.s WHEN 'a' THEN interval '2 hour' ELSE interval '1 hour' END, 'org'
         FROM generate_series(1, ?) g
         CROSS JOIN (VALUES ('a'), ('b')) v(s)
         CROSS JOIN LATERAL (SELECT substr(md5('org' || g::text), 1, 8) || '-' || substr(md5('org' || g::text), 9, 4) || '-7' || substr(md5('org' || g::text), 14, 3)
                                    || '-8' || substr(md5('org' || g::text), 18, 3) || '-abcdef' || substr(md5('org' || g::text), 21, 6) AS u) o`,
      [GROUPS],
    );
    await w.db.raw(`INSERT INTO selection_list_translations (list_id, locale, name, source_hash, is_machine) SELECT id, 'en', 'name', 'h', false FROM selection_lists`);
  }, 180_000);

  afterAll(async () => {
    await w?.teardown();
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  });

  /** The report is the LAST stdout line: complete, parseable JSON. */
  const report = (r: Ran) => {
    const lines = r.stdout.toString('utf8').trimEnd().split('\n');
    return { json: JSON.parse(lines[lines.length - 1]), bytes: Buffer.byteLength(lines[lines.length - 1]) };
  };

  it('exit 0: a >1 MB --json dry-run report arrives COMPLETE through a slow pipe, and the process ends by itself', async () => {
    const r = await run(['reconcile-duplicates', '--json']);
    expect(r.code).toBe(0);
    const { json, bytes } = report(r);
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(json).toMatchObject({ job: 'reconcile-duplicates', mode: 'dry-run', summary: { keyDuplicateGroups: GROUPS, wouldRenameAndArchive: GROUPS, blocked: 0 } });
    expect(json.changes).toHaveLength(GROUPS);
  }, 120_000);

  it('exit 2 (audit found duplicates) is preserved with a >1 MB report', async () => {
    const r = await run(['audit', '--json']);
    expect(r.code).toBe(2);
    const { json, bytes } = report(r);
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(json.summary).toMatchObject({ keyDuplicateGroups: GROUPS });
    expect(json.blocked).toHaveLength(GROUPS);
  }, 120_000);

  it('the text report is complete too (not only --json)', async () => {
    const r = await run(['audit']);
    expect(r.code).toBe(2);
    expect(r.stdout.toString('utf8').trimEnd().endsWith('exit code: 2')).toBe(true);
  }, 120_000);

  it('exit 3 (precondition not met) is preserved and its message is whole', async () => {
    const r = await run(['retro-forks', '--apply']);
    expect(r.code).toBe(3);
    expect(r.stdout.toString('utf8')).toContain('PRECONDITION NOT MET (nothing was written): the platform organization is not resolved');
  }, 120_000);

  it('exit 1 on a usage error, and on a runtime failure (database unreachable): both terminate promptly', async () => {
    const usage = await run([], {}, false);
    expect(usage.code).toBe(1);
    expect(usage.stdout.toString('utf8')).toContain('usage: node dist/rollout/cli.js');
    const down = await run(['audit', '--json'], { DATABASE_URL: 'postgres://postgres:x@127.0.0.1:1/none' }, false);
    expect(down.code).toBe(1);
    expect(down.ms).toBeLessThan(30_000);
  }, 120_000);
});
