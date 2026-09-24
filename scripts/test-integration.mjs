#!/usr/bin/env node
// Root `npm run test:integration` — the single entry point `nightly-integration.yml`
// (and any developer running the suite locally) invokes against the bounded local-up
// stack (governance/local-environment.md).
//
// SCOPE: this orchestrates the real, DB/Kafka-backed integration + contract suites
// that already exist in the repo — it does not reimplement them. This script's job
// is only to:
//   1. resolve one set of connection env vars (bounded-stack container-name
//      defaults, overridable for local dev against docker-compose.test.yml's
//      remapped ports), and
//   2. run each real suite in turn, aggregating pass/fail into one exit code.
//
// GATING DIFFERS PER SUITE, and that is inherited, not introduced here:
//   - billing-service's suite self-skips with a stated reason
//     (`describe.skip`) when DATABASE_URL is unset/unreachable — see
//     services/billing-service/tests/integration/invoices.integration.test.ts.
//   - backend's `test:integration` does NOT self-skip: it requires a reachable
//     Postgres exactly as it already does in ci.yml's `integration-tests` job, so
//     without the bounded stack up this script correctly FAILS on that suite
//     rather than reporting a false green.
//
// WHAT THIS DOES NOT DO (devops-engineer / local-env-verifier scope, FuzeFront#1096):
//   - stand up docker-compose.consumer-test.yml (does not exist yet — the closest
//     wired reference is docker-compose.test.yml at repo root, which already pins
//     the same base-service versions + external-service mock matrix this script's
//     suites expect: postgres:15, MailHog, permit-pdp-test in offline mode,
//     stripe-mock);
//   - verify the no-prod-egress boundary.
//
// Suites run, in order:
//   - backend (auth/apps/permissions) — backend/package.json `test:integration`
//   - billing-service (DB-backed invoice store + keyset pagination walk) —
//     services/billing-service/tests/integration/*, requires `npm install` first
//     since billing-service is not a root npm workspace (see root package.json).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Bounded-stack defaults: container-name addressing, exactly as production would
// (governance/local-environment.md "Detection contract"). Override for local runs
// against docker-compose.test.yml's host-remapped ports (postgres on :5433, etc.)
// — see that file's own header comment for the full port table.
const DB_ENV = {
  DB_HOST: process.env.DB_HOST || 'postgres',
  DB_PORT: process.env.DB_PORT || '5432',
  DB_NAME: process.env.DB_NAME || 'fuzefront_platform_test',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
  PERMIT_API_KEY: process.env.PERMIT_API_KEY || 'ci-noop',
  PERMIT_PDP_URL: process.env.PERMIT_PDP_URL || 'http://permit-pdp-test:7000',
};

// billing-service's integration suite reads DATABASE_URL directly (see
// services/billing-service/tests/integration/invoices.integration.test.ts) rather
// than the discrete DB_* vars backend reads — both point at the same database.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://${DB_ENV.DB_USER}:${DB_ENV.DB_PASSWORD}@${DB_ENV.DB_HOST}:${DB_ENV.DB_PORT}/${DB_ENV.DB_NAME}`;

const SUITES = [
  {
    name: 'backend (auth/apps/permissions)',
    run: () =>
      spawnSync('npm', ['run', 'test:integration', '-w', 'backend'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'test', ...DB_ENV },
      }),
  },
  {
    name: 'billing-service (DB-backed invoices + pagination cursor walk)',
    run: () => {
      const dir = path.join(ROOT, 'services', 'billing-service');
      if (!existsSync(path.join(dir, 'node_modules'))) {
        console.log('::group::install billing-service deps');
        const install = spawnSync('npm', ['install', '--ignore-scripts'], {
          cwd: dir,
          stdio: 'inherit',
        });
        console.log('::endgroup::');
        if (install.status !== 0) return install;
      }
      return spawnSync('npm', ['run', 'test:integration'], {
        cwd: dir,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'test', DATABASE_URL },
      });
    },
  },
];

let failed = false;
for (const suite of SUITES) {
  console.log(`\n=== integration suite: ${suite.name} ===`);
  const result = suite.run();
  if (result.error) {
    console.error(`::error title=test:integration::${suite.name} failed to launch: ${result.error.message}`);
    failed = true;
    continue;
  }
  if (result.status !== 0) {
    console.error(`::error title=test:integration::${suite.name} exited ${result.status}`);
    failed = true;
  }
}

if (failed) {
  console.error('\ntest:integration: one or more suites failed (see above).');
  process.exit(1);
}
console.log('\ntest:integration: all suites passed.');
