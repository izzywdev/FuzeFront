---
name: fuzefront-ui-package
description: Use when building ANY FuzeFront frontend UI (a feature's UI package, a new component, or a screen). Enforces the non-negotiables — ship it as a private npm package, design-system-first (extend the design system, never one-off styles), RTL/LTR + a11y, build against the API contract/client, and update the design system via its own skill when a component is missing.
---

# FuzeFront UI package

Every piece of FuzeFront UI ships as a reusable, design-system-first npm package — never inline one-off styling, never ad-hoc components.

## Non-negotiables (each is part of "done")

1. **Ship as a private npm package.** `packages/<name>` → `@fuzefront/<name>`, with `publishConfig` (registry `https://npm.pkg.github.com`, `@fuzefront` scope, `access: restricted`) + a `repository` field, wired into the lerna/release publish pipeline. Dual build (es/cjs + `.d.ts`). It's not done until the private publish-config is set.
2. **Design-system-first — extend, don't bypass.** Build ONLY from `@fuzefront/design-system` ("fuse seam") components + CSS-variable tokens (`--bg-*`, `--text-*`, `--accent-*`, `--space-*`, `--radius-*`, `--font-*`, `--seam`, …). **Zero hard-coded colors/spacing/type** — a hex/rgba/px-literal in component code is a defect.
3. **If a needed component/token is missing from the design system, ADD it to the design system** (using the `design-system-inheritance` / `design-system-conformance` skills) — do NOT one-off it in the feature package. The design system stays the single source of truth; reuse before you create.
4. **Build against the API contract/client.** Consume the generated `@fuzefront/<svc>-client` types (see `api-contract-first`); never hand-write request/response shapes. Develop against the contract mock server so you don't wait on the backend.
5. **RTL/LTR + a11y.** Use CSS **logical properties** (`margin-inline`, `padding-inline-start`, `inset-inline`) so components mirror automatically; consume `@fuzefront/i18n` for strings + direction. Labels/roles/keyboard nav + visible focus (fuse-seam ring) on every interactive element.
6. **Test (TDD).** Vitest unit tests for logic + render + a11y + an RTL flip; type-check + library build green. (Full-stack Playwright e2e is a separate, live-stack concern.)
7. **Resolve in-repo packages from source, never from the registry.** When the host app (or any consumer) imports a new `@fuzefront/*` package that lives in this monorepo, wire it **exactly** like `@fuzefront/design-system` is already wired — workspace/source resolution (`workspace:*`, or the root workspace + vite/vitest/tsconfig alias) — **never a fetchable semver like `"^0.1.0"`**. A `@fuzefront/*` dependency with a numeric version and no published artifact is a build break, not a version pin (it 404s on `npm ci` — this was the PR #65 failure). Prove it with a clean `npm ci` in the **Linux/Docker** path (the `os=linux` npmrc gotcha hides this on Windows): **zero registry 404s before claiming green.** This is enforced by the **required** `In-repo packages resolve from source` CI gate (`scripts/check-workspace-deps.mjs`).
8. **Type-check against built `.d.ts`, bundle from source (PR #65 finish-pass lessons).** The `frontend` host is NOT a root workspace — it has its own `node_modules`, so compiling a UI package's *source* under the host's `tsc` pulls in a **second `@types/react`/`csstype`** copy → `CSSProperties` TS2322 clashes. Therefore: in `frontend/tsconfig.json`, resolve each consumed `@fuzefront/*` UI package to its built **`dist/index.d.ts`** (like `@fuzefront/design-system`) and **build it in CI before the frontend type-check**; keep the vite/vitest aliases pointing at **source** for bundling/tests. Also: the Module-Federation `shared` array stays **`['react','react-dom']` only** — never list `@fuzefront/*` packages there (they are source-file-aliased, so the plugin reads `<file>/package.json` → `ENOTDIR` and breaks `vite build`); host UI packages are bundled directly. And a `tsc`/build job will surface **undeclared transitive deps** (e.g. `socket.io-client` imported in `shared` but never declared) — declare them in the owning `package.json`.

## Procedure
1. Plan the components against the design system FIRST (states, variants, tokens, a11y) — if a primitive is missing, extend the design system via its skill, in the design-system package, before building the feature UI.
2. Scaffold `packages/<name>` with the private `publishConfig` + build setup.
3. Implement design-system-first against the `@fuzefront/<svc>-client` + `@fuzefront/i18n`; TDD.
4. Verify: vitest green, type-check clean, library build (es/cjs/dts), no hard-coded design values (grep for hex/rgba), a11y assertions pass.
5. Wire into the frontend container (mount + Module-Federation `shared` entry) **resolving the package from source like `@fuzefront/design-system` — never a registry semver** (non-negotiable 7); confirm a clean `npm ci` in Docker has zero 404s; keep the PR draft until verified.

## Done checklist
- [ ] `@fuzefront/<name>` private publishConfig + repository + in publish pipeline
- [ ] only `@fuzefront/design-system` tokens/components; zero hard-coded color/spacing/type
- [ ] missing primitives added to the design system (not one-offed)
- [ ] consumes the generated `@fuzefront/<svc>-client` + `@fuzefront/i18n`; RTL via logical properties; a11y
- [ ] vitest + type-check + dual build green
- [ ] new `@fuzefront/*` consumer dep resolved from source (workspace/alias), not a registry semver; clean `npm ci` in Docker has zero 404s
