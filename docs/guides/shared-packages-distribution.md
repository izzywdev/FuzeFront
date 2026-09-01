# Shared packages & middleware — publish from FuzeFront to the `fuzeone` org

**Status:** Governance rule · **Date:** 2026-08-04

## The rule

**Any reusable middleware or library that more than one microservice needs — Express or Python — is exported as a versioned package from FuzeFront to the GitHub [`fuzeone`](https://github.com/fuzeone) org, and every microservice consumes it from there.**

It is **never** left as an in-repo workspace-only package, copied between services, or re-implemented per service. If two services would share code, it becomes a published package first.

This is what keeps the family consistent: one implementation, one version line, one place to fix a bug. Drift between hand-copied middleware is exactly the failure this rule exists to prevent.

## What counts as "shared middleware"

- **Express side:** cross-cutting request/DB middleware and infra utilities — e.g. the transactional-outbox `enqueueEvent` + outbox relay (`@fuzefront/core`), auth/tenant middleware, the DB bootstrap.
- **Contract side:** event schemas, topic registry, and the typed Kafka client (`@fuzefront/shared/kafka`).
- **Python side:** the equivalent library for Python microservices (the `fuzeone-events` package — outbox write + relay + Pydantic contract mirror).

If it's product/domain logic that only one service owns, it does **not** belong in a shared package — keep it in the service.

## How packages are published (current mechanism)

Packages publish to **GitHub Packages** (`https://npm.pkg.github.com`) via per-package publish workflows under `.github/workflows/*-packages-publish.yml` (e.g. `packages-publish.yml`, `auth-ui-packages-publish.yml`, `security-packages-publish.yml`). A package opts in by declaring `publishConfig` in its `package.json` (see `packages/auth` and `packages/feature-flags` for the pattern) and getting an entry in a publish workflow.

**Target org — `fuzeone`.** GitHub Packages requires the npm scope to match the owning org, so packages published to the `fuzeone` org are scoped **`@fuzeone/*`** (e.g. `@fuzeone/express-outbox`, `@fuzeone/events`). Python ships the equivalent `fuzeone-events` distribution. Legacy `@izzywdev/fuzefront-*` packages migrate under the `fuzeone` org over time.

> The exact `@fuzeone/*` package names above are the working convention; confirm/adjust when wiring the publish workflow.

## How a microservice consumes them

- **Node:** map the scope to the registry in `.npmrc` (the repo already does this for `@fuzefront`):
  ```
  @fuzeone:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
  ```
  then depend on the **pinned published version** (`"@fuzeone/express-outbox": "^1.2.0"`) — not a `workspace:*`/`file:` path in production consumers.
- **Python:** install `fuzeone-events` from the org's package index and pin the version.

## Versioning

SemVer, enforced the same way as the rest of the family (`gate-version` bump discipline). A breaking change to a shared middleware package is a major bump and a coordinated consumer update — treat it like the Module-Federation React-singleton contract: shared, therefore load-bearing for everyone.

## Status of the event-propagation packages

| Package | Role | Published to `fuzeone`? |
|---|---|---|
| `@fuzefront/shared` (`/kafka`) | event contract + typed client + registry | **Not yet** on `fuzeone` — but published today as **`@izzywdev/fuzefront-shared@1.0.0`** |
| `@fuzefront/core` (outbox + relay) | Express-side transactional-outbox middleware | **Not yet** on `fuzeone` — but published today as **`@izzywdev/fuzefront-core@1.0.0`** |
| `fuzeone-events` (Python) | outbox + relay + Pydantic contract mirror | **Planned** (FFRNT-176) — publish from the start |

Making these three publishable to the `fuzeone` org is the remaining step to satisfy this rule; see `docs/planning/entity-lifecycle-event-propagation.md` § Distribution & packaging.
