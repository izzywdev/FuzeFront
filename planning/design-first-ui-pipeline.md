# Design-first UI pipeline (product-designer → frames PR → RED QA → components → flows)

> **Status: approved, in progress.** Authored 2026-07-17. This is the working plan
> of record for the UX/UI design pipeline; it supersedes the PenPot design-review
> gate described in `CLAUDE.md` (HTML frames are authoritative — see *Corrections*
> §7 below).
>
> **Resolved since drafting** (the plan's open questions, now settled with evidence):
> - **Repo visibility / Pages** — the repo is **public**, so Pages needs no
>   Enterprise Cloud. Pages is **enabled** with `build_type=workflow`
>   (`https://izzywdev.github.io/FuzeFront/`). The Actions source was chosen over a
>   branch source because a branch source serves only `/` or `/docs`, and frames
>   live at `design/frames/**`.
> - **"Actions cannot create PRs here"** — confirmed, and it is a deliberate
>   security choice, not a gap: `can_approve_pull_request_reviews: false`, and
>   GitHub bundles create-PR with approve-PR, which on a deploy-on-push `master`
>   with required reviews would be a self-approval path to prod. So the plan's
>   assumption holds — **the initiator agent opens the frames PR**, CI never does.
> - **`product-designer` exists** — landed with the `contract-designer` /
>   `frontend-engineer` corrections (PR #300).
>
> **Not yet built** (sequencing step 1 remainder): `design/frames/_template/`,
> `scripts/stamp-frames.mjs`, `gate-frames-first`, `gate-frames-stamped`, the
> design-approval issue form + workflow, and Pages publishing for
> `design/frames/**`.

## Context

**The problem.** Seven backend PRs merged today (#285, #288–#293). Every capability is reachable **only by curl** — password reset, MFA/2FA management, API tokens, devices/sessions, social link/unlink, AuthZ roles. No UI, no e2e (#271 shipped `test.fixme` scaffolds, not tests). Backend real, product absent.

**Why it happened — and the fix you named.** My earlier UI attempt produced zero tool calls and I moved on. But "the agent failed" is the shallow cause. **The real cause: nothing made governance mechanical.** Pushing feature-UI with no approved frames was *possible*. That's the session's recurring pattern — a rule nobody can skip beats a step someone is supposed to remember.

**Outcome intended.** A design-first pipeline where the process is enforced by CI, not by anyone's diligence, and which generalises into the UX/UI design/QA platform.

## Corrections to my first draft (all yours, all right)

1. **The frames are NOT the frontend-engineer's job.** They belong to a new **`product-designer`** agent — a UX/UI expert operating on **product requirements and user stories**. A frontend-engineer authoring the design is exactly the bias problem `contract-designer` exists to prevent on the backend: the implementer must not also write the spec they're measured against. **This mirrors contract-first, one-for-one.**
2. **Frames are always their own PR, and its only content.** Nothing else rides along.
3. **Merging frames triggers RED QA (TDD)** — UX QA agents write failing tests for the flows *before* implementation exists. Then frontend-engineers implement components → aggregate into flows → ship as packages.
4. **The frames declare the build inventory** — the flows, React components, and npm packages to be created are *rendered in the frames and approved with them*. The frames are the architectural contract, not just pictures.
5. **Reject ≠ close.** Reject **re-dispatches `product-designer`** for an improving iteration. Closing throws the thread away.
6. **Per-flow approval.** Approving one flow injects its `approved: true` and unblocks *that* flow's implementation — no waiting for the whole set.
7. **PenPot is parked** — you're backing HTML-frames-as-authoritative; CLAUDE.md's PenPot design-review gate gets updated (it currently contradicts `ui-frame-contract`).

## The pipeline

```
product requirement / user story
      │
      ▼
product-designer ──► frames PR (frames ONLY, own branch)
      │                 CI: gate-ds-conformance · gate-frames-schema · gate-ux-policy
      ▼
   approval (in-frame link, per flow)  ──reject──► product-designer iterates
      │ approve
      ▼
   merge ──► triggers UX QA agents ──► Playwright specs for each flow: ALL RED (TDD)
      │
      ▼
frontend-engineers ──► components (DS-first) ──► aggregated into flow orchestrators
                   ──► shipped as npm packages ──► merged ──► deployed ──► specs go GREEN
```

**`gate-frames-first` (the CI rule that makes this real):** a PR touching feature UI (`frontend/src/**`, `packages/*-ui/**`) **fails** unless an approved `design/frames/<feature>/manifest.json` exists covering it. This is what "pushing the code should have triggered the process" becomes — enforcement, not etiquette. It is also the rule that would have caught *me*.

## New agent: `product-designer`

- **Owns:** user story → flows, screens, states, and the **build inventory** (flows / React components / npm packages) → navigable HTML frames + manifest. Sole author of `design/frames/**`.
- **Does NOT:** write feature code, tests, or deploy wiring. Sequential gate, like `contract-designer`.
- **Consults:** `fuzefront-expert` for repo reality (this is where "you're planning SMS? we already have a Kafka topic" gets caught — the miss that started this thread).
- **Skills:** `ui-frame-contract`, `frontend-design`, `design-system-conformance`.
- Lives in `.claude/agents/product-designer.md` (tracked in git, propagates to remote runs) → **promote to FuzeSDLC** so every repo gets it.

## Frames: what's in them

Established precedent to copy: `design/frames/billing-invoices/` (`index.html` navigable entry · `01-*.html` ordered sequence · `tokens.css` · `manifest.json` with `approved/approvedBy/approvedAt` + `contract{openapi,client,endpoints,component,featureFlag}` + `data-*` hooks Playwright drives).

**Additions:**
- **Build inventory rendered in `index.html`** and mirrored in the manifest:
  ```json
  "build": {
    "flows": [{ "id": "reset", "orchestrator": "PasswordResetFlow", "route": "/reset" }],
    "components": ["OtpInput", "PasswordStrengthMeter", "ResetRequestForm"],
    "packages": ["@fuzefront/account-security-ui"]
  }
  ```
  Approving the frames approves the component/package plan — so implementation can't quietly invent a different architecture.
- **Per-flow approval** — `approved` moves onto each `flows[]` entry, so one flow can unblock while another iterates.
- **States are contract, not decoration** — loading/empty/error and the real fail-closed cases (unlink-last-method → 409; `hasPassword: null` → "set a password first"). Frames showing only the happy path produce UI that only handles the happy path.

## Approval mechanism

**Enable GitHub Pages** (you asked; I have `gh`) publishing `design/frames/**` → frames become a real clickable URL (yes — that shared-belongings link was Pages). Note: Pages on a **private** repo needs Enterprise Cloud; if this repo is private, fallback is opening `index.html` locally — the approval links are absolute GitHub URLs, so they work from `file://` with zero infra.

In-frame control → prefilled **GitHub Issue Form** (`feature`/`flow`/`frames_hash`/`decision` prefilled; a **Notes textarea** is your prompt). Automating the approval decision itself: **deferred, per your call.**

**`design-approval.yml`** — `on: issues: [opened]` only (edits can't re-fire), `concurrency: design-approval-<feature>`, then four gates:
1. **Authorization** — actor must be owner/CODEOWNER. *Anyone can open an issue*; without this, anyone could approve a design.
2. **Staleness** — recompute the content hash of `design/frames/<feature>/**`; mismatch → "frames changed since you viewed them" + re-dispatch. **Load-bearing:** an approval provably binds to the exact frames you saw, so a stale bookmarked link can never approve frames you never looked at.
3. **Idempotency** — read the manifest first; already approved at this hash → no-op + comment. **A double-click is not a second approval.** (Your double-trigger concern.)
4. **Write** — flip the flow's `approved` via the **Contents API** (server-side commits are signed → satisfies `required_signatures`) onto the **frames PR head branch, never master** (master is deploy-on-push + review-required).

**Reject** → notes onto the PR + **re-dispatch `product-designer`**; issue stays open until resolved.

Actions **cannot create PRs** here (verified). Fine: the **initiator agent that ordered the design service opens the frames PR**; the workflow only pushes to that existing branch and comments.

**Anti-drift:** `scripts/stamp-frames.mjs` derives the hash; **`gate-frames-stamped`** recomputes it in CI. Otherwise the stamp is another hand-maintained mirror — the exact pattern behind four of today's defects (`release.yml` 7-vs-5 anchors, kafka-topics vs TOPICS, openapi vs `authz.ts`, `core/dist` vs `src`).

## Feature flags + the visibility gap you caught

Flags default OFF ⇒ **prod-smoke and Playwright would never see the feature, so its e2e could never go green.** Policy update: define a **builders audience** — you + the QA agents' synthetic accounts — that flag targeting includes. Prod smoke authenticates as a builder, sees the flagged feature, and can prove it before general rollout. Without this, "flag it OFF then verify in prod" is self-defeating.

## Template → FuzeSDLC (the part that outlives this feature)

```
design/frames/_template/{index.html,frame.html,approval-bar.html,manifest.schema.json,README.md}
.github/ISSUE_TEMPLATE/design-approval.yml
.github/workflows/design-approval.yml      # workflow_call — lives in FuzeSDLC
.github/workflows/gate-frames-first.yml    # UI code requires approved frames
scripts/stamp-frames.mjs
.claude/agents/product-designer.md
```
One implementation in **FuzeSDLC**, called by every repo, distributed by the bootstrap. Repos keep only `design/frames/**`.

**Why this is already the platform:** every decision lands as structured, CI-validated data (`manifest.schema.json` + the issue thread as audit trail). A future UX/UI app reads the manifests; nothing needs re-authoring.

## The six features
`account-security` · `password-reset` · `mfa-management` · `devices-sessions` · `api-tokens` · `authz-admin` — each a frames PR authored by `product-designer`, each declaring its flows/components/packages.

## Critical files
- `.claude/skills/ui-frame-contract/SKILL.md` — authoritative procedure
- `design/frames/billing-invoices/{index.html,manifest.json,tokens.css}` — **reference to copy**
- `design-system/styles.css`, `design-system/tokens/*.css`
- `packages/security/openapi.yaml` — contract the frames bind to
- `CLAUDE.md` — remove the PenPot/HTML contradiction

## Verification
- **Frames PR**: `index.html` walks the flow; DS-conformant (no raw values); manifest schema-valid; inventory rendered; `gate-frames-stamped` green.
- **Approval**: double-click = no-op; stale link = rejected; non-owner = refused.
- **Post-merge**: QA specs exist and are **RED** before implementation (proves TDD, not retrofitted tests).
- **Post-implementation**: specs green vs frames → built app → live app (as a builder-audience user).
- **`gate-frames-first`**: a UI PR without approved frames fails. Test it deliberately.

## Sequencing
1. Enable Pages · scaffold `_template` + `product-designer` + the two gates + issue form (this is the platform).
2. `product-designer` authors all six frames PRs in parallel.
3. You approve per flow.
4. Each approved flow: RED QA → components → orchestrator → package → green.
5. Promote the template + agent to FuzeSDLC; re-bootstrap.
</content>
