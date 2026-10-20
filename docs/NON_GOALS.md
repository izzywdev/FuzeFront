# FuzeFront non-goals

FuzeFront is the **runtime hosting platform and governance control plane** for
federated products: an app-shell host, a self-service application registry,
auth/authorization integration, routing, and health. This page states what it
is deliberately **not** trying to become, so the project is easier to evaluate
and so new contributors don't assume a scope the codebase doesn't carry.

See [`docs/SOFTWARE_FACTORY.md`](SOFTWARE_FACTORY.md) for how FuzeFront fits
into the larger factory, and the root [`CLAUDE.md`](../CLAUDE.md) for the
repo's own boundary rules.

## FuzeFront is not trying to replace every CI/CD, observability, cloud, or developer tool

FuzeFront does not ship its own CI engine, its own metrics/log storage, its
own cloud provider, or its own IDE/toolchain. It **integrates** with and
**hosts configuration for** tools that already do those jobs well (GitHub
Actions for CI, Prometheus/Grafana/Loki for observability, Kubernetes on
whichever cloud you choose). Where FuzeFront exposes a thin convenience layer
on top of one of these (for example, reading feature flags through
`@fuzefront/feature-flags`), that layer is intentionally thin — the
underlying tool stays swappable and remains the source of truth.

## Explicit boundaries from sibling repos

These are drawn from how the repos actually divide responsibility today, not
aspirational org-chart lines:

1. **FuzeFront vs. FuzeInfra — FuzeFront never owns infrastructure.**
   FuzeInfra is the shared, containerized infrastructure platform: databases,
   messaging, networking, monitoring, and the Kubernetes/Helm delivery
   mechanics (local kind, EKS, Contabo k3s). FuzeFront *runs on* FuzeInfra —
   it attaches to the external `FuzeInfra` Docker network or addresses
   services in the `fuzeinfra` namespace — but it never edits FuzeInfra's
   charts, never hand-operates its cluster, and never forks its own copy of
   infra primitives. Infra changes are delegated out via `@fuze`, not made
   in this repo.

2. **FuzeFront vs. FuzeSDLC — FuzeFront does not define its own governance model.**
   FuzeSDLC is the canonical source for the agent roster, the
   single-responsibility/done contract, contract-first fan-out,
   signed-commit conventions, and the repo-tiering/hardening standard.
   FuzeFront's `CLAUDE.md` is a thin repo-specific overlay on that baseline,
   not a competing governance system — where this file is silent, the
   baseline governs.

3. **FuzeFront vs. FuzeAgent — FuzeFront does not orchestrate AI teams.**
   FuzeAgent owns AI team orchestration and the A2A (agent-to-agent) contract
   itself (card projection, authorization, capability delegation semantics).
   FuzeFront only *serves* a narrow, declared slice of that contract — it
   does not define A2A schemas, does not act as a general-purpose agent
   router, and does not run orchestration for other repos' agents.

4. **FuzeFront vs. consuming products — FuzeFront does not own product logic.**
   Products and micro-frontends are federated remotes mounted into the
   FuzeFront shell via Module Federation. FuzeFront defines and holds stable
   the *shared* contract they build against (the design-system base, the
   shared React/library versions, the app-registry API) — it does not own,
   version, or ship any individual product's business logic, data model, or
   UI beyond that shared shell. A consuming repo owns its own chart, its own
   slug, and its own feature code; it is never forked into this repo.

5. **FuzeFront does not mint its own identity or authorization engine.**
   Identity/SSO is Authentik and authorization decisions are Permit;
   FuzeFront integrates with both rather than reimplementing session
   management, SSO protocols, or a policy-decision point from scratch. A
   feature flag is rollout convenience, not an authorization mechanism — real
   authz always resolves through Permit, never through a flag check alone.

6. **FuzeFront does not take direct control of production infrastructure.**
   Production is GitOps-owned (Argo CD on Contabo k3s, reconciled from
   FuzeInfra's Helm charts). Nothing in this repo hand-deploys to that
   cluster or patches a live resource — a change reaches prod only by being
   merged to the branch Argo watches.

## Keeping this page honest

This page is a boundary statement, not a feature list, and it can go stale as
the architecture moves. If a non-goal above stops being true (for example,
FuzeFront starts shipping its own metrics backend), update this file in the
same change that crosses the boundary — don't let the doc and the code drift
apart.
