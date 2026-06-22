# FuzeOne membership ({{REPO}})

This repo is a member of the **FuzeOne** family — the app-of-apps framework hosted by **FuzeFront** ({{HUB}}). FuzeInfra is the shared infrastructure layer *below*; the app layer fuses *inside* the FuzeFront host. This block is managed by `fuzeone sync` — edit the source in the hub (`fuzeone/templates/CLAUDE.fuzeone.md`), not here.

## How we work (the SDLC, in brief)
- **Start with the repo's expert agent** (`fuzefront-expert` for the app layer, `fuzeinfra-expert` for infra) to load context before planning/coding.
- **Plan features with `feature-tech-planning`**: research build-vs-adopt first; prefer reusable npm packages + standalone microservices over monolithic coupling; publish reusable `{{SCOPE}}/*` packages **privately** to GitHub Packages.
- **Contract-first for substantial features**: freeze + PR an OpenAPI/Swagger spec (+ event schemas), generate the `{{SCOPE}}/<svc>-client`, then fan out parallel streams gated only on the contract.
- **Domain agents, not one mega-agent**: `contract-designer` (sequential gate) → then `backend-engineer` · `frontend-engineer` · `test-engineer` · `devops-engineer` · `docs-maintainer` in parallel. Each has an exclusive scope and a mandatory honest-"done" report (`SCOPE DONE (verified)` / `OUT OF SCOPE — NOT DONE`). No agent calls the *feature* done — only its slice; the feature is done only when **every** slice's PR is green + merged.
- **UI is design-system-first**: build from the design system's tokens/components; extend the system rather than one-off styling; a11y + RTL are in scope.
- **Delivery = a merged PR**, not just local commits. Push continuously; never hold work only on local disk.
- **GitOps for deploy**: prod is GitOps-only (never hand-deploy); infra/cluster changes are *declared* in `deploy/` and reconciled by FuzeInfra — never edit FuzeInfra directly (delegate via a `@claude` issue).

## Standard automation (installed by fuzeone)
`claude.yml` (@claude handler) · `claude-auto-pr.yml` · `claude-ci-autofix.yml` · `telegram-pr-merged.yml` · `auto-merge.yml` · `deliverable-verify.yml` (+ `helm-validate.yml` and `infra-dispatch.yml` when this repo has a chart / declared infra). CI workflows reference the hub's reusable definitions (`uses: {{HUB}}/.github/workflows/reusable-*.yml@{{HUB_REF}}`) so central fixes propagate; re-run `fuzeone sync` to update the local files.

## Re-sync / check drift
Ask `fuzefront-expert`: "set me up / update me to the latest FuzeOne standard", or run the hub's `fuzeone/sync.mjs --target .` (use `--check` to see drift). See {{HUB}} → `fuzeone/README.md`.
