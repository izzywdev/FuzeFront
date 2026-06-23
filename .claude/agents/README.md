# Domain agents (FuzeFront)

A standard set of **single-responsibility** agents, fanned out one-per-slice for a feature — never one agent for a whole feature. The responsibility boundary is the **domain**, not the repo; repo context comes from the **`fuzefront-expert`** agent + skills, the *how* comes from skills (`api-contract-first`, `fuzefront-ui-package`, `frontend-design`), and the *scope discipline* comes from these agent definitions.

## Roles (scope is exclusive)
- **contract-designer** — the detailed-design phase that runs **first**: user story → frozen API contract (OpenAPI/Swagger) + event contract (Kafka Zod schemas) + the generated `@fuzefront/<svc>-client` package, PR'd as the gate. Designs the interface; does NOT implement behind it.
- **backend-engineer** — API / services / DB / migrations + the backend's own unit tests. NOT UI, NOT the independent test suite, NOT deploy, NOT docs.
- **database-engineer** — the **data tier**: per-service DB roles/databases (Postgres/Redis/Mongo/Neo4j/Chroma), ordered+idempotent migrations + their deploy mechanism, connection wiring (DATABASE_URL/SealedSecret/service-DNS), bootstrap/provisioning. NOT app logic, NOT UI, NOT deploy charts, NOT tests.
- **frontend-engineer** — UI as a private design-system-first npm package, built against the contract/client. **Sole owner of `design-system/`**: derives needed components from the user story, adds missing primitives to the design system FIRST (landed as a foundation), then builds the feature UI consuming them. NOT backend, NOT UI e2e, NOT deploy.
- **test-engineer** — INDEPENDENT **API/service** verification: contract / integration / event tests against the **spec** (not the implementer's self-tests). Does NOT implement; does NOT do UI/browser e2e.
- **frontend-test-engineer** — INDEPENDENT **UI** verification: Playwright/browser e2e against acceptance criteria, **pre-production** (ephemeral stack) **and post-production** (smoke/synthetic vs the live app). Runs after `frontend-engineer`. Does NOT build the UI or design system.
- **devops-engineer** — Helm / Argo / CI/CD / infra-request wiring **+ edge/DNS/CDN/Workers (Cloudflare) and cloud (AWS)**. NOT app code, NOT UI.
- **docs-maintainer** — consumer guides / runbooks / READMEs / API docs from the contract. NOT code.

### Integration & coordination specialists (own a single external surface)
- **billing-payments-engineer** — the **Stripe/payments** integration slice (checkout, subscriptions, webhooks, plans, usage, billing-service payment logic). Defers contract → `contract-designer`, billing UI → `frontend-engineer`, deploy → `devops-engineer`.
- **telephony-integrator** — the **Twilio/SendGrid** communications-channel slice (SMS/voice/WhatsApp/Verify/email) wired into the email/sms services. Same deferrals.
- **agile-manager** — delivery coordination only: **Atlassian** (Jira/Confluence tickets, sprints, status) + **Slack** (team comms) + cross-repo `@claude` delegation tracking. Writes tickets/reports, never product code.
- **wordpress-engineer** — WordPress sites/themes/plugins, kept separate from the app shell. Skill-driven (no WP MCP).

> **Only `frontend-engineer` edits `design-system/`.** Every other agent consumes it. When several UI features run in parallel, design-system extensions land in **one foundation PR first** — never re-edited per feature branch (that parallel duplication is what strands features in merge conflicts).

## Tool & MCP ownership (each external surface has ONE owner)
MCP servers are granted via each agent's `tools:` allowlist; plugin **skills** are referenced in the agent body. Routing an external surface to exactly one hat keeps the code agents lean and makes misroutes self-correct (the wrong agent lacks the tool).

| External surface | MCP server(s) | Owner agent | Plugin skills |
|---|---|---|---|
| Design-to-code | Figma | **frontend-engineer** (sole) | `frontend-design`, `figma-*` |
| Browser e2e / QA | Playwright + Chrome DevTools | **frontend-test-engineer** | `chrome-devtools`, `a11y-debugging` |
| Edge / DNS / Workers | Cloudflare (api/bindings/builds/docs/observability) | **devops-engineer** | `cloudflare`, `wrangler`, `workers-best-practices`, `cloudflare-one` |
| Cloud (AWS) | *(skills only)* | **devops-engineer** | `aws-iam`, `aws-cdk`/`aws-cloudformation`, `aws-serverless`, `aws-containers`, `aws-secrets-manager`, `aws-observability` |
| Payments | Stripe | **billing-payments-engineer** | `stripe-*` + `stripe:Company Researcher` agent |
| Telephony / messaging / email | Twilio (+ SendGrid) | **telephony-integrator** | `twilio-*`, `twilio-sendgrid-*` |
| Project tracking + team comms | Atlassian + Slack | **agile-manager** | `ticket-*`, `triage-issue`, `spec-to-backlog`, `generate-status-report`, `slack-*` |
| WordPress | *(skills only)* | **wordpress-engineer** | `build-with-wordpress`, `site-specification` |

> **Unassigned:** the **Shopify** MCP has no named hat yet — it stays available to general agents until an e-commerce hat is created. Pure-code agents (`backend-engineer`, `contract-designer`, `test-engineer`, `docs-maintainer`) intentionally get **core tools only, no MCP**.

## Mandatory DONE contract (every domain agent, no exceptions)
An agent reports completion **only for its own domain**. The final report MUST contain both:
- **`SCOPE DONE (verified)`** — what was built + the exact commands/results proving it.
- **`OUT OF SCOPE — NOT DONE`** — the sibling layers this agent did NOT build (UI / tests / devops / docs), named explicitly.

Rules: **Never** claim the *feature* is "done" or "green" — only your slice. If any sibling layer is missing, the feature is **NOT complete** and you must say so. **Never implement outside your domain** — if another layer is needed, name it for the orchestrator to assign the right agent. This exists because a single agent once reported "done/green" for a backend slice while UI + real tests were unbuilt — that must never read as a finished feature again.

## VERIFICATION PROTOCOL (MANDATORY — every domain agent, no exceptions)
`SCOPE DONE` is a claim about the **remote**, not the local disk. A real run once lost all its work: it ran in a degraded git worktree (empty `$PATH`, swallowed git stdout), never noticed, read **local** `.git/refs/remotes/*` files as "proof" of pushes that had actually FAILED, and reported `SCOPE DONE` with a PR number that did not exist — when the worktree was auto-removed, the work was gone. Before any agent reports `SCOPE DONE`, it MUST:
1. **Environment sanity check FIRST.** Run `git --version` and `gh --version`; confirm **non-empty** output. **Empty/garbled output is NOT success — the shell is degraded.** Repair defensively (export a sane `PATH`, `export GIT_PAGER=cat GIT_TERMINAL_PROMPT=0`), re-verify, and confirm `gh auth status` reaches the API. Never interpret empty command output as success.
2. **Verify every push against the REMOTE.** After each `git push`, capture `git rev-parse HEAD`, then run `git ls-remote origin <branch>` (a network call) and confirm the returned SHA **equals** local HEAD. **NEVER** trust `.git/refs/remotes/*` (or `git rev-parse origin/<branch>`) as proof a push landed — those are local files. Mismatch/empty => the push did not land; re-push or `BLOCKED:`.
3. **Verify the PR via the API.** Only claim a PR exists after `gh pr view <url-or-number> --json number,state,headRefName,url` returns data whose `headRefName` matches your branch; quote that `url`/`number` verbatim. Never report a constructed/guessed PR URL or number.
4. **Input preconditions — never fabricate.** Confirm required source docs/inputs exist and are non-empty on the working ref before doing the work. If missing, commit+push a stub (verified per step 2) and RETURN `BLOCKED: <what is missing, where you looked>` — do not invent assumptions.
5. **Honest done is evidence-gated.** Report `SCOPE DONE` **only** with an **API-verified** PR URL (step 3) **and** the **`git ls-remote`-confirmed** remote head SHA (step 2). Cannot produce both => `BLOCKED:`, not done. Local state is never a substitute.

## Orchestration (sequence)
1. **contract-designer** runs alone first → frozen contract PR (the gate). Nothing fans out until it's merged/frozen.
2. Then fan out **backend-engineer + frontend-engineer + test-engineer + devops-engineer** (+ **docs-maintainer**) **in parallel**, each gated only on the contract — not on each other (UI builds against a contract mock, tests against the spec). `frontend-engineer` does its **design-system foundation step first**; if multiple UI features run together, that DS foundation is its own PR merged before the parallel UI builds.
3. **`frontend-test-engineer` runs after `frontend-engineer`** — Playwright pre-production verification gates the merge; post-production smoke runs after deploy.
4. Each slice is its own draft PR; the feature is "done" only when **every** slice's PR is green and merged — the orchestrator's judgement, never a single agent's.

See CLAUDE.md → "Contract-first parallel fan-out" + "Domain agents".
