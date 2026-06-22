# Domain agents (FuzeFront)

A standard set of **single-responsibility** agents, fanned out one-per-slice for a feature — never one agent for a whole feature. The responsibility boundary is the **domain**, not the repo; repo context comes from the **`fuzefront-expert`** agent + skills, the *how* comes from skills (`api-contract-first`, `fuzefront-ui-package`, `frontend-design`), and the *scope discipline* comes from these agent definitions.

## Roles (scope is exclusive)
- **backend-engineer** — API / services / DB / migrations + the backend's own unit tests. NOT UI, NOT the independent test suite, NOT deploy, NOT docs.
- **frontend-engineer** — UI as a private design-system-first npm package, built against the contract/client. NOT backend, NOT deploy.
- **test-engineer** — INDEPENDENT verification: contract / acceptance / integration tests written against the **spec** (not the implementer's self-tests). Does NOT implement the feature.
- **devops-engineer** — Helm / Argo / CI/CD / infra-request wiring. NOT app code, NOT UI.
- **docs-maintainer** — consumer guides / runbooks / READMEs / API docs from the contract. NOT code.

## Mandatory DONE contract (every domain agent, no exceptions)
An agent reports completion **only for its own domain**. The final report MUST contain both:
- **`SCOPE DONE (verified)`** — what was built + the exact commands/results proving it.
- **`OUT OF SCOPE — NOT DONE`** — the sibling layers this agent did NOT build (UI / tests / devops / docs), named explicitly.

Rules: **Never** claim the *feature* is "done" or "green" — only your slice. If any sibling layer is missing, the feature is **NOT complete** and you must say so. **Never implement outside your domain** — if another layer is needed, name it for the orchestrator to assign the right agent. This exists because a single agent once reported "done/green" for a backend slice while UI + real tests were unbuilt — that must never read as a finished feature again.

## Orchestration
Per the contract-first SDLC: freeze + PR the contract, then fan out **backend + frontend + test + devops** in parallel, each gated only on the contract. Each is its own draft PR; the feature is "done" only when every slice's PR is green and merged. See CLAUDE.md → "Contract-first parallel fan-out" + "Domain agents".
