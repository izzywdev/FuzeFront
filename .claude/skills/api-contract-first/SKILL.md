---
name: api-contract-first
description: Use BEFORE fanning out implementation on any feature/service with an HTTP API. Produces a frozen OpenAPI/Swagger contract (+ event schemas), generates the shared typed client, and sets up a mock server — so UI, backend, and tests can be built in parallel against one source of truth.
---

# API contract-first

Freeze the contract before implementation fans out. The contract is the single synchronization point; everything else (UI, backend, tests, mock) derives from it, so contract drift becomes a compile error rather than an integration surprise.

## When
Any feature/service with a real HTTP API and >1 consumer (UI + backend, or multiple services). Pairs with the contract-first SDLC in CLAUDE.md and `feature-tech-planning`.

## Procedure

1. **Author the OpenAPI 3.1 spec.** Put it at `services/<svc>/openapi.yaml` (or `contracts/<svc>.yaml`). Cover every route the service exposes: paths, methods, params, request/response schemas (reuse `components/schemas`), auth (the JWT bearer scheme), error shapes. If the service already exists, **derive the spec from the actual routes** and verify it matches by reading the route handlers — the spec must describe reality, not aspiration.
2. **Add event schemas** for any async surface (FuzeFront: the Kafka Zod schemas in `shared/` — reference them; the contract isn't just HTTP).
3. **Lint it**: `npx @stoplight/spectral-cli lint openapi.yaml` (add a sensible ruleset). Fix warnings.
4. **Generate the shared typed client/types**: `npx openapi-typescript openapi.yaml -o packages/<svc>-client/src/schema.ts`, and expose typed request helpers. This IS the `@fuzefront/<svc>-client` npm package — private `publishConfig` (GitHub Packages, `@fuzefront`, `access: restricted`) + `repository` + wired into the release/publish pipeline. UI, backend, and tests all import these generated types.
5. **Stand up a mock server from the contract** (Prism: `npx @stoplight/prism-cli mock openapi.yaml`, or MSW handlers generated from the schema) so the UI + test streams run before the backend exists.
6. **PR the contract on its own branch, containing the contract and NOTHING ELSE, and freeze/merge it FIRST.**
   The **only** permitted content is the **contract artifact set**: the spec (`openapi.yaml`/AsyncAPI) + event (Zod) schemas · the **generated** typed client (emitted by `openapi-typescript`, never hand-written behind it) · the approved UI frames (`design/frames/<feature>/**`) + mock-server config · the contract's own version bump/changelog.

   **Anything else makes it not a contract PR** — no route handlers, business logic, migrations, feature UI, behaviour tests, Helm/Argo/CI, or unrelated drive-bys. A contract PR is a **gate**; a gate that also carries implementation cannot be reviewed *as* a gate — the interface gets waved through while implementation rides along unexamined, and every downstream stream then builds on something nobody actually agreed to. If you are adding a non-contract file, it belongs in the implementation PR that comes *after* the freeze.

   Only once it is **merged** do the implementer streams start — **all of them, gated only on the contract**: `backend-engineer`, `database-engineer`, `frontend-engineer` (against the mock), `test-engineer`, `frontend-test-engineer`, `devops-engineer`, **`mcp-engineer`, `cli-engineer`, `mobile-app-engineer`, `desktop-app-engineer`, `docs-maintainer`**. The MCP surface, CLI, mobile/desktop shells and consumer docs are projections of the same contract — building them from anything else is precisely how they drift from the API they claim to expose.
7. **Changing the contract later** = amend the contract PR (deliberate ripple to all consumers), never diverge silently in an implementation.

## Done checklist
- [ ] `openapi.yaml` describes every real route (verified against handlers) + error shapes + auth
- [ ] event schemas referenced
- [ ] Spectral lint clean
- [ ] `@fuzefront/<svc>-client` generated from the spec, private publishConfig + repository, in the publish pipeline
- [ ] mock server command documented
- [ ] contract is its own PR, **containing ONLY the contract artifact set** — `git diff --name-only origin/<default>...HEAD` shows no implementation/infra file
- [ ] frozen (merged) before ANY implementer stream starts — incl. mcp / cli / mobile / desktop / docs, not just backend+UI
