# developers.fuzefront.com — Fuze Family Developer Portal (design proposal)

> **Status:** Draft for owner approval. No implementation in this PR — this is a design/plan doc
> only. Nothing here is built until this doc is approved and turned into epics/stories following
> the usual `agile-manager` (`ticket-creator`) discipline, and delegated to the owning agents.

## 1. Problem statement

There is no single place for a developer (internal or third-party) to discover, read, and
**try out** the APIs exposed by the Fuze product family. Each product/service publishes its own
`openapi.yaml` (`services/*/openapi.yaml`, `packages/{auth,security}/openapi.yaml`, and the
equivalent contracts in sibling repos — FuzeAgent, FuzeBI, FuzeX, MendysRobotics, etc.) but they
are scattered across repos with no aggregated catalog, no unified sign-in, and no safe sandbox to
exercise an endpoint without hitting production.

## 2. Goal

Stand up **`developers.fuzefront.com`** — a portal that:

1. Has a **home page** (landing/overview + catalog navigation).
2. **Signs in with the same FuzeFront identity** (Authentik OIDC) — no separate credential system.
3. On first sign-in, auto-provisions the user as a **member of the root organization** with a new
   **`Developer`** group/role, governed by a proper **Permit.io policy** (least-privilege: read the
   catalog + use the sandbox; nothing else).
4. Presents an **aggregated, navigable catalog of OpenAPI docs** from every service across the Fuze
   family of repos.
5. Offers a **"Try it" / playground sandbox** to exercise an endpoint safely, without ever touching
   a real production system with a developer's own token.

## 3. Library & Architecture Review (build vs. adopt)

| Option | Aggregates many OpenAPI specs | Try-it-out sandbox | Auth/Permit integration | Design-system fit | License / cost | Verdict |
|---|---|---|---|---|---|---|
| **Backstage** (Spotify OSS IDP) | Yes, via Software Catalog + API Docs plugin | Yes, via plugins (Swagger UI/Redoc embed) | Custom — would need a bespoke Authentik/Permit auth provider plugin | None — separate React app/plugin model, cannot reuse `@fuzefront/design-system` | Apache-2.0, free, but heavy: its own catalog DB, plugin backend, ongoing upgrade burden | Overkill — solves "internal developer hub" (service catalog, tech radar, scaffolding) when we only need "API doc catalog + sandbox". Runner-up if FuzeFront later needs a full internal-developer-portal/service-catalog play beyond API docs. |
| **Redoc (OSS)** | No — one spec per instance; aggregation is a **paid** Redocly Dev Portal feature | No (OSS) — read-only three-pane docs | N/A (static renderer only) | Would need to be iframed/themed | MIT (OSS), but the features we need (aggregation, try-it, auth) are commercial | Rejected — the two features we most need (aggregation, try-it) aren't in the free tier. |
| **Docusaurus + `docusaurus-plugin-openapi-docs`** | Partial — one Docusaurus instance can render many specs as pages, but "catalog" UX is hand-built | Limited — plugin renders request/response but "try it" is a thin embed | Custom | Separate static-site stack, not our shell/design-system | MIT | Good for pure narrative docs, weak as a live catalog + sandbox experience; would still need a bespoke sandbox layer bolted on. |
| **Swagger UI (OSS)** as a renderer, embedded in a FuzeFront-native app | N/A — it renders one spec; aggregation is our own catalog layer | **Yes** — native "Try it out" against a configurable server URL | Full — it's just a component inside our own app | Full — it's our own React app on `@fuzefront/design-system` | Apache-2.0, free | **Recommended**, as the renderer inside our own app (see §4). |
| **Build our own catalog + reuse Swagger UI / Stoplight Elements (OSS) as the per-spec renderer, inside a FuzeFront-native app** | Yes — our own lightweight registry service, see §4 | Yes — proxied through our own sandbox gateway (see §6), not raw Swagger UI "try it" against real prod hosts | Full — same Authentik/Permit stack as the rest of FuzeFront | Full — first-class `@fuzefront/design-system` app, same shell chrome/nav | Our own code, small surface | **Recommended.** |

**Recommendation: build a small, FuzeFront-native portal** that (a) hosts its own lightweight
**spec catalog/registry** (aggregation is a solved problem for us — it's just an index over
`openapi.yaml` files we already produce) and (b) renders each selected spec with an OSS,
embeddable component (**Stoplight Elements** or **Swagger UI** — both Apache-2.0/MIT, both support
"try it out"; pick in the technical spec after a short spike comparing their theremeability against
`@fuzefront/design-system` tokens). We do **not** adopt Backstage: it solves a much bigger problem
(full internal developer portal / service catalog / scaffolding) than "browse + try API docs", and
it cannot reuse our existing design system, auth stack, or Permit policy model — every one of those
would have to be re-integrated as a Backstage plugin. Runner-up: **Backstage**, reconsider only if
FuzeFront's roadmap grows into a broader internal-developer-portal need (service catalog, golden-path
scaffolding, tech radar) that goes beyond API docs — at that point the sandbox/registry built here
can be embedded as a Backstage plugin rather than thrown away.

## 4. Architecture overview

```
developers.fuzefront.com (new subdomain, wildcard *.fuzefront.com — see §8)
        │
        ▼
┌───────────────────────────┐        ┌──────────────────────────────┐
│  devportal-frontend        │  OIDC  │  Authentik (existing)         │
│  (new Vite/React app,      │◄──────►│  same FuzeFront OIDC provider │
│  @fuzefront/design-system) │        │  (redirect URI added,         │
│  - Home / landing          │        │   mirrors custom-domains      │
│  - Catalog navigation      │        │   registrar pattern)          │
│  - Spec viewer (Stoplight  │        └──────────────────────────────┘
│    Elements / Swagger UI)  │
│  - "Try it" panel          │
└─────────────┬─────────────┘
              │ REST
              ▼
┌───────────────────────────┐        ┌──────────────────────────────┐
│  devportal-service          │──────►│  Permit.io (existing PDP)     │
│  (new microservice)         │       │  - Developer role/policy      │
│  - spec registry (index of  │       │  - root-org membership check  │
│    family OpenAPI specs)    │       └──────────────────────────────┘
│  - harvest job (pull specs  │
│    from family repos)       │       ┌──────────────────────────────┐
│  - sandbox proxy (§6)       │──────►│  Sandbox targets              │
└───────────────────────────┘        │  - mock servers (Prism) per    │
                                      │    service, generated from     │
                                      │    the same openapi.yaml       │
                                      │  - OR each family repo's own   │
                                      │    staging/sandbox environment │
                                      └──────────────────────────────┘
```

### 4.1 `devportal-frontend`

- A new, standalone frontend app (not a Module-Federation remote mounted into the FuzeFront shell —
  it needs to be reachable pre-shell, at sign-in, on its own subdomain). Structurally modeled on
  `fuzefront-website/` (own `frontend/`, own deploy), **not** on the federated app pattern used by
  `frontend/src` remotes.
- **Design-system-first**: built on `@fuzefront/design-system` (this repo publishes the base — see
  `CLAUDE.md` "Design system" section). No one-off styling; if a needed primitive (e.g. a
  three-pane API-doc layout, a code-sample tabs component) is missing, add it to the design system
  first via the design-system skill, per `feature-tech-planning` §5b.
- Pages: **Home** (what the portal is, quick links, sign-in CTA), **Catalog** (browse by
  product/repo → service → spec, search/filter), **Spec viewer** (aggregated markdown overview +
  embedded Stoplight Elements/Swagger UI render of the selected `openapi.yaml`), **Playground**
  (the sandboxed "try it" panel, §6), **My access** (shows the signed-in developer their root-org
  `Developer` membership and current sandbox quota/keys).
- Design-first gate applies: this repo's `product-designer` authors `design/frames/devportal/**`
  (home, catalog, spec viewer, playground states — including empty/loading/error/quota-exceeded)
  **before** any component is coded, per `CLAUDE.md`'s "Design-first gate" section.

### 4.2 `devportal-service` (new microservice)

Follows this repo's `microservice-builder` pattern (own directory under `services/`, own frozen
OpenAPI contract via `contract-designer`, own data tier, own Helm/Argo wiring):

- **Spec registry**: a small table (`devportal_specs`: `repo`, `service`, `spec_path`, `version`,
  `fetched_at`, `raw_spec` or a pointer to blob storage) populated by a **harvest job**.
- **Harvest mechanism**: each family repo already produces `openapi.yaml` files at known paths
  (this repo: `services/*/openapi.yaml`, `packages/{auth,security}/openapi.yaml`; sibling repos are
  expected to follow the same `api-contract-first` convention — see `.claude/skills/api-contract-first`).
  Two viable mechanisms, to decide in the technical spec:
  1. **Pull**: `devportal-service` polls each repo's default branch (raw GitHub content or a
     released artifact) on a schedule/webhook and re-indexes changed specs.
  2. **Push**: each family repo's CI publishes its spec(s) to `devportal-service` (or a shared
     artifact store) on merge to its default branch — mirrors how `mcp-gateway`'s tool descriptions
     are kept fresh (`scripts/check-descriptions-fresh.mjs`) and is the lower-latency, less
     rate-limited option.
  Recommendation: **push**, via a small, reusable GitHub Actions step
  (`.github/workflows/publish-openapi-spec.yml` template) each family repo adds — this also gives
  us a natural place to validate the spec (`swagger-cli validate` / Spectral) before it's ever
  shown to a developer, catching a broken contract at the SOURCE repo's CI rather than surfacing it
  as a broken playground for every developer downstream.
- **Sandbox proxy**: brokers "try it" calls — see §6.
- **Auth**: verifies the same Authentik-issued bearer/session as the rest of FuzeFront; every call
  is Permit-checked (§5).

### 4.3 Componentization

- `devportal-service` — standalone microservice, own Argo Application (independently-lifecycled:
  its harvest job and sandbox proxy have a different scaling/deploy cadence than the FuzeFront
  monolith), per `feature-tech-planning` §5c "hybrid Argo" guidance.
- `devportal-frontend` — standalone app (own Helm Deployment+Service+Ingress), not part of the
  federated shell.
- If other family repos want to consume the registry/catalog data programmatically (e.g. a CLI, or
  another portal), extract a thin `@fuzefront/devportal-client` npm package (generated from the
  frozen contract, private-published to GitHub Packages under `@fuzefront`, per
  `feature-tech-planning` §5 "Private publishing"). Not built until a second consumer exists (YAGNI)
  — named here so the boundary is clear when one does.

## 5. Identity & authorization

### 5.1 Sign-in

Reuse the **existing FuzeFront Authentik OIDC provider** — no new IdP, no new user store.
`developers.fuzefront.com` needs its own OIDC **redirect URI** registered on the same provider,
following the exact pattern already used for custom domains
(`backend/src/custom-domains/authentikRedirect.ts`): register
`https://developers.fuzefront.com/api/auth/oidc/callback` on the `FuzeFront` OAuth2 provider. Since
this is a first-party subdomain (not a customer-provisioned one), the redirect URI can be added as a
**static** entry in the Authentik blueprint (`deploy/helm/fuzefront/templates/authentik-blueprints.yaml`)
rather than registered at runtime.

### 5.2 Root-org membership + `Developer` group

On first successful sign-in at the dev portal, provision:

1. An `organization_memberships` row for the user on `ROOT_ORG_ID`
   (`backend/src/migrations/015_seed_root_platform_organization.ts`) with a new membership role
   `developer` — mirrors the existing `owner|admin|member|viewer` membership roles
   (`role-assignment.ts`), added as a **new, additive** value; it does not replace or reuse
   `admin`/`employee`, which carry cross-tenant ReBAC authority (`rootOrgAdmin.ts`,
   `employeeRole.ts`) that a developer-portal sign-in must **never** grant.
2. This is a **direct, root-scoped grant**, not a ReBAC derivation like `org-admin` — a `Developer`
   has no need to inherit authority onto child-org instances, so no `parent`-relation derivation is
   introduced for it (unlike `Organization.roles['org-admin']` in `permit/schema.ts`).

### 5.3 Permit.io policy

Declare a new resource + tenant role in `backend/src/permit/schema.ts` (or, if devportal ships as a
fully separate service with its own policy lifecycle, as a `ProductPolicy` submitted via the
existing namespacing mechanism in `product-policy.ts` — decide in the technical spec based on
whether `devportal-service` is considered platform or a "product" for policy purposes; leaning
**platform**, since it governs access to root-org membership, not a tenant's own data):

```
resource DevPortalCatalog { actions: read }
resource DevPortalPlayground { actions: use, view_history }

role developer:
  permissions: [DevPortalCatalog:read, DevPortalPlayground:use, DevPortalPlayground:view_history]
```

- `developer` is deliberately **narrower** than `viewer` — it must NOT inherit
  `Organization:read`/`App:read`/etc. A developer-portal sign-in grants catalog + sandbox access
  only, nothing about the rest of the platform's tenant data.
- `PermitAuthorizationProvider` (existing) enforces this the same way it enforces every other
  resource — no new authz mechanism, just a new resource/role pair synced via the existing
  `syncPermitSchema` idempotent get-or-create flow.

## 6. Sandboxed "try it" playground — the part that must not touch production

The single hardest constraint here: a developer must be able to **execute** a request against a
real-shaped API without ever reaching a production system, a production database, or a real
customer's data — and without needing a real, scoped API credential for every family service (which
would require each of 18 `providesTo` products to build its own API-key issuance UI just for this
portal).

**Design: `devportal-service` proxies every "Try it" call through a sandbox layer, never
straight-through to the target host the spec's `servers:` block names.**

- For services that can run a **mock server generated directly from their own `openapi.yaml`**
  (e.g. via **Prism**, OSS, MIT-licensed — mocks requests/responses purely from the spec, no real
  backend needed), the playground targets that mock. This is the default and safest path: zero
  blast radius, works for any family repo the moment it has a valid spec, no per-repo sandbox
  environment to provision or maintain.
- For services where a mock response isn't good enough to demonstrate real behavior (complex
  stateful flows), a family repo may **opt in** to registering its own dedicated **staging/sandbox
  base URL** in its published spec metadata (an `x-fuzefront-sandbox-url` extension field, or a
  dedicated `servers` entry named `sandbox`) — `devportal-service` only ever calls that declared
  sandbox URL, never a repo's production `servers` entry, and only if the repo has explicitly opted
  in. Absence of an opt-in means "mock only", not "no sandbox" — no service is ever silently
  exercised against prod.
- Every sandboxed call is rate-limited and counted against `DevPortalPlayground:use` per developer
  (`view_history` shows a developer their own recent sandbox calls — useful for debugging what they
  sent — not other developers' calls).
- No real Authentik/Permit-issued production bearer token is ever forwarded into a sandboxed call —
  the proxy mints a synthetic sandbox identity/token scoped only to the mock/sandbox target, so even
  a bug in a mock server can't be tricked into treating it as a real authenticated principal.

This mirrors, at arm's length, the existing `ServiceEndpoint`/`s2s-caller` Permit pattern
(`permit/schema.ts`) for "a scoped, individually-revocable grant to invoke something" — but
deliberately does **not** reuse that resource directly, since S2S callers are service accounts with
real invoke authority on real endpoints, and a developer-portal sandbox principal must never be
mistaken for one.

## 7. Home page & navigation content

- **Home**: what the Fuze family/platform is, a directory of participating products
  (`.fuze/manifest.json`'s `providesTo` list is the authoritative source for "which family repos
  should appear"), a "Sign in to explore" CTA for anonymous visitors, and — once signed in — a
  personalized "your recent specs" / "your sandbox activity" panel.
- **Catalog**: grouped by product (FuzeAgent, FuzeBI, FuzeX, …) → service (each repo's own
  `services/*/openapi.yaml` granularity) → spec. Search/filter by tag/operation, consistent with
  how `services/app-registry-service/openapi.yaml` is already organized (tags, per-operation
  descriptions) — no new documentation convention is needed in the source repos, the portal simply
  consumes what `api-contract-first` already mandates them to produce.

## 8. Deploy & infra wiring

- **Subdomain**: `developers.fuzefront.com` rides the wildcard `*.fuzefront.com` DNS/TLS/ingress
  already requested from FuzeInfra in `docs/planning/fuzeinfra-custom-domains-request.md` (reserved
  hosts there are only `app`, `auth`, `*.prod` — `developers` is not reserved). **Action needed
  before build**: confirm with FuzeInfra whether that wildcard capability has landed yet, and if a
  dedicated ingress rule (routing `developers.fuzefront.com` to the new `devportal-frontend`
  Service, rather than the default `fuzefront-frontend`) needs its own small FuzeInfra/Helm change —
  this is a **delegation to FuzeInfra**, not something to hand-wire from this repo.
- **Helm**: new `devportal-service` and `devportal-frontend` Deployments/Services, each behind their
  own `enabled` flag, in the `fuzefront` umbrella chart (`deploy/helm/fuzefront/`) if tightly coupled
  to platform release cadence, or its **own Argo Application** if it needs independent scaling
  (leaning independent Argo Application, since the harvest job and sandbox proxy have a distinct
  load/scaling profile from the core platform — per `feature-tech-planning` §5c).
- **Feature flag**: ship the whole capability behind a default-OFF flag,
  `fuzefront.devportal.enabled` (Unleash, via `@fuzefront/feature-flags` — see the `feature-flags`
  skill), gating both the new routes/service and the UI, so it can be rolled out to internal staff
  first before public developer access.
- **CI**: add `devportal-service`/`devportal-frontend` to the existing build/test/release matrix;
  each family repo that wants to participate adds the small "publish spec" CI step from §4.2.

## 9. Rollout phases

1. **Phase 0 — contract & design**: `contract-designer` freezes `devportal-service`'s OpenAPI
   contract; `product-designer` authors `design/frames/devportal/**` (home, catalog, spec viewer,
   playground, all states) for owner approval, per the design-first gate.
2. **Phase 1 — identity & policy**: root-org `developer` membership role, Permit schema changes,
   Authentik redirect URI, all behind the feature flag, with tests.
3. **Phase 2 — registry & harvest**: `devportal-service` spec registry + the reusable "publish spec"
   CI step, wired first for this repo's own services as the reference implementation.
4. **Phase 3 — frontend**: home, catalog, spec viewer (Stoplight Elements/Swagger UI embed) against
   the frames from Phase 0, once flow-by-flow approved.
5. **Phase 4 — sandbox playground**: Prism-mocked "try it", then the opt-in sandbox-URL path.
6. **Phase 5 — family rollout**: work with each `providesTo` repo (delegated via `@claude`) to add
   the publish-spec CI step and, optionally, opt in a sandbox URL.
7. **Phase 6 — deploy & flag flip**: Helm/Argo wiring, internal dogfood behind the flag, then public
   flip.

## 10. Open questions for owner approval

1. **Policy placement** (§5.3): should `Developer`'s Permit resources live in the base platform
   schema (`permit/schema.ts`) or as a `ProductPolicy` devportal registers for itself? Leaning
   platform, but this is a judgment call.
2. **Harvest mechanism** (§4.2): push (family repos add a CI step) vs. pull (devportal polls). Push
   is recommended but requires coordinating a small change across every `providesTo` repo.
3. **Argo topology** (§8): own Argo Application vs. folded into the `fuzefront` umbrella chart.
4. **Spec renderer** (§3): Stoplight Elements vs. Swagger UI — needs a short design-system-theming
   spike before locking in; not blocking this plan's approval.
5. **Sandbox depth** (§6): is "mock-server-only by default, opt-in real sandbox URL" the right
   default, or does the portal need real sandbox environments from day one for a subset of
   high-value family services?

---

**Nothing in this document has been implemented.** On approval, this becomes epics/stories via the
`agile-manager` (`ticket-creator`/`ticket-reviewer` discipline, matching the format in
`docs/planning/epics/`), and implementation is delegated to `contract-designer`, `product-designer`,
`backend-engineer`, `frontend-engineer`, `devops-engineer`, `feature-flags-engineer`, `security`, and
`docs-maintainer` per their single-responsibility scopes.
