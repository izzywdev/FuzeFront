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

- **Present (test-engineer half, FuzeFront#1096)**: root `package.json` now
  declares `"test:integration": "node scripts/test-integration.mjs"`, so the
  npm branch of the detection order above matches. That script orchestrates
  the real suites that already exist: backend's `auth`/`apps`/`permissions`
  integration tests (`backend/package.json` `test:integration`, DB-required,
  same as `ci.yml`'s `integration-tests` job) and billing-service's DB-backed
  invoice-store + keyset-pagination-walk suite
  (`services/billing-service/tests/integration/invoices.integration.test.ts`,
  now wired to its own `test:integration` script; self-skips with a stated
  reason when `DATABASE_URL` is unreachable).
- **Still not present (devops-engineer scope)**: `docker-compose.consumer-test.yml`
  and `versions.env`. Because `nightly-integration.yml`'s detector requires
  BOTH the compose file AND the suite, it still correctly no-ops green today —
  the suite alone does not flip it on. The closest wired reference for the
  compose file is `docker-compose.test.yml` at repo root, which already pins
  the same base-service versions FuzeInfra runs plus the external-service mock
  matrix (MailHog, `permit-pdp-test` in offline mode, `stripe-mock`,
  `mock-llm`) this suite expects — landing `docker-compose.consumer-test.yml`
  is expected to be an adaptation of that file (container-name addressing
  instead of host-remapped ports), not a from-scratch build. FuzeInfra is
  already vendored as a submodule (`.gitmodules`), so that specific piece of
  #1096's devops task is also already done.
- **Not covered by this pass**: the no-prod-egress boundary check
  (`local-env-verifier` scope) — there is no bounded stack yet to verify it
  against.

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
