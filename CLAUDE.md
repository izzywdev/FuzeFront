# FuzeFront — repo overlay (L1)

This repo's `CLAUDE.md` **extends** the FuzeSDLC baseline. It does not duplicate it; where this overlay conflicts with the baseline, **this repo wins**, otherwise the baseline governs.

- **Baseline (L0):** https://github.com/izzywdev/FuzeSDLC/blob/main/CLAUDE.baseline.md (precedence: repo overrides baseline)
- **Tier:** `product`
- **Expert:** `fuzefront-expert` — consult it first on any task to load architecture/deploy/gotcha context (it advises, it does not gate or own deliverables).
- **Manifest:** `.fuze/manifest.json` declares the instantiated agent subset, design-system base, and hardening.

Read the baseline for the full governance model (3 layers, repo tiers, single-responsibility agents, contract-first fan-out, signed/merged-PR delivery, async orchestration, cross-repo `@claude` delegation). What follows is only the FuzeFront-specific overlay.

## What FuzeFront is

- **Module-Federation host shell.** FuzeFront is the host/container application; consuming products and micro-frontends are federated remotes mounted into the shell. Keep the shell's shared-dependency contract (React, the design system) stable — remotes consume it.
- **Backend:** Express + Postgres, with **Authentik** (identity/SSO) and **Permit** (authorization) for auth. The frontend talks to the API on a **same-origin API base** (no cross-origin base URL) so it works identically under local TLS and prod ingress — never hard-code an absolute API host.
- **Runs on FuzeInfra.** Deploys to Kubernetes (kind-fuzeinfra locally / Contabo k3s prod) via Helm. Infra changes are **delegated to FuzeInfra via `@claude`** — never edit FuzeInfra or operate the cluster from here.

## Helm values hygiene — don't cast around a missing default, restore it

`helm lint` and `kubeconform` are **static schema** checks: they confirm a rendered value has the right *shape*, not that it is semantically valid. This gap shipped a real outage (FuzeInfra#501): a large `values.yaml` restructuring (#523) accidentally dropped `authentik.networkPolicy.port` (and its sibling namespace keys). With the key gone, `{{ $np.port }}` rendered as nil, which correctly failed kubeconform's `oneOf: [integer, string]` schema check for `NetworkPolicyPort.port` — but the fix applied was `{{ $np.port | int }}`, and Sprig's `int` filter silently converts nil to `0`. `0` **is** a valid integer, so kubeconform went green — while the live API server correctly rejects `port: 0` (must be 1–65535) at admission time, which nothing else in CI exercises. Every Argo sync of the whole `fuzefront` Application failed for days before anyone noticed (fixed in #534).

- **A coercion filter on a `.Values.` lookup (`| int`, `| default X`, `| toString`, …) is a signal to investigate, not a fix for a lint failure.** If kubeconform/helm-lint complains about a missing or wrong-shaped value, find out *why* it's undefined before reaching for a cast. If the field is genuinely optional, declare the default explicitly in `values.yaml` where a reviewer can see it — don't let the template silently absorb a missing value at the render site. `gate-networkpolicy-ports` (`helm-validate.yml`) now catches the specific case of a NetworkPolicy port rendering out of range, but it does not generalize to every field a naked cast could mask.
- **A "fix missing defaults" commit whose diff is dominated by deletions is a restructuring, not an addition** — self-review it accordingly: diff `helm template` output for every values overlay (`values.yaml`, `values-local.yaml`, `values-prod.yaml`) before vs. after, not just the line-level YAML diff, since a reordered/consolidated file makes an eyeballed diff unreliable.
- **Two PRs touching the same top-level `values.yaml` key concurrently is the highest-risk moment for this class of bug** — if your branch has been open a while and merges master while another active PR is landing changes to the same key (e.g. two sibling `networkPolicy` blocks), diff exactly that region post-merge instead of trusting the auto-resolution.

## Toolchain baseline — Node 24 LTS / React 19 are a floor, not a suggestion

These are **minimums every manifest, image, workflow and remote must meet.** FuzeFront is the Module-Federation host, so its React major *is* the shared-singleton contract for the whole family — drift here does not surface as a version warning, it surfaces as a white screen in somebody else's app.

| Thing | Mandated minimum | Declared in |
|---|---|---|
| Node | `>=24.0.0` (Krypton, Active LTS) | `engines.node` in every manifest; `.nvmrc` = `24` |
| npm | `>=10.0.0` | `engines.npm` |
| `@types/node` | `^24.13.3` | every manifest |
| `react` / `react-dom` | `^19.2.0` | app dependencies |
| React peer range | `^19.0.0` | `peerDependencies` of every published `@fuzefront/*` package + the SDK |
| `@types/react` / `@types/react-dom` | `^19.2.0` | root **and** `design-system` (it ships `.d.ts` that import React types) |
| MF shared `requiredVersion` | `^19.0.0` | host `frontend/vite.config.ts` **and** every remote |
| Docker base image | `node:24-alpine` / `node:24-bookworm-slim` | every Dockerfile |
| CI runner | `node-version: '24.x'` | every workflow |

- **Raising the floor is fine; lowering it is a breaking change to the family.** Node 18/20/22 and React 18 no longer satisfy these manifests. Bumping the React major means bumping the host, both in-repo remotes, every published peer range and every out-of-repo consumer together — it is never a single-package decision.
- **Host and remote `requiredVersion` must be identical.** If they differ, the remote silently loads its own React copy and dies on "Invalid hook call" at runtime, in the browser, with nothing in CI to catch it.
- **Out-of-repo remotes are bound by this too.** React 18 consumers fail peer resolution against the published packages; see `docs/guides/BUILDING_ON_FUZEFRONT.md`.
- **Nothing enforces this yet.** No CI job reads `engines`, `.nvmrc`, the peer ranges or the MF `requiredVersion` — `gate-version` only checks SemVer bump discipline. Until a `gate-toolchain` exists, this table is the source of truth and the rule survives on review alone. Frozen point-in-time records under `docs/superpowers/plans/`, `sdd/` and `docs/chats/` deliberately still quote the versions current when they were written; they are history, not governance.

## Design system — FuzeFront IS the base

- FuzeFront publishes the **"fuse seam" design system** as the base package **`@fuzefront/design-system`** — the single source of truth for color/spacing/type/primitives for the whole Fuze family.
- **Consuming apps extend this base** (add tokens / compose components) in their own repo-local DS package; they **never fork or redefine the primitives**. In this repo the DS package *is* the base (`extendsAs` = `@fuzefront/design-system`).
- `frontend-engineer` is the **sole** editor of `design-system/`. No raw hex/spacing/type in feature code — use the tokens. If a primitive is missing, add it to the base via the design-system skill rather than one-off styling.

## Hardening / signing — bot-pushed branches MUST be signed (deploy-sensitive)

This repo enables `required_signatures` on `master`, and **`master` is deploy-on-push**: `release.yml`, `sdk-publish.yml`, and `packages-publish.yml` push **directly to `master`** and trigger deploys/publishes.

- Those workflows must produce **signed** commits, or `required_signatures` rejects the push. Use one of:
  - commit via the **GitHub API / `gh api`** (server-side commits are Verified), or
  - run the workflow under an **admin / GitHub App identity** whose commits are signed.
- Human/agent commits are signed via SSH signing (baseline §8 / `governance/hardening-convention.md` §3). Feature-branch commits may be unsigned; the **squash-merge is signed**.
- Because `master` deploys/publishes on push, **a merge here IS a production deploy.** Hand-deploying to prod is forbidden either way — prod is GitOps, so the deploy happens by merging, never by a human touching the cluster.
- **Auto-merge is the intended path here; bot-merging is expected.** `auto-merge.yml` arms the merge and its `dispatch-release` job then dispatches `release.yml`. The policy, the reasoning, and where a real block would have to live are in the canonical **`governance/hardening-convention.md` §6** — not restated here, because an overlay that restates canonical policy drifts from it silently (`governance_sync` does not reconcile a consuming repo's `CLAUDE.md`). See FuzeSDLC#139 for the correction that established this.

## Feature flags — FuzeFront HOSTS the family flag service

The family flag standard is **Unleash** (self-hosted OSS) consumed via **OpenFeature** + the private **`@fuzefront/feature-flags`** client (baseline §10). **FuzeFront hosts the Unleash deployment** and owns flag management for the family — consuming repos point their provider at FuzeFront's Unleash with a scoped client token.

- `feature-flags-engineer` owns the Unleash config + flag taxonomy (`<repo>.<domain>.<flag>`) + flag administration here. The Unleash *deploy mechanics* (Helm/Argo/CI on FuzeInfra) are `devops-engineer`; the `@fuzefront/feature-flags` *client package build* is `backend-engineer`.
- `backend-engineer` + `frontend-engineer` plan with flags: wrap new/risky work in a flag **default OFF**, gate **both** server logic and UI, **test both states**, retire stale flags (owner + removal criterion each). A **permission** flag is rollout convenience — real authz stays in **Permit**, never the flag.
- See the `feature-flags` skill (`.claude/skills/feature-flags/`).

## Android / TWA mobile package

FuzeFront ships a signed Android APK (Trusted Web Activity) that wraps `https://app.fuzefront.com`. CI handles all building and signing — no manual steps.

### CI behaviour
- **Any `frontend/**` push to `master`** triggers `build-android-apk.yml`: builds a signed APK and creates a GitHub Release (`android-vN`).
- **Any PR** touching `android/**`, `frontend/public/**`, or `frontend/src/**` also runs the build and uploads a `fuzefront-android-vN` artifact for pre-merge testing — but does **not** publish a Release.
- `workflow_dispatch` is available on the workflow for manual builds with a custom version code.

### Key identity files — keep in sync
| File | Purpose |
|------|---------|
| `android/twa-manifest.json` | Bubblewrap TWA config (host, colors, SHA-256 fingerprint) |
| `frontend/public/.well-known/assetlinks.json` | Digital Asset Links (same fingerprint as above) |
| `frontend/public/manifest.webmanifest` | Static PWA manifest served during scaffold |
| `frontend/public/icons/pwa-{192,512,maskable-*}.png` | App icons |

If you rotate the signing keystore or change the key alias, all four files must be updated and `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_STORE_PASSWORD` / `ANDROID_KEYSTORE_KEY_PASSWORD` GitHub Secrets must be rotated.

### Agent ownership
- `devops-engineer` — CI/signing pipeline (`android/**`, `build-android-apk.yml`)
- `mobile-frontend-engineer` — responsive shell layout, drawer sidebar, touch targets, PWA/TWA viewport constraints, mobile breakpoints
- `frontend-engineer` — PWA manifest, icons (`frontend/public/`), and design-system non-mobile primitives
- **Never commit `android/keystore/*.keystore`** — gitignored; stored only in `ANDROID_KEYSTORE_B64`.

## Design-first gate — HTML frames are the source of truth (PenPot is parked)

**No UI is written before its design is approved.** This closes the SDLC gap that let unverified CSS ship, and — more importantly — that let six fully-built Security backends ship with **no UI at all** and nothing to catch it. Plan of record: `docs/planning/design-first-ui-pipeline.md`.

**Frames stay in this repo — always. FuzeX manages their lifecycle, not their storage.** An earlier extraction (2026-08-10) briefly required *new* features to author frames directly in `izzywdev/FuzeX`'s `design-frames-service` instead of this repo; that was wrong and was corrected the next day (2026-08-11). Frames are data, like a `.fig` file — they're authored and version-controlled here, in every feature's own `design/frames/<feature>/`, exactly as before. What moved to FuzeX is the **lifecycle machinery**: per-flow approval/reject bound to a content stamp, and a navigable review site, shared with other products instead of reinvented per repo. See `.claude/skills/design-frames-lifecycle/SKILL.md` for the sync procedure, and FuzeX's `services/design-frames-service/docs/EXTRACTION.md` for the correction record.

**The authoritative design artifact for every feature is a set of navigable HTML frames in this repo** — `design/frames/<feature>/` (`index.html` entry + ordered `01-*.html` screens + `tokens.css` + `manifest.json`), published to GitHub Pages for review, and optionally synced into `design-frames-service` (see `design-frames-lifecycle`) for per-flow approval/reject and its navigable review site. Not PenPot. PenPot is **parked** by owner decision; it complicates the loop without earning it, and a design tool that is not in the repo cannot be gated by CI. Frames are code: they diff, they review, they enforce.

### Flow
1. **`product-designer`** — the **sole** author of `design/frames/**` and the UX/UI owner — turns the product requirement/user story into frames. **Not `frontend-engineer`**: the implementer must not author the spec it is measured against, exactly as `contract-designer` (not `backend-engineer`) owns the API spec.
2. **Frames are ALWAYS their own PR, and its only content.** CI on it enforces the UX/UI policy: `gate-ds-conformance`, `gate-frames-schema`, `gate-frames-stamped`.
3. The frames declare the **build inventory** (flows / React components / npm packages) — rendered in `index.html`, mirrored in the manifest. Approving the design approves the architecture, so implementation cannot quietly invent a different one.
4. The owner approves **per flow** — one ready flow never waits on an unready sibling. **Reject re-dispatches `product-designer`** for an improving iteration; it does not close the thread.
5. **Merging an approved frames PR is the trigger**: UX QA agents write Playwright specs for each flow that are **ALL RED** first (TDD — the specs fail before an implementation exists), then `frontend-engineer`s build components → flow orchestrators → packages, until the specs go green.
6. `frontend-test-engineer` verifies the built UI against the approved frames.

### States are contract, not decoration
Frames must show loading, empty, error, and the real fail-closed cases (reveal-once token; remove-last-2FA-factor → 409; demote-the-last-admin; `hasPassword: null` → "set a password first"). **Frames that show only the happy path produce UI that only handles the happy path.**

### Enforcement — the rule, not the etiquette
`gate-frames-first` (`.github/workflows/gate-frames-first.yml` → `scripts/check-frames-first.mjs`) fails any PR touching feature UI (`frontend/src/**`, `packages/*-ui/**`) that a `design/frames/<feature>/manifest.json` covers without the covering **flow** being approved. Governance nobody can skip beats a step someone is supposed to remember — the whole reason this gate exists is that pushing feature UI with no approved frames was *possible*.

> **This section described the gate as existing for months while no workflow implemented it** — `grep -rl gate-frames-first .github/workflows/` returned nothing. The un-skippable rule was the only part of the pipeline that could actually be skipped. It is wired now, but read the two mechanics below rather than assuming the one-line summary is the whole contract; the same "a check is green so it must be working" mistake is documented under the branch-lifecycle section.

- **Coverage is declared, never inferred.** `frontend/src/**` and `packages/*-ui/**` carry no feature slug, and slugs do not map to directories (`devices-sessions` and `mfa-management` both build into `packages/account-security-ui`). So a manifest states what it covers — `implementation.paths` at feature level, `build.flows[].implementation.paths` per flow — and the gate matches against that. A path no manifest claims is **uncovered**, not silently fine.
- **The ramp is real and has an owner.** `governance/frames-first-policy.json` holds the strength. Covered-but-unapproved **always** fails. Uncovered is `mode: "warn"` today because **0 of 18 manifests declare `implementation.paths`**, so failing there would block every UI PR in flight (verified: it would have failed #585 and #591, both of which legitimately shipped). Flip to `fail` once the `ratchet.knownUncovered` worklist is claimed — owner `@izzywdev`. Mirrors the `gate-ds-conformance` changed-lines ratchet.

`gate-frames-schema`, also named above, **still does not exist** — nothing validates a manifest against `design/frames/_template/manifest.schema.json`.

## UI runtime validation — the console-clean gate

Design-review checks how the UI *looks*; this gate checks how it *runs*. A UI change that type-checks, passes vitest, and matches its approved frame can still be broken at runtime — an uncaught exception, a 404 on a JS chunk, a **CSP / mixed-content** block under TLS, or a failed **Module-Federation** remote load. None of those surface in unit tests or a static frame diff.

**Mandate:** no UI work is "done" until it has been rendered in a real Chromium via the **Chrome DevTools MCP** (`chrome-devtools-mcp` plugin, marketplace `chrome-devtools-plugins`) and the **console is clean** — 0 errors, 0 CSP/mixed-content violations, 0 failed app requests, or every remaining message explained. This is a hard gate at every UI hat:

- **`frontend-engineer` / `mobile-frontend-engineer`** — dev-time **self-check** before reporting `SCOPE DONE` (mobile validates under device emulation).
- **`frontend-test-engineer`** — independent **QA**, on top of the Playwright run, pre- and post-production. A runtime console error is a bug to **REPORT**, never patched by QA.
- **`test-engineer`** (API/service) is excluded — it is browser-less by design.

The procedure, the FuzeFront gotchas (same-origin API base / no mixed-content under TLS, Module-Federation load), the full MCP capability map (console, network, Lighthouse/perf, a11y, device emulation, heap snapshots), and the DONE-report wording live in the **`ui-runtime-validation`** skill (`.claude/skills/ui-runtime-validation/`). The plugin must be installed in the session (`claude plugin marketplace add ChromeDevTools/chrome-devtools-mcp` → `claude plugin install chrome-devtools-mcp@chrome-devtools-plugins`); it is user/environment-scoped, not committed repo config.

## Agent worktree lifecycle — reap them, or agents stop launching

The Agent tool auto-removes an isolated worktree **only if it is unchanged**. Agents exist to change files, so in practice **every productive agent — and every agent killed mid-run** (API error, usage cap, timeout) — leaks its worktree and its `worktree-agent-*` branch. Nothing reaps them by default.

This is not cosmetic. Each worktree is a full checkout (~2k files, plus `node_modules` if the agent installed). Past **~50** the repo gets slow enough that `git worktree add` exceeds the launcher's timeout and **no agent can start at all** — a self-inflicted DoS. This has already happened here: a fan-out session reached 100+ worktrees and every subsequent launch failed with `Failed to create worktree` until they were reaped. On Windows the leak is worse to clean up — `node_modules` carries read-only attributes, so plain `rm -rf` fails with "Permission denied" and each `git worktree remove` can take minutes.

- **`scripts/reap-agent-worktrees.sh`** reclaims them. It runs automatically via the **`SessionStart` hook** in `.claude/settings.json`, so a fresh session self-heals; run it by hand any time launches start failing.
- **Safety contract: work is never destroyed.** A worktree is reaped only if it has **no uncommitted changes** AND **no unpushed commits**. Anything dirty or unpushed is reported under `KEPT` and skipped so it can be salvaged. There is deliberately no `--force`.
- `--dry-run` reports without changing anything.
- This is the local counterpart to the branch policy below: `governance-nightly` reaps stale *branches* on the remote; the reaper reaps stale *worktrees* on the developer's disk. Neither covers the other.

**This is also why the continuous-push rule matters twice over**: an agent that holds work only on local disk can have its worktree reaped-blocked (skipped, cluttering the box) and, if the box is wiped, lose the work entirely. Push early — the reaper only cleans what is safely on origin.

## `slug`, display name, and the federated serve path are THREE INDEPENDENT questions

**This is the canonical statement of the naming/addressing rule for the whole
FuzeFront app registry.** Every other doc that touches `slug`, `name`/`menuLabel`
prefixing, or the federated serve path is a pointer to this section, not a second
copy of it — see "Where else this is referenced" below. It has been re-litigated
four times across the fleet, each time by someone reasoning from a document instead
of from the code or the owner's own words, and each round mutated live manifests.

**Root cause, stated directly by the owner, 2026-08-19:**

> "the intention was that the slug could be whatever like fuzepicker or fuzeagent. I
> actually liked keeping the fuze prefix to distinguish from other apps. what I was
> trying to do is that the display name in the menu won't repeat the Fuze prefix to
> 16 or more products unless necessary like for fuzebi, and fuzeX. that's all"

**The prefix question was always about the menu label. It got misapplied to the
slug, four times.** That single conflation is the whole root cause of every
mutation below. The three facts that follow are independent — none of them implies
another, and no evidence about one is evidence about a different one.

### 1. `slug` — free at creation, immutable thereafter

Prefixed (`fuzepicker`, `fuzeagent`) or unprefixed (`picker`, `plan`) are **both
fine at registration**. The owner *likes* the prefix for distinguishing apps; there
is no correct form and no migration path from one to the other.

Once registered, `slug` is **immutable and never edited by any PR, in either
direction.** `PUT /apps/{slug}` has no rename operation, so a redeploy under a
changed slug **registers a second app and strands the first** — orphaned Permit
grants, CASCADE-deleted `app_installations` rows, a ghost tile in the launcher.

Owner ruling 2026-08-19 (also recorded in `packages/onboarding-kit/README.md`
§"prefix ON the slug, OFF the display string"): the field is *"not checked, in
either direction"*, and *"None of these are to be migrated"* — naming `deploy`,
`call`, `executive`, `finance`, `keys`, `market`, `picker` as unprefixed slugs to
leave alone and `fuzex`, `fuzebi` as prefixed ones not to be "corrected". The
guidance to prefix applies to a **genuinely new** product only, and is guidance,
not a gate.

`docs/runbooks/app-slug-deprefix-migration.md` is **RETIRED** — it implements
exactly the migration this rule forbids. Its tables are a historical snapshot of
measured state on 2026-08-19, not a worklist; do not act on them.

### 2. Display name / `menuLabel` — drop the `Fuze` prefix, with two named exceptions

Sixteen-plus products all reading "Fuze…" in one menu is noise — the prefix
carries no information when everything shares it. So `name` and `menuLabel` drop
it: register `"Sales"` / `"Sales"`, not `"FuzeSales"`, alongside `"slug":
"fuzesales"` which keeps it.

**Keep the prefix only where the remainder is meaningless or ambiguous on its
own** — the owner named exactly two: **FuzeBI** and **FuzeX**. "BI" and "X" alone
do not identify a product. This is guidance for the menu string only; it says
nothing about the slug, which follows rule 1 above regardless.

This is enforced in code by `validateSlugConvention()` in
`packages/onboarding-kit/bin/validate-registration.mjs` — but **that check has no
FuzeBI/FuzeX carve-out today**; it flags any `Fuze`-prefixed `name`/`menuLabel`
unconditionally, with no exception list. Until the validator is updated, treat the
FuzeBI/FuzeX exception as owner guidance the automated gate does not yet encode —
a known code/policy gap, not license to strip the prefix from those two products'
display strings, and not a reason to add a prefix back to any other product's.

`slug` is never gated by this check in either direction — only `name`/`menuLabel`
are, and both are ordinary mutable fields `register.sh` re-`PUT`s on every pod
start, so fixing one is a one-line edit, unlike a slug.

### 3. Serve path — independent of both

**`frontend/src/utils/loadFederatedApp.ts:71` is the entire mechanism:**

```ts
const resolved = new URL(remoteEntry, origin)
```

The host resolves `integration.remoteEntry` against its own origin and loads it.
**The slug is not an input.** No code path anywhere derives a serve path from a
slug, and none derives a slug from a path. The `/apps/<slug>/…` phrasing in that
file's doc comment is describing a habit, not a contract — reading it as a
contract is what started this.

The serve path is free-form, and must agree with itself across four layers. A
mismatch at any one of them yields the signature failure — `remoteEntry.js`
returns 200 and every chunk it references 404s, so the panel is blank while the
healthcheck is green:

| Layer | File |
|---|---|
| `integration.remoteEntry` | `registration/manifest.json` **and** its vendored Helm copy (kept byte-identical) |
| Vite/webpack `base` | the remote's `vite.config.*` (with `assetsDir: ''`) |
| Ingress `path` | the chart's federated-mount Ingress |
| nginx `location` / `alias` | the chart's nginx ConfigMap, or the baked `nginx.conf` |

**Convention, to keep one mental model: use `/apps/<the repo's existing slug>/`** —
whatever that slug already is, prefixed or not. It is derivable, needs no
judgement, and matches what most repos already assume. It is a naming convention
for a free variable, **not** evidence about the slug: never edit a slug to make it
match a path. Fix the path.

### Two things that are NOT evidence of a slug error

- **`routing.path` differing from `slug`** (e.g. slug `plan`, path `/app/fuzeplan`).
  Independent fields; this is normal and was misread as a contradiction.
- **`backend/src/routes/appRegistry.ts` deriving a slug from a name.** That is the
  CI/local-only fallback, gated on `APP_REGISTRY_LOCAL_ADAPTER=1`, default off.
  Production is `backend/applications/src/app-registry/service.ts`, which stores
  `slug: row.slug` verbatim. Citing the fallback as the production mechanism has
  now caused **five** wrong changes.

Also unconsumed, and inconsistent with `builtins.ts`: `services/app-registry-service/seed/*.manifest.json`
is a documentation fixture (grep finds only comments referencing it). Only the four entries
in `BUILTIN_MANIFESTS` take their slug from FuzeFront's seed — `fuzesocial`, `fuzeagent`,
`clock`, `fuzequality`. Every other product self-registers and owns its own slug.

### Where else this is referenced

`packages/onboarding-kit/README.md`, `docs/mfe-self-registration.md`,
`docs/guides/BUILDING_ON_FUZEFRONT.md`, `docs/planning/app-suites-and-modes.md`,
and `docs/runbooks/app-slug-deprefix-migration.md` (retired) all point back here
rather than restating the rule. If you find one of them describing the rule
differently, this section is correct and the other doc is stale — fix the other
doc in place.

## Entity identifiers — the owning service mints them, and references carry their type

Full standard: **`governance/identifier-standard.md`** (enforced by `gate-identifier`).
Design rationale: `docs/planning/entity-identity-and-graph-create.md`.

Two rules, and one is not enough without the other:

1. **The service that owns an entity mints its id.** A create body must never accept an `id`/`uuid` for the resource being created, and must set `additionalProperties: false`. A client-chosen id turns a cross-type collision from something an attacker must *find* (probability ~0) into something they *type in* — OWASP API3:2023 BOPLA. Fields naming an entity that already exists (`organizationId`, `userId`) are references, not identity, and are fine.
2. **Every polymorphic reference carries its type**, and no lookup resolves a bare id. §1 alone still loses to an attacker who *learns* an id rather than choosing one.

**Corollary, always in force: an id is never a capability.** Authorization comes from the token and Permit. "The caller knew the id" is never sufficient.

**Format is wire-typed, storage-native.** `cus_01h455vb4pex5vsknk084sn02q` on the API (TypeID: prefix + UUIDv7 in base32); a native 16-byte `uuid` column underneath. With services on separate databases there is no shared unique index, so the prefix — checkable offline, with no network call and no cache — is the only defense that always works. Ids are **opaque past the prefix**: never parse further, never assume a length. `mintId()`/`mint_id()` is the only sanctioned constructor.

**Graph create** uses `lid` in / `idMap` out, with ids minted up front so handlers never learn `lid` existed and reference cycles resolve. A `lid` graph is scoped to **one service's aggregate** — a graph spanning services cannot be created atomically.

Packages: **`@izzywdev/fuzefront-identity`** (Node) and **`fuzefront-identity`** (Python, `packages/identity-py/`). They are pinned to each other — same prefixes, same codec, same error codes — and `gate_identifier.py --registry-parity` fails CI if they drift, because a mismatch means a reference minted by one language is rejected by the other.

## Branch lifecycle policy

Every agent-created branch must reach one of these terminal states — never left open indefinitely:

| State | Definition | Time limit |
|-------|-----------|-----------|
| **MERGED** | PR squash-merged, branch auto-deleted | — (happy path) |
| **CLOSED** | PR closed (abandoned/superseded), branch auto-deleted | — |
| **ACTIVE** | Commits pushed, PR open, CI running | ≤ 7 days from last commit |
| **PENDING-REVIEW** | PR non-draft, CI green, awaiting owner approval | indefinite while actively reviewed |
| **DRAFT-BLOCKED** | Draft PR labelled `wip`, `hold`, or `blocked` | exempt from staleness |

`governance-nightly` enforces this daily: closes stale draft PRs (no new commits in 7 days) and deletes branchless branches whose commits are fully reachable from master.

**Agent branch → auto-merge path — the agent opens its own PR, and CI can now approve it all the way to prod.**

**Every agent MUST open its own non-draft PR with the `auto-merge` label.** This is not optional and there is no safety net that does it for you. `auto-merge.yml` then calls `gh pr merge --auto --squash --delete-branch`, so the branch self-resolves once all CI gates pass — no human required for routine agent work.

**GitHub Actions may now create and approve PRs on this repo.** `can_approve_pull_request_reviews` is `true` (`gh api repos/izzywdev/FuzeFront/actions/permissions/workflow`). Workflows that use `GITHUB_TOKEN` can open PRs via `gh pr create` and supply the required review via `gh pr review --approve`. The safety net is the gate set (`gate-ds-conformance`, `gate-frames-first`, `gate-authz`, `gate-identifier`, and the full CI matrix) — those are the production guard, not the human review step. A bot-authored, bot-approved PR that clears every gate ships to prod. This is deliberate.

`claude-auto-pr.yml` (workflow name: *Stranded-branch detector*) detects a branch that has commits but no PR and **fails loudly** so the work gets salvaged rather than silently reaped by `governance-nightly` a week later.

> **Historical note**: until 2026-08-23 `can_approve_pull_request_reviews` was `false` to prevent self-approval. That constraint is lifted; the gate set is now the enforcement layer.

Draft PRs are only legitimate when a session explicitly labels them `wip`, `hold`, or `blocked`.

## FIX is the rule — reporting a defect is not addressing it

**Finding a problem obliges you to fix it, not to describe it.** Pinning a
regression test, filing an issue, adding a `::warning::`, writing it into a
table, or telling the user about it are all ways of *recording* a defect. None
of them is a fix, and a repo full of well-documented known-broken things is the
state this rule exists to prevent.

This is not a style preference — it is the difference between the two halves of
every failure this codebase has accumulated. A vacuous gitleaks config, a
`gate-authz` ending in `|| true`, a `gate-identifier` flag nobody set, an
`a2a-maintain` that skipped when unkeyed: every one of them was *known*. What
was missing was not knowledge, it was the fix.

**So: when you find a defect, fix it — however many agents and however many
branches that takes.** Fan out one agent per repo if the defect is fleet-wide.
Branch sub-branches off sub-branches, merge them upward, and PR the result to
master. Scale is not a reason to downgrade a fix into a report.

The narrow, honest exceptions, and they must be *stated* rather than assumed:

- **You genuinely cannot** — the fix needs a credential, a cluster, or an
  approval this session does not hold. Then produce the exact commands or PR
  that someone with those rights can apply, and name what is blocked. "I filed
  an issue" is only acceptable when the issue is addressed to someone who *can*
  act and the action is named precisely.
- **The fix is out of the requested scope and would change behaviour the user
  did not ask about.** Say so in one sentence and offer it; do not silently
  widen the blast radius of a task.
- **You are not the owner.** FuzeInfra is never edited from a consuming repo.
  Delegate via `@claude`, with the concrete change spelled out.

Everything else gets fixed. A finding without a fix or one of those three
statements attached is unfinished work, not a deliverable.

## Done

Finish work as a **merged PR**, not local commits — merging is how this repo deploys, see the hardening section above. Every domain agent reports `SCOPE DONE (verified)` + `OUT OF SCOPE — NOT DONE`; only the orchestrator calls a feature complete.
