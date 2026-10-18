# Building a new app or screen — the UX flow

The expected, enforced sequence for any UI work on FuzeFront, for implementing agents and
contributors. It exists because UI used to ship with no approved design and, in the worst
case, six backends shipped with **no UI at all** and nothing caught it. The rule now: **no UI
is written before its design is approved, and every design covers mobile.**

This is the operational walkthrough. The *why* and the pipeline of record are
`docs/planning/design-first-ui-pipeline.md` + `CLAUDE.md` → "Design-first gate". The runtime
contract your UI lives inside is `docs/design-system/portal-ux.md`. The tokens and responsive
model are the design system's brand book + "Mobile & responsiveness" guideline.

## The one-paragraph version

A product requirement becomes **navigable HTML frames** (`design/frames/<feature>/`) authored
by `product-designer` — desktop **and** mobile, with every state (loading/empty/error/
fail-closed) — opened as a **frames-only PR**. The owner approves **per flow**. Merging the
approved frames is the trigger: QA writes **RED** Playwright specs, then `frontend-engineer`
(desktop) and `mobile-frontend-engineer` (responsive shell) build against the frames until the
specs go green, as a private npm UI package. `frontend-test-engineer` verifies the built UI —
desktop and mobile — against the approved frames. You never skip to code.

## Track A — adding a screen to an existing app

1. **Start from the requirement, not the code.** A user story / product requirement is the
   input. If it does not exist on the working ref, do not invent it — stop and ask.
2. **`product-designer` authors the frames** under `design/frames/<feature>/`: `index.html`
   entry + ordered `NN-*.html` screens + `tokens.css` + `manifest.json`. Required content:
   - every **state** as its own frame — loading, empty, error, and the real fail-closed cases;
   - a **mobile frame** (≈375px) for each flow, not only the desktop width — mark
     `frames[].viewport` and declare `build.flows[].responsive` (which frame is the mobile one,
     which viewports the flow covers). Honour ≥44px touch targets, the `md` nav transition,
     and safe-area insets, all via tokens;
   - the **build inventory** (`build.flows` / `components` / `packages`) rendered in
     `index.html` and mirrored in the manifest — approving the design approves the architecture;
   - `implementation.paths` (feature) and `build.flows[].implementation.paths` (per flow) so
     `gate-frames-first` can map a changed source file back to the flow that must be approved.
3. **Open the frames PR — frames only.** No feature code, tests or config ride along. CI
   enforces the UX/UI policy: `gate-ds-conformance` (tokens only), `gate-frames-schema`
   (manifest valid + mobile coverage), `gate-frames-stamped` (content stamp current).
   > `gate-frames-schema` ships with the **phase-2 CI-gates change**; until that lands on
   > `master`, manifest validity and mobile coverage are reviewer-enforced, not gated. The
   > other two gates are already live.
4. **Owner approves per flow.** One ready flow is not held up by an unready sibling. **Reject
   re-dispatches `product-designer`** to iterate — it does not close the thread.
5. **Merge is the trigger for the next phase** — an **orchestrated hand-off** (the UX-QA and
   frontend agents are dispatched to act on the merged frames), not a merge-triggered CI
   workflow; nothing in `.github/workflows` auto-dispatches it today, so the orchestrator starts
   this phase. QA writes Playwright specs per flow that are **ALL RED** first (the spec fails
   before any implementation exists). Then:
   - `frontend-engineer` builds components → flow orchestrators → the private `@fuzefront/*-ui`
     package, design-system-first, against the API contract/client. It owns the feature's own
     responsiveness: each component — the screen's tables, forms and actions — must match
     **both** its desktop and its approved **mobile** frame, until the specs go green at both
     viewports;
   - `mobile-frontend-engineer` implements the responsive **shell chrome around** that content
     to match the approved mobile frame (drawer/nav transition, top bar, safe-area, PWA/TWA
     constraints) — the shell, not the feature's own content. Neither authors its own mobile
     design — the frame is the design.
6. **Validate before "done".** Both implementers run the `ui-runtime-validation` console-clean
   check in a real Chromium at **desktop and mobile** viewports (0 errors / 0 CSP·mixed-content
   / 0 failed requests). A missing primitive is added to the design system by `frontend-engineer`
   via the design-system skill — never one-off styled in feature code.
7. **`frontend-test-engineer` verifies independently** — Playwright + the `mobile-conformance`
   device matrix — the built UI against the approved frames, desktop and mobile. A runtime
   error is a bug to REPORT, never patched by QA.

## Track B — building a new app (federated remote)

Everything in Track A, plus the app-platform wiring. Design-first still comes first.

1. **Read the contract you build inside first:** `docs/design-system/portal-ux.md` (shell-vs-app
   ownership, the bridge, routing, mount modes) and `docs/guides/BUILDING_ON_FUZEFRONT.md`
   (registration, React-19/Node-24 singleton rules, same-origin API base).
2. **Design-first for the app's screens** (Track A steps 1–4) — including the mobile frames,
   because the app must work in the TWA, which wraps the **standalone** surface.
3. **Register, don't hard-code.** Self-register via the manifest (`docs/mfe-self-registration.md`
   + `@fuzefront/onboarding-kit`). Pick a slug (free at creation, immutable after), a display
   name (drop the `Fuze` prefix — see `CLAUDE.md`), and a serve path (`/apps/<slug>/`,
   consistent across the four layers). Declare `integration.{remoteEntry,scope,module}` and,
   if the app has its own nav, `chrome.menu: "substitute"` — the shell still owns the
   non-removable "Return to portal" control.
4. **Honour the in-shell behavior contract** (`portal-ux.md` §3): no shell chrome in your
   remote, own only your data's states, use the bridge for toasts/menu/context, same-origin
   API, inherit theme + support RTL, scroll within the content area.
5. **Mobile is not optional.** Two distinct manifests, don't conflate them: the app declares
   its mobile requirement in the **product repo's `.fuze/manifest.json`** (`mobile` block), while
   the **registration manifest** (schema `additionalProperties: false`, no `mobile` key) expresses
   the wrappable surface through `modes` (including `standalone`) and `routing.host`. The TWA
   wraps the standalone surface. A desktop-only app is an explicit, justified exemption
   (`build.flows[].responsive.exempt` + reason in the frames manifest), not a default.

## What will stop you (the gates)

| You did this | This catches it |
|---|---|
| Wrote feature UI with no approved covering frame flow | `gate-frames-first` (BLOCKED → hard-fail) |
| Frames PR with an invalid manifest, or a flow with no mobile coverage | `gate-frames-schema` (+ responsive-coverage check) — *ships with the phase-2 gates PR* |
| Edited frames without re-stamping | `gate-frames-stamped` |
| Raw hex / px / font in frames or feature code | `gate-ds-conformance` (changed-lines, enforcing) |
| Mobile layout broken (drawer, touch targets, overflow) | the `mobile-layout` Playwright gate |
| Shipped a console error / CSP / failed MF load | `ui-runtime-validation` (desktop + mobile) |

If a gate you expect is missing, that is a defect to fix, not a step to skip — `CLAUDE.md` →
"FIX is the rule".

## Agent ownership at a glance

| Phase | Agent |
|---|---|
| Design (frames, desktop + mobile, states, inventory) | `product-designer` — sole author of `design/frames/**` |
| Feature implementation (components responsive at desktop **and** mobile) + design-system primitives | `frontend-engineer` — sole editor of `design-system/` |
| Responsive **shell chrome** around the content (drawer/nav, top bar, safe-area, PWA/TWA) | `mobile-frontend-engineer` |
| Independent verification (Playwright + mobile-conformance, desktop + mobile) | `frontend-test-engineer` |
| API/event contract | `contract-designer` · **Deploy/CI** `devops-engineer` · **Docs** `docs-maintainer` |

The implementer never authors the design it is measured against — exactly as
`contract-designer` (not `backend-engineer`) owns the API spec.
