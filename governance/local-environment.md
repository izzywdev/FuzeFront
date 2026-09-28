# Local-environment standard — bounded local-up

Referenced by `.github/workflows/harden-gate.yml` (`gate-localup`) and
`.github/workflows/nightly-integration.yml`. This file did not exist before
FuzeFront#242 even though both workflows pointed at it — the doc that ratchets
`gate-localup` from warn to enforcing per repo was itself missing. This is that
doc, describing what the two jobs actually do today, not an aspirational target.

## What "bounded" means

A local bring-up (in CI or on a developer machine) must never be able to hang
with no deadline. An unbounded wait on a service that never becomes healthy is
the same defect class as FuzeInfra#760 (`permit-schema-sync` hanging with no
deadline): the job silently burns the runner's default timeout (360min on
GitHub-hosted runners) instead of failing fast with an actionable message.

Every bounded local-up step in this repo must have **two** deadlines, not one:

1. **Inner** — a real timeout on the wait primitive itself (`docker compose up
   --wait --wait-timeout <seconds>`, not bare `--wait`; confirmed via `docker
   compose up --help` that `--wait` alone has no deadline — `--wait-timeout` is
   a separate, opt-in flag). On timeout, dump `docker compose ps` (per-service
   health state) plus the tail of `docker compose logs`, so the failure message
   names *which* service never went healthy instead of just "failed".
2. **Outer** — `timeout-minutes:` on the job, as a backstop in case the inner
   deadline itself misbehaves (e.g. compose hangs pre-`--wait`, or a step after
   it hangs). This is a backstop, not the primary mechanism — a job-level
   timeout with no inner deadline still burns most of its timeout budget with
   no diagnostic about which service was stuck.

## Detection contract (what makes a repo "have" bounded local-up)

Both `gate-localup` and `nightly-integration.yml`'s `integration` job look for
the same two files, checked in with `git ls-files` so a gitignored or untracked
compose file doesn't count:

- **`docker-compose.consumer-test.yml`** (repo root or any subdirectory) — the
  bounded stack: FuzeInfra services the app actually depends on, addressed by
  container name exactly as production would (`postgres`, `redis`, …), plus the
  external-service mock matrix (MailHog / Twilio-mock / Permit-offline /
  Stripe-test / Prism-MSW / LocalStack as applicable) standing in for anything
  that would otherwise need real prod egress. **No real external host may be
  contacted** — that's the boundary `local-env-verifier` checks.
- **`versions.env`** next to it (optional) — pinned image tags for the stack,
  loaded via `--env-file` if present.

`nightly-integration.yml` additionally needs a runnable suite, detected in this
order: an npm script `test:integration` or `test:e2e` in `package.json` → a
`tests/integration/**` tree or files using `pytest.mark.integration` → an
`integrationTest` command declared in `.fuze/manifest.json`.

## Current state in FuzeFront (measured 2026-09-23, supersedes 2026-08-27)

- **Present (devops-engineer half, FuzeFront#1096, #1164)**:
  `docker-compose.consumer-test.yml` + `versions.env` now exist at repo root —
  the bounded local-up: `postgres` (real base service) plus the mock matrix
  (`mailhog`, `permit-pdp-test` in offline mode, `stripe-mock`, `mock-llm`),
  each addressed by container name on the `consumer-test` network and
  published on prod-parity host ports. Adapted from `docker-compose.test.yml`
  (the PR-level harness) per the contract above — container-name addressing
  instead of host-remapped ports. `redis`/`kafka`/`chromadb` are deliberately
  deferred: neither suite below exercises them yet, and including them would
  risk `nightly-integration.yml`'s 180s `--wait-timeout` (`docker compose up
  --wait` blocks on every declared service's healthcheck, not just the ones a
  given suite needs) for no benefit — add one when a suite actually needs it.
- **Present (test-engineer half, FuzeFront#1096, #1159)**: root `package.json`
  now declares `"test:integration": "node scripts/test-integration.mjs"`, so
  the npm branch of the detection order above matches. That script
  orchestrates the real suites that already exist: backend's
  `auth`/`apps`/`permissions` integration tests (`backend/package.json`
  `test:integration`, DB-required, same as `ci.yml`'s `integration-tests` job)
  and billing-service's DB-backed invoice-store + keyset-pagination-walk suite
  (`services/billing-service/tests/integration/invoices.integration.test.ts`,
  now wired to its own `test:integration` script; self-skips with a stated
  reason when `DATABASE_URL` is unreachable).
- **Both halves now landed together**: with the compose file/`versions.env`
  (#1164) and the `test:integration` entry point (#1159) merged on the same
  branch, `nightly-integration.yml`'s detector — which requires **both** the
  compose file **and** a suite — has both conditions satisfied at once for the
  first time, so the job stops no-op'ing green and actually stands up the
  stack and runs the suite on its next scheduled/dispatched run.
- **`nightly-integration.yml` bridges container-name addressing to the
  runner**: the suite runs as a plain process on the GitHub-hosted runner, not
  inside a container on the `consumer-test` network, so it cannot resolve
  `postgres`/`permit-pdp-test` by container-name DNS. A step exports
  `DB_HOST=localhost` / `PERMIT_PDP_URL=http://localhost:7000` (the published
  host ports) after `docker compose up --wait` succeeds, so
  `scripts/test-integration.mjs`'s container-name-addressed defaults still
  resolve correctly in CI.
- **Present and correct**: the CI machinery itself (detection, bounded-wait
  hardening with `--wait-timeout` + `timeout-minutes`, diagnostic dump on
  failure, teardown-always, the autofix loop-guard).
- **Not covered by this pass**: the no-prod-egress boundary check
  (`local-env-verifier` scope) — nobody has stood the stack up and confirmed no
  real external host is contacted; neither PR's sandbox had a Docker daemon
  available to `docker compose up` the stack, so that verification is
  explicitly deferred, not claimed here. The first real exercise will be
  `nightly-integration.yml`'s next scheduled/dispatched run now that both
  halves are on `master`.

## Ratchet plan

`gate-localup` **warns** (does not fail the PR) when no
`docker-compose.consumer-test.yml` is found — see the `::warning
title=local-up::` step. It is not yet in the `fail` set because 0 repos in the
fleet have the stack wired, so failing today would block every PR everywhere
with no fix path. Once a repo's consumer-test stack + suite land (closing its
`nightly-integration.yml` no-op), `gate-localup` should ratchet to **fail** for
that repo specifically — mirroring the `gate-frames-first`
`ratchet.knownUncovered` pattern in `governance/frames-first-policy.json`.
Owner: `@izzywdev` (same as the frames-first ratchet).
