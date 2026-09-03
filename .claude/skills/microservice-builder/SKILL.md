---
name: microservice-builder
description: Use to create/bootstrap a NEW microservice inside a Fuze repo end-to-end — service boundary + directory, the frozen contract, PACKAGING (the private @scope/<svc>-client npm package, the container image + CI/registry wiring, and versioning), the per-service data tier, the Helm/Argo/CI deploy wiring, and optional MCP/CLI channels — then verify it stands up. The service-level analog of sdlc-bootstrap. Reads a service manifest (`service.json`, schema governance/service-manifest.schema.json).
---

# microservice-builder

Bootstraps a new microservice as a fully-governed, **packaged**, deployable unit — not just a folder. Orchestrated contract-first; each step is owned by the domain agent named below. The skill is the *procedure*; the orchestrator runs it and fans out.

## Inputs — `service.json` (validate against `governance/service-manifest.schema.json`)
Names the service, its scope, type (`http-service` | `worker` | `library`), language, the data engines it needs, opt-in `channels` (`mcp`/`cli`), and `packaging`/`deploy` choices (client-package name, image registry, Argo placement). If absent, derive it from the user story first and write it.

## Steps

1. **Boundary + plan** — run `feature-tech-planning`: build-vs-adopt, the service's public interface, and confirm the package/service name + Argo placement (umbrella vs standalone). *(contract-designer)*
2. **Directory** — scaffold the service dir in the repo's convention (`services/<svc>/` or the repo's layout), with src/test/config skeleton, README stub, and a health endpoint.
3. **Contract (the gate)** — freeze OpenAPI/AsyncAPI + event (Kafka Zod) schemas; lint (Spectral); **generate the typed client**. Nothing else merges until this PR is frozen. *(contract-designer)*
4. **PACKAGING — first-class, not an afterthought:** *(devops-engineer owns the wiring; contract-designer owns the client API)*
   - **Client npm package** `@<scope>/<svc>-client`: `package.json` with `publishConfig` targeting the **private** registry (GitHub Packages `https://npm.pkg.github.com`, the repo's scope, `access: "restricted"` — **never public npm**), the `repository` field set, types/`.d.ts` emitted, and a consumer `.npmrc` snippet documented. Wire it into the **release pipeline** so it publishes on version bump. A service isn't done until this is publishable.
   - **Container image**: a `Dockerfile` (multi-stage, non-root), build, and publish to the image registry (GHCR by default); **add the service to the release/CI image build matrix** and the **prod values tag-bump**.
   - **Versioning/release**: semver via conventional commits; the release workflow bumps the client package + image tag together; changelog generated.
5. **Data tier** — per-service DB role/database, ordered + idempotent migrations and their deploy mechanism (pre-sync Helm/Argo Job), connection wiring via `DATABASE_URL`/SealedSecret/service-DNS. *(database-engineer)*
6. **Deploy wiring** — Helm `Deployment`+`Service`+values with an **`enabled` gate**; Argo per the hybrid model (core/coupled → the umbrella chart's one Application; independently-lifecycled → its own Argo Application); image in the CI matrix + prod values tag-bump; SealedSecrets scaffolding. **Prod is GitOps — never hand-deploy.** *(devops-engineer)*
7. **Channels (optional, per `service.json`)** — MCP server scaffold *(mcp-engineer)* and/or CLI scaffold *(cli-engineer)*, each generated from the contract/client.
8. **Tests** — unit-test skeleton with the implementer; independent contract/integration tests authored by `test-engineer`.

## Verify (the service stands up)
- Service builds + type-checks; `Dockerfile` builds an image.
- `helm template` renders the new chart with `enabled: true`; `kubeconform` passes; the Argo Application/umbrella entry resolves.
- The `@<scope>/<svc>-client` package builds, resolves from source in-repo, and has valid private `publishConfig` + `repository`.
- Contract lints (Spectral); migrations apply cleanly + idempotently.
- The service appears in the CI build matrix and prod values.

## Ownership (see governance/routing.md)
Orchestrated; **contract gate = contract-designer**, **packaging + deploy wiring = devops-engineer**, **data tier = database-engineer**, **channels = mcp-engineer/cli-engineer**. Cluster-level datastore/infra is delegated to FuzeInfra via `@fuze`. The orchestrator judges the service "stood up" only when every step above is verified.
