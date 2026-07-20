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
- Because `master` deploys/publishes on push, **never bot-merge here** — merge in a **deploy window** (`hardening.deployOnPush: true`). Hand-deploying to prod is forbidden; prod is GitOps.

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

**The authoritative design artifact is a set of navigable HTML frames in this repo** — `design/frames/<feature>/` (`index.html` entry + ordered `01-*.html` screens + `tokens.css` + `manifest.json`), published to GitHub Pages for review. Not PenPot. PenPot is **parked** by owner decision; it complicates the loop without earning it, and a design tool that is not in the repo cannot be gated by CI. Frames are code: they diff, they review, they enforce.

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
`gate-frames-first` fails any PR touching feature UI (`frontend/src/**`, `packages/*-ui/**`) without an approved `design/frames/<feature>/manifest.json` covering it. Governance nobody can skip beats a step someone is supposed to remember — the whole reason this gate exists is that pushing feature UI with no approved frames was *possible*.

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

**Agent branch → auto-merge path — the agent opens its own PR. CI cannot.**

**Every agent MUST open its own non-draft PR with the `auto-merge` label.** This is not optional and there is no safety net that does it for you. `auto-merge.yml` then calls `gh pr merge --auto --squash --delete-branch`, so the branch self-resolves once all CI gates pass — no human required for routine agent work.

**CI cannot open a PR here, by design.** `can_approve_pull_request_reviews` is `false` on this repo (`gh api repos/izzywdev/FuzeFront/actions/permissions/workflow`), so `gh pr create` from any workflow fails with *"GitHub Actions is not permitted to create or approve pull requests"*. GitHub bundles create-PR and approve-PR into a single toggle, and `master` is deploy-on-push with required reviews — enabling it would hand every workflow a self-approval path to production. An un-bypassable review gate is worth more than auto-PR convenience. If auto-PR is ever genuinely needed, wire a scoped PAT/GitHub App token rather than flipping the toggle.

`claude-auto-pr.yml` (workflow name: *Stranded-branch detector*) therefore does **not** create PRs — it detects a branch that has commits but no PR and **fails loudly** so the work gets salvaged rather than silently reaped by `governance-nightly` a week later.

> **This section previously claimed all four prefixes auto-PR "the moment they are pushed to".** That was false for the life of the workflow: it can never create a PR, and every green run was the early-exit path (*"PR already open"*) because the agent had already opened one. It ran its create path only when actually needed — and failed. A check that passes when its job is already done by someone else, and fails only when asked to work, is not evidence of anything. Assume nothing here is verified because a check is green; verify the deliverable (baseline: *verify the deliverable, not the "finished" claim*).

Draft PRs are only legitimate when a session explicitly labels them `wip`, `hold`, or `blocked`.

## Done

Finish work as a **merged PR**, not local commits — but respect the deploy window above. Every domain agent reports `SCOPE DONE (verified)` + `OUT OF SCOPE — NOT DONE`; only the orchestrator calls a feature complete.
