---
name: feature-tech-planning
description: Use when planning or designing ANY new feature, component, or service, before implementation. Researches existing libraries/services that could implement the capability, presents an honest tradeoff comparison with a clear build-vs-adopt recommendation, and reviews/optimizes the design for componentized architecture (reusable npm packages + standalone microservices). Part of the standard SDLC — apply it during brainstorming/planning, not after.
---

# Feature Tech Planning (library research + componentized architecture)

Before designing how to BUILD a capability, establish whether it should be built at all, what to build it ON, and how to package it. Skipping this leads to reinventing solved problems and to monoliths that can't be reused.

## When to use
Any time you are planning a feature, component, service, or non-trivial capability — during brainstorming/writing-plans, before implementation. Pairs with `superpowers:brainstorming` and `superpowers:writing-plans`.

## The process

### 1. Name the capability precisely
State the capability in one line and its hard requirements (functional + non-functional: scale, latency, compliance, multi-tenancy, offline, license constraints). Requirements drive the evaluation.

### 2. Research existing solutions — don't reinvent
Actively look for libraries, SDKs, and managed services that already solve this (npm, GitHub, the relevant ecosystem, the vendor's own SDK). Prefer a well-maintained existing solution over bespoke code for any non-differentiating capability. Use web search / docs for current state — do not rely on memory for versions, maintenance status, or pricing.

### 3. Build an honest tradeoff comparison
For the top 2–4 candidates (including the "build it ourselves" option), compare on the axes that matter for THIS requirement, e.g.:
- **Fit** — does it actually cover the requirements, or only 70%?
- **Maturity & maintenance** — release cadence, last release, open issues, who backs it.
- **License** — MIT/Apache vs copyleft vs commercial; redistribution implications.
- **Footprint** — bundle size (frontend), dependencies, runtime weight.
- **DX / types** — TypeScript support, docs quality, API ergonomics.
- **Lock-in & exit cost** — how hard to migrate off; proprietary data formats; managed-service dependency.
- **Security & compliance** — track record, SOC2/PCI/etc. where relevant.
Present it as a compact table. Be honest about the downsides of your recommended option.

### 4. Recommend — build vs adopt vs buy
Give ONE clear recommendation with reasoning, and name the runner-up and when you'd switch to it. "Build" is the right call only for genuine differentiators or where no option fits; say so explicitly when you choose it.

### 5. Componentized-architecture review (mandatory)
Always evaluate whether the capability should be a **reusable, independently-versioned unit** rather than woven into an app:
- **Reusable npm package** for shared frontend components, SDKs, clients, schemas, and cross-cutting logic. Define the public interface and what stays internal.
- **Standalone microservice** (also published as an npm client package) for backend capabilities that have their own lifecycle, scaling, or deployment boundary.
- Default toward extraction for anything used by >1 consumer or that has an independent lifecycle. Avoid premature splitting of things that are genuinely one unit (YAGNI) — but justify keeping something inline.
- Name the package/service boundary, its public API, and its dependencies. Files/things that change together live together.
- **Private publishing (mandatory).** Reusable npm packages publish to the project's **private** registry with `access: restricted` — never public npm. Each package's `package.json` carries a `publishConfig` (registry + `access: restricted`) and a `repository` field, and is wired into the release pipeline. For FuzeFront the registry is **GitHub Packages** (`https://npm.pkg.github.com`) under the `@fuzefront` scope; a scoped `.npmrc` (`@fuzefront:registry=...` + `GITHUB_TOKEN`/PAT auth) governs install + publish. A package is not "done" until its private publish-config is set.

### 5b. UI work is design-system-first (every component, no exceptions)
Maintaining the design system's UI/UX is part of building ANY UI component. Plan components against the project's design system BEFORE coding: use the design-system / frontend-design skill, extend the design system's tokens/components rather than one-off styling (if a needed component is missing, add it to the system instead of bypassing it), and produce concrete component specs (states, variants, tokens, a11y) to hand to implementing agents. Never hand UI to coders without a design-system-aligned spec. Each UI task's "done" includes a conformance check: no hard-coded colors/spacing/type outside the tokens, components reused not reinvented.

### 5c. Deploy wiring is part of "done" (GitOps / Argo CD)
A microservice or component is not complete until it is deployable through the project's GitOps pipeline. For any new service/package, the plan MUST include its deploy wiring: Helm Deployment+Service+values (gated by an `enabled` flag), its image in the release/CI build matrix + the prod values tag-bump, and the Argo CD wiring that syncs it. Prefer the established structure — for FuzeFront: **hybrid Argo** — core/coupled services live in the umbrella `fuzefront` chart synced by one Argo Application; independently-lifecycled services (e.g. billing, chat, the LLM gateway) get their **own Argo Application**. Prod is GitOps (Argo syncs from git; never hand-deploy to prod); local is Helm/Skaffold on kind.

### 6. Surface it before implementing
Put a short **"Library & Architecture Review"** section in the spec/plan: the comparison table, the recommendation + reasoning, and the package/service boundaries. Get the human's call on build-vs-adopt and on any managed-service/lock-in tradeoff before writing implementation code.

## Red flags
- Hand-rolling something a mature library/managed service already does well (auth, payments, OTP, RAG plumbing, rate-limiting, date math…).
- Designing a capability directly inside an app when a second consumer already exists or is obviously coming → it should be a package.
- A backend feature with its own lifecycle/scaling glued into the monolith → it should be a service.
- Choosing a library without naming its downsides, license, or exit cost.
- Recommending "build" without justifying why no existing option fits.

## Output checklist
- [ ] Capability + hard requirements stated
- [ ] Existing libraries/services researched (current data, not memory)
- [ ] Tradeoff table for 2–4 candidates incl. "build"
- [ ] One recommendation + reasoning + runner-up
- [ ] Componentization decision: npm package(s) / microservice boundaries named, with public interfaces
- [ ] "Library & Architecture Review" section added to the plan; human consulted on build-vs-adopt + lock-in
