<!--
Copy this file to results/<YYYY-MM-DD>-<runner-handle>.md and fill it in
AFTER actually running the procedure in app-onboarding-benchmark.md.

Do not estimate or back-fill numbers. Every field below must reflect
something you observed while running the procedure. If you skipped a
phase, write "not run" — do not leave the field blank (ambiguous) or
guess a number (invalidates the result).
-->

# App onboarding benchmark result

- **Runner:** <github handle or name>
- **Date:** <YYYY-MM-DD>
- **FuzeFront commit SHA:** <git rev-parse HEAD>
- **Benchmark spec version used:** app-onboarding-benchmark.md v1
- **Registration path used:** quickstart (`psql` insert) — the scored default | onboarding-kit (`register.sh`), run against a separately stood-up `applications` service outside the public e2e stack — label clearly and do not mix with quickstart numbers
- **Cold or warm run:** cold (first run on this machine, nothing cached) | warm

## Environment

| Field | Value |
|---|---|
| OS + version | |
| CPU cores | |
| RAM | |
| Docker version | |
| Docker Compose version | |
| Node version | |
| npm version | |
| Network (if relevant, e.g. slow link affecting image pulls) | |

## Phase 0–1: App 1 (`clock-app`)

| Dimension | Value | Notes |
|---|---|---|
| D1 — clone → healthy stack | `<minutes:seconds>` | |
| D2 — standalone app → mounted app | `<minutes:seconds>` | |
| D3 — manual steps (count) | | list them |
| D4 — FuzeFront-repo files/edits (count) | | list them |
| D6 — failures hit | | one row per failure: error text / was it in the documented troubleshooting? / time to resolve |

## Phase 2: App 2 (second trivial app — name it: `<app-2-name>`)

| Dimension | Value | Notes |
|---|---|---|
| D2 — standalone app → mounted app | `<minutes:seconds>` | |
| D3 — manual steps (count) | | list them |
| D4 — FuzeFront-repo files/edits (count) | | list them |
| D6 — failures hit | | |

## D7 — repeated-effort delta (App 1 − App 2)

| Dimension | App 1 | App 2 | Delta |
|---|---|---|---|
| D2 | | | |
| D3 | | | |
| D4 | | | |

State plainly whether App 2 was easier, the same, or harder than App 1, and
why — including if the result does **not** support the thesis.

## Phase 3: Kubernetes path (optional)

| Dimension | Value | Notes |
|---|---|---|
| D5 — deploy steps (count) | | list them, or "not run" |

## Summary (2–5 sentences)

<What this run shows, in plain language. Call out anything that surprised
you, any step the docs got wrong, and any step you had to improvise that
isn't documented anywhere — that's a gap worth its own issue.>
