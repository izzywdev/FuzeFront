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

## Done

Finish work as a **merged PR**, not local commits — but respect the deploy window above. Every domain agent reports `SCOPE DONE (verified)` + `OUT OF SCOPE — NOT DONE`; only the orchestrator calls a feature complete.
