# Shared packages & middleware — publish from FuzeFront to GitHub Packages

**Status:** Governance rule · **Date:** 2026-08-04 · **Mechanism corrected:** 2026-09-02

## The rule

**Any reusable middleware or library that more than one microservice needs — Express or Python — is exported as a versioned, published package, and every microservice consumes it from the registry.**

It is **never** left as an in-repo workspace-only package, copied between services, or re-implemented per service. If two services would share code, it becomes a published package first.

This is what keeps the family consistent: one implementation, one version line, one place to fix a bug. Drift between hand-copied middleware is exactly the failure this rule exists to prevent.

## What counts as "shared middleware"

- **Express side:** cross-cutting request/DB middleware and infra utilities — e.g. the transactional-outbox `enqueueEvent` + outbox relay (`@fuzefront/core`), auth/tenant middleware, the DB bootstrap.
- **Contract side:** event schemas, topic registry, and the typed Kafka client (`@fuzefront/shared/kafka`).
- **Python side:** the equivalent library for Python microservices (outbox write + relay + Pydantic contract mirror).

If it's product/domain logic that only one service owns, it does **not** belong in a shared package — keep it in the service.

---

## How packages are published: the ALIAS mechanism

> **This section previously described publishing `@fuzeone/*` to a `fuzeone` GitHub org. That is not what happens, and it is not what should happen.** There is no `fuzefront` org, and the `FuzeOne` org owns no repositories. GitHub Packages requires the npm scope to equal the account that **owns the repository**, and this repo is owned by the personal account **`izzywdev`**. A workflow gated on an org that never matched is why, for a long time, *not one package had ever been published* while every run went green.

Packages publish to **GitHub Packages** (`https://npm.pkg.github.com`) from one workflow, `.github/workflows/packages-publish.yml`, driven by `scripts/publish-packages.mjs`. The canonical names stay in the source tree; the script **renames at publish time**:

| in the tree (canonical) | in the registry (aliased) |
| --- | --- |
| `@fuzefront/design-system` | `@izzywdev/fuzefront-design-system` |
| `@fuzefront/core` | `@izzywdev/fuzefront-core` |
| `@fuzeone/selection-lists-ui` | `@izzywdev/fuzeone-selection-lists-ui` |
| `@izzywdev/fuzefront-sdk-react` | unchanged (already owner-scoped) |

The rule is `aliasFor()` in `scripts/publish-packages.mjs`:

```js
const OWNER_SCOPE = '@izzywdev'
const SCOPE_ALIASES = {
  '@fuzefront/': 'fuzefront-',
  '@fuzeone/': 'fuzeone-',
}
// @fuzeone/selection-lists-ui -> @izzywdev/fuzeone-selection-lists-ui
```

`@fuzeone/*` is a real, deliberate second canonical scope (EPIC-17 records the decision), not a mistake to be migrated away. It is aliased exactly like `@fuzefront/*`; both land under `@izzywdev`.

**In-family dependencies are rewritten too.** A published package whose `dependencies` still named `@fuzefront/chat-client` would be uninstallable — that name resolves to nothing on any registry. `rewriteForPublish()` aliases every in-family dependency name and replaces `file:`/`workspace:` specifiers with the target's real version. This is the part the earlier one-off per-package publishers got wrong.

### The guard: `assertAliasable()`

A canonical scope with no entry in `SCOPE_ALIASES` is not publishable at all — `npm publish` answers `403 permission_denied`. That used to surface as one red matrix leg among two dozen green ones, which reads as flakiness: `@fuzeone/selection-lists-ui` 403'd on **every** run, so a green `packages-publish` proved nothing.

`assertAliasable()` now throws in the **`verify` job**, before any package is uploaded, if any publishable workspace resolves to a name outside `@izzywdev`. The error names the offending package and the one-line fix (add the scope to `SCOPE_ALIASES`, or mark the workspace `"private": true`). Matrix resolution aborts, nothing ships half-way, and publishing is idempotent — so the re-run after the fix is a clean full release.

### What makes a package publishable

**The root `package.json` `workspaces` array. That is the only list.** `publishable()` = every non-`private` workspace with a `name`. There is no second register to add yourself to.

This matters more than it sounds: a package with perfect `publishConfig` that is **not** a root workspace produces **no matrix leg at all**, so `packages-publish` never attempts it and goes green anyway. `api-client/` and `sdk/` sat in that state — invisible, not failing — until they were added as workspaces (`selection-list-client/` is still in it today). Absence is silent; check the registry, not the run conclusion.

`auto-merge.yml` used to keep its own hand-maintained regex of publishable directories and had already drifted three packages. It now derives the list from `node scripts/publish-packages.mjs --list-dirs`, so there is one source of truth rather than a mirror.

### Verifying a release

**The registry read is the acceptance test, not the run conclusion.**

```bash
gh api users/izzywdev/packages/npm/fuzeone-selection-lists-ui/versions --jq '[.[].name]'
# ["0.1.0"]
```

## How a microservice consumes them

- **Node:** map the **`@izzywdev`** scope to the registry in `.npmrc` — this repo's own `.npmrc` does exactly this, and mapping `@fuzefront`/`@fuzeone` instead points a scope at an owner that does not exist:

  ```
  @izzywdev:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
  ```

  Then depend on the pinned published version — not a `workspace:*`/`file:` path in production consumers:

  ```jsonc
  { "dependencies": { "@izzywdev/fuzefront-core": "^1.0.0" } }
  ```

  If you want to keep the canonical import specifier in your source, use an npm alias:

  ```jsonc
  { "dependencies": { "@fuzefront/core": "npm:@izzywdev/fuzefront-core@^1.0.0" } }
  ```

  Inside **this** repo no mapping is needed: `@fuzefront/*` and `@fuzeone/*` are npm workspaces that npm links from the working tree and that never touch a registry.

- **Python:** publish to PyPI via the tag-triggered `python-publish.yml` reusable workflow (e.g. `selection-list-client-py-publish.yml`, tag `selection-list-client-py/v*`), and pin the version in the consumer. PyPI trusted publishing needs a one-time human setup in the PyPI UI.

## Versioning

SemVer, enforced the same way as the rest of the family (`gate-version` bump discipline). **Versions are bumped in the PR, not by the publish job** — master enforces `required_signatures`, so an unsigned version commit pushed from Actions would be rejected after the publish had already happened. A package publishes when its version changes; if it does not change, the run skips it and says so.

A breaking change to a shared middleware package is a major bump and a coordinated consumer update — treat it like the Module-Federation React-singleton contract: shared, therefore load-bearing for everyone.

## Status of the event-propagation packages

Verified against the registry on 2026-09-02 (`gh api users/izzywdev/packages?package_type=npm`):

| Canonical name | Role | Registry name | State |
|---|---|---|---|
| `@fuzefront/shared` (`/kafka`) | event contract + typed client + registry | `@izzywdev/fuzefront-shared` | **Published** `1.0.0` |
| `@fuzefront/core` (outbox + relay) | Express-side transactional-outbox middleware | `@izzywdev/fuzefront-core` | **Published** `1.0.0` |
| Python events lib | outbox + relay + Pydantic contract mirror | PyPI | **Not published** (FFRNT-176) |

The org-transfer framing of this rule is retired: the alias mechanism satisfies it today under `@izzywdev`. If a `fuzefront`/`fuzeone` org is ever created and owns these repos, the migration is two edits — `OWNER_SCOPE` in `scripts/publish-packages.mjs` and the scope line in `.npmrc` — and the canonical names in the tree never move. See `docs/planning/entity-lifecycle-event-propagation.md` § Distribution & packaging.
