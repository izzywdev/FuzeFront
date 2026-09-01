---
name: feature-flags
description: Use when planning or writing code that should ship behind a feature flag — new/risky work, a gradual rollout, an operational kill-switch, an experiment, or a plan/tenant-gated capability. Covers the flag types and when to use each, the `<repo>.<domain>.<flag>` naming, the evaluation-context contract, default-OFF release / default-ON kill-switch rules, testing BOTH states, lifecycle + debt cleanup, and how to read a flag via `@fuzefront/feature-flags` (OpenFeature) in backend and frontend. Owned by feature-flags-engineer.
---

# Feature flags

Decouple **deploy** from **release**: merge and ship code dark, turn it on deliberately, and kill a bad path without a redeploy. Every flag is a small contract with an owner and an expiry — not a permanent `if`.

## Architecture (the family standard)
- **Backend:** **Unleash** (self-hosted OSS, **FuzeFront-hosted**) is the flag store + admin UI + rollout/targeting engine.
- **API:** **OpenFeature** (vendor-neutral SDK) + the **Unleash OpenFeature provider** — you code against the OpenFeature API, so Unleash stays swappable.
- **Client:** the private **`@fuzefront/feature-flags`** package wraps OpenFeature + the provider with the family's defaults and context contract. Consumers depend on it; they never wire OpenFeature/Unleash by hand.
- **Ownership:** `feature-flags-engineer` owns the Unleash config, the taxonomy, and the flags. Family products **manage flags through that agent**, not by clicking around Unleash ad hoc. The Unleash *deploy* is `devops-engineer`; the *client package build* is `backend-engineer`.

## When to flag
Wrap **new or risky** work in a flag — anything you'd want to roll out gradually, turn off fast, measure, or gate by entitlement. Skip flags for trivial, low-risk, irreversible-anyway changes (a typo fix, a pure refactor with tests). When in doubt on a user-facing or money/security-adjacent path, flag it.

## Flag types — pick exactly one
| Type | Purpose | Default | Lifespan | Removal criterion |
|---|---|---|---|---|
| **release** | Ship-dark / gradual rollout of new work | **OFF** | Short (days–weeks) | Removed once 100% rolled out + stable |
| **ops-kill-switch** | Circuit-breaker for a risky/expensive path | **ON** | Long-lived | Removed only if the path is removed |
| **experiment** | A/B or multivariate measurement | per design (usually control) | The measurement window | Removed when the experiment concludes + winner is shipped |
| **permission** | Gate a capability by plan/entitlement/tenant | per entitlement | Long-lived | Removed if the capability becomes universal |

Rules that are NOT negotiable:
- **release ⇒ default OFF.** A release flag that defaults ON has shipped the feature — pointless.
- **ops-kill-switch ⇒ default ON.** The safe path is "system works"; flipping OFF is the break-glass.
- **permission flags are rollout convenience, NOT authorization.** Real entitlement is enforced by **Permit** (`permit.check`) on the server. A flag may *also* hide the UI/route, but it must never be the only thing standing between a user and a capability — that's a BOLA waiting to happen.

## Naming — `<repo>.<domain>.<flag>`
Dot-namespaced, lowercase, kebab within a segment: `fuzefront.billing.usage-based-pricing`, `fuzekeys.tokenizer.batch-detokenize`, `fuzefront.checkout.new-cart-kill-switch`. The `<repo>` prefix prevents collisions across the family in one shared Unleash; `<domain>` groups by service/area; `<flag>` is the specific toggle. Don't encode the type in the name beyond what's natural (a `-kill-switch` suffix is fine and readable).

## Evaluation context contract
Every evaluation passes a context so Unleash can target correctly. The family-standard fields (set by `@fuzefront/feature-flags`):
- **`environment`** — `local` | `dev` | `prod` (the Unleash environment; usually injected from config, not per-call).
- **`organizationId` / `tenantId`** — the org/tenant the request acts on (drives per-tenant rollout + permission flags).
- **`userId`** — the acting user (drives gradual-by-user rollout, experiment bucketing, stickiness).
- **`app`** — the consuming app/service id (e.g. `fuzefront-host`, `billing-service`).

**Never evaluate with no context in a prod path** (you'd get only the default and lose targeting). If you genuinely have no user/tenant (a cron, a system task), pass `app` + `environment` and document why. Context flows from the request: backend reads it from the authenticated principal + headers; frontend reads it from the session/host shell.

## Reading a flag via `@fuzefront/feature-flags` (OpenFeature)

**Backend (server SDK)** — evaluate per-request with the request's context; never cache a boolean across users:
```ts
import { getClient } from '@fuzefront/feature-flags'; // wraps OpenFeature + Unleash provider

const flags = getClient();
const ctx = { environment: env, organizationId: req.org.id, userId: req.user.id, app: 'billing-service' };
// release flag: default OFF
if (await flags.getBooleanValue('fuzefront.billing.usage-based-pricing', false, ctx)) {
  // new path
}
// kill-switch: default ON — code runs unless explicitly killed
if (await flags.getBooleanValue('fuzefront.checkout.charge-kill-switch', true, ctx)) {
  await charge();
}
```

**Frontend (web/proxy SDK)** — the browser uses the Unleash **proxy/frontend** token (never the server admin token); context comes from the host session:
```ts
import { useFlag } from '@fuzefront/feature-flags/react';
const showNewCart = useFlag('fuzefront.checkout.new-cart', false); // default OFF
```
The default value passed in code (the 2nd arg) is the **fallback when the flag store is unreachable** — make it match the type rule (OFF for release, ON for kill-switch) so an Unleash outage fails safe.

## Testing — BOTH states, always
A flagged change has **two** code paths; CI must exercise both. Don't test only the on-path.
- Unit/integration: run the suite with the flag **OFF** (the old/safe path) **and ON** (the new path). The `@fuzefront/feature-flags` client exposes a test provider (static/in-memory) so a test pins a flag's value — no network, deterministic.
- For a kill-switch, test that flipping OFF cleanly disables the path (no half-state, no thrown 500).
- For permission flags, also assert the **Permit** check still gates the capability with the flag ON (the flag is not the boundary).

## Lifecycle + debt cleanup
A flag is **debt** the moment it's created. At creation, record (in Unleash + the flag's PR): **owner**, **type**, **default**, and **removal criterion**. Then:
1. **release / experiment flags are temporary** — once rolled out (or the experiment concludes), delete the flag AND the dead branch in code, in one cleanup PR. A long-lived release flag is a smell.
2. **Stale-flag sweep** — flags past their removal criterion (or untouched > their expected lifespan) are surfaced by the governance reconciliation sweep and the flag owner is nudged. Don't let the codebase fill with permanently-ON `if (true)` flags.
3. **Removing a flag** = delete the toggle in Unleash + remove both branches in code (keep the winning path) + drop the test for the dead path. Verify nothing else references the flag key first.

## Consuming-repo onboarding (point a repo at the family flag service)
1. Add `@fuzefront/feature-flags` as a dependency (private GitHub Packages, `@fuzefront` scope — scoped `.npmrc` + token).
2. Get a **client token** for your app from `feature-flags-engineer` (a scoped Unleash API token — server token for backend, frontend/proxy token for browser). It's a SealedSecret in your repo, ref'd by env; `devops-engineer` wires it.
3. Point the provider at **FuzeFront's Unleash** URL (same-origin proxy in the browser; service-DNS for server-side) via config — never hard-code the host.
4. Pass the standard evaluation context (above) on every evaluation.
5. Use the `<yourrepo>.<domain>.<flag>` namespace; ask `feature-flags-engineer` to create the flags (with type + owner + removal criterion).

## Done checklist
- [ ] Flag has exactly one **type**; default matches the rule (release OFF, kill-switch ON)
- [ ] Name is `<repo>.<domain>.<flag>`
- [ ] Evaluation passes the standard **context** (environment + org/tenant + user + app) on prod paths
- [ ] In-code default is the fail-safe value (OFF release / ON kill-switch)
- [ ] **Both** flag states tested (off-path AND on-path); permission flags still gated by Permit
- [ ] Flag recorded with **owner + removal criterion**; release/experiment flags scheduled for cleanup
- [ ] Read via `@fuzefront/feature-flags` (OpenFeature API), not a hand-wired Unleash/OpenFeature call
