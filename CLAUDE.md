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

## Mobile design-review gate

All mobile UI changes must pass a visual design-review gate **before any code is written**. This closes the SDLC gap that allows unverified CSS to ship to the Android TWA.

### Flow
1. `mobile-frontend-engineer` (or `frontend-engineer` for shell-layout touches) creates PenPot frames via **PenPot MCP** (`mcp__penpot__*`).
2. Agent opens a GitHub Issue in this repo labeled **`design-review`** with frame thumbnails and interaction notes.
3. **`design-review-notify.yml`** fires automatically and sends a Telegram message to the product owner with a direct link to the issue.
4. The product owner comments **`@claude approve`** (or `@claude reject: <reason>`) on the issue. `claude.yml` spawns a new cloud session to continue implementation.
5. `frontend-test-engineer` retrieves the approved PenPot frames and screenshot-compares the implementation before reporting done.

### PenPot MCP
- **Local config:** `~/.claude.json` under `mcpServers` → `"penpot": { "type": "sse", "url": "https://design.penpot.app/mcp/stream?userToken=<token>" }`. **Never commit the token.**
- **GitHub Secret:** `PENPOT_MCP_URL` — the full SSE URL including token, for future CI use.
- **Agent access:** `mobile-frontend-engineer`, `frontend-engineer`, and `frontend-test-engineer` all have `mcp__penpot__*` in their tool grants and treat PenPot as the design source of truth.

### Fallback (PenPot unavailable)
Render a static HTML mockup via the Artifact tool at 375 px width, embed a screenshot in the GitHub Issue labeled `design-review`, and follow the same approval flow.

## Done

Finish work as a **merged PR**, not local commits — but respect the deploy window above. Every domain agent reports `SCOPE DONE (verified)` + `OUT OF SCOPE — NOT DONE`; only the orchestrator calls a feature complete.
