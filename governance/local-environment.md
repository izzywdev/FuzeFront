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

## Current state in FuzeFront (measured 2026-08-27)

- **Not present**: `docker-compose.consumer-test.yml`, `versions.env`, and no
  suite matches the detection order above (root `package.json` has no
  `test:integration`/`test:e2e` script; `.fuze/manifest.json` has no
  `integrationTest`; the one `tests/integration/` tree,
  `services/billing-service/tests/integration/invoices.integration.test.ts`, is
  a real Jest file but isn't wired to a `test:integration` script anywhere, so
  the detector correctly does not count it).
- Both `gate-localup` and `nightly-integration.yml`'s detector therefore
  correctly no-op (green, not a false failure) and `nightly-integration.yml`
  files the idempotent `@claude` tracking issue — which is FuzeFront#242.
- **Present and correct**: the CI machinery itself (detection, bounded-wait
  hardening with `--wait-timeout` + `timeout-minutes`, diagnostic dump on
  failure, teardown-always, the autofix loop-guard). Building the actual
  consumer-test stack + mock matrix + integration suite is unstarted and is
  the real remaining work on #242 — it needs FuzeInfra vendored as a submodule
  and a mock-service matrix decision, which is `devops-engineer` +
  `test-engineer` scope per the issue, not a mechanical follow-up.

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
