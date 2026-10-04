# Build-your-own apps, creator ownership, and publishing

Plan of record for three related capabilities on the Applications page and the
app registry. Written before the UI so the ownership model, the API surface and
the rollout flags are decided once, rather than re-derived per file.

- **A.** A **"Build your application"** card next to "Add application" starts
  a **FuzeAgent** session that develops an app and deploys it into the user's
  personal workspace or the organization of context.
- **B.** Apps get an **"org-held, user-originated"** ownership model. The org
  owns the app. The user who created it starts with the most authority over it
  and is listed as its creator and contact. When that user leaves the org, the
  app stays with the org.
- **C.** **Publishing tiers**: private → organization → the FuzeFront
  marketplace (app store). The marketplace tier is a submit/approve flow. It is
  prepared now and kept behind a flag.

Everything ships **dark** behind default-OFF release flags (section E).

---

## A. "Build your application"

### Flow

1. On `/applications`, a second CTA card, **Build your application**, sits
   beside the dashed "Add application" card. It is hidden when
   `fuzefront.apps.build-with-agent` is OFF.
2. The card opens a short form:
   - **where**: personal workspace, or the active organization (defaults to the
     current context; org is only offered when the user has an active
     membership there)
   - **name**
   - **brief**: what the app should do, in plain language (capped at 4000
     chars)
3. `POST /api/v1/app-registry/build-sessions` creates an `app_build_sessions`
   row and asks the **builder launcher** to start a FuzeAgent session. The
   response carries the session id and, when FuzeAgent provides one, a deep
   link (`agentSessionUrl`) into the FuzeAgent federated app
   (`/app/fuzeagent/...`), where the user works with the agent.
4. FuzeAgent builds the app. It **registers the app through the normal
   registry** (`POST /apps` with the session's `organizationId`) and **deploys
   it through the normal federated path** (`/apps/<slug>/remoteEntry.js`, the
   four-layer serve-path rule in `CLAUDE.md`). It reports progress to
   `POST /build-sessions/{id}/status`: `building → deploying → deployed |
   failed`.
5. On `deployed`, the registry links the session to the app. With
   `creator-ownership` ON, it sets the app's creator to the requester and grants
   them the creator role. The app then appears on the Applications page like
   any other.

### Why the agent registers through the public API

The agent has no side channel. It goes through the same `POST /apps`
validation, slug-uniqueness, tenant checks and events as a human or
`register.sh`. The build-session layer only orchestrates and attributes; it
never writes `apps` rows itself. So a built app is indistinguishable from a
hand-registered one, and every invariant on `apps` (non-null
`organization_id`, the immutable-slug rule) holds without a second
implementation.

### Tenant pinning

A session is bound to one `organization_id` at creation: the personal org
(`organizations.type='personal'`, `owner_id = caller`) or the chosen org. The
status callback **rejects** a `deployed` report whose app lives in a different
org (409). An agent can never land an app in a tenant the requester didn't
choose, even if it is compromised or misconfigured.

### Launcher abstraction

`backend/applications/src/app-registry/builder-launcher.ts` defines
`AppBuilderLauncher.launch(input) → { agentSessionRef, agentSessionUrl? }`.
The default is `FuzeAgentHttpLauncher`. It POSTs to `FUZEAGENT_BUILD_API_URL`
with bearer `FUZEAGENT_BUILD_API_TOKEN` and a `callbackUrl`. If those env vars
are unset, the endpoint answers **503 `builder_unavailable`** and persists
nothing. The flag can therefore be ON in an environment where FuzeAgent is not
wired, without leaving stranded rows.

**FuzeAgent-side dependency (cross-repo):** FuzeAgent must expose the build
endpoint the launcher calls, and must call back with the platform service
identity. This is delegated to the FuzeAgent repo via `@fuze`; FuzeFront only
owns the client side: the launch payload is defined in
`backend/applications/src/app-registry/builder-launcher.ts`, and the callback
is `POST /build-sessions/{id}/status` in
`services/app-registry-service/openapi.yaml`.

### Session states

```
requested → launching → building → deploying → deployed
                 │           │          │
                 └───────────┴──────────┴──→ failed | cancelled
```

Transitions are forward-only. `deployed`, `failed` and `cancelled` are
terminal and immutable. The requester or an org manager can cancel a
non-terminal session.

---

## B. Ownership: org-held, user-originated

The Google Drive model: a file created by `alice@acme` in Acme's Drive belongs
to **Acme**. Alice starts with full rights over it. If Alice leaves, the file
stays with Acme and an admin re-assigns it.

| Question | Answer | Where it lives |
|---|---|---|
| Who **owns** the app? | The organization. For personal apps, the user's personal org. | `apps.organization_id` (already `NOT NULL`, migration 011) |
| Who **created / published** it? | The user who built or registered it. This is informational and **immutable once set**. | `apps.created_by_user_id` (new, `ON DELETE SET NULL`) |
| Who has **authority** over it? | The creator, through a Permit resource-instance role `App#creator` in the owning org's tenant. Org owners/admins, always, through the org role. | Permit, never the column |
| Who is the **contact**? | The creator, only while they are an active member of the owning org. | Derived at read time (`creator.isCurrentMember`) |

### Why authority is not the column

If `created_by_user_id` granted rights, a departed user would keep write
access to an org's app until someone remembered to edit a row. That is the
bug class the Drive model exists to avoid. Authority lives in Permit, scoped
to the org tenant, so it goes away with the membership. The column only
records history.

### When the creator leaves the org

- Their tenant membership is removed by security-service on
  `identity.membership.removed`. Their tenant-scoped role assignments, including
  `App#creator` instances in that tenant, go with it. **Verify this against
  Permit's tenant semantics before enabling the flag in prod.** If instance roles
  survive tenant removal, add an explicit unassign in the membership-removed
  handler. Tracked as a rollout gate in section F.
- The app is untouched: same org, same visibility, same installs.
- `created_by_user_id` keeps pointing at them. The API reports
  `creator.isCurrentMember = false`, and the UI shows "former member" instead of
  a contact.
- Org admins keep full control and can grant `App#creator` (or a future
  `App#maintainer`) to someone else. A transfer of "who is the contact" is a
  role grant, not a column edit.

### Personal apps

The owning org is the user's personal org, so the user is the owner, the
creator and the only member. If the user account is deleted, the personal org
cascades and the app goes with it. That is the expected outcome for a personal
workspace.

### Generalizing beyond apps

The pair (`organization_id` owner + `created_by_user_id` originator +
Permit-instance `creator` role) is meant to be the **family convention** for
any user-created, org-owned object (documents, boards, agents, reports). Apps
are the first adopter. When a second object type adopts it, extract the
helper (`assignCreatorRole`, the `creator` DTO projection) into a shared
package instead of copying it.

---

## C. Publishing tiers

| Tier | Who sees it | How you get there | Flag |
|---|---|---|---|
| **private** | the creator / owning-org members per existing `visibility` rules | default for built apps | none |
| **organization** | every member of the owning org | existing `PUT /apps/{slug}` visibility edit | none |
| **marketplace** | discoverable and installable by any FuzeFront user or org | `POST /apps/{slug}/publication-requests` → platform admin approve | `fuzefront.apps.marketplace-publishing` |

The marketplace flow reuses columns that have existed since migration 002 and
were never wired: `marketplace_submitted_at`, `is_marketplace_approved`,
`marketplace_approved_at`, `approved_by`, `marketplace_metadata`, and the
`visibility='marketplace'` enum value.

- **Submit:** the caller needs write on the app. Returns 409 if a request is
  already pending or the app is already approved.
- **Approve / reject:** platform admin only. Approve flips visibility to
  `marketplace`. Reject clears the submission and records the reason.
- **Later, not wired now:** listing quality checks (manifest completeness,
  security scan of the remote), review/rating (columns exist), paid apps
  (`billing-profile` exists), and a publisher profile per org. Each gets its
  own flag when it lands.

A user's **publisher identity** on the marketplace is the owning org, with the
creator as its contact while they are a member. The marketplace never makes a
departed user the public face of an org's app.

---

## D. API surface (contract: `services/app-registry-service/openapi.yaml`)

All under `/api/v1/app-registry`. Ids on the wire are TypeIDs. The service
mints build-session ids (`appBuildSession` entity type). Request bodies never
accept an id for the resource being created, or `createdBy`.

| Method | Path | Purpose | Flag |
|---|---|---|---|
| POST | `/build-sessions` | start a build | `build-with-agent` |
| GET | `/build-sessions` | my sessions (or an org's, for org managers) | `build-with-agent` |
| GET | `/build-sessions/{id}` | one session (404 if not entitled) | `build-with-agent` |
| POST | `/build-sessions/{id}/cancel` | cancel | `build-with-agent` |
| POST | `/build-sessions/{id}/status` | FuzeAgent callback (service identity only) | `build-with-agent` |
| POST | `/apps/{slug}/publication-requests` | submit to marketplace | `marketplace-publishing` |
| POST | `/apps/{slug}/publication-requests/approve` | platform admin approve | `marketplace-publishing` |
| POST | `/apps/{slug}/publication-requests/reject` | platform admin reject | `marketplace-publishing` |
| GET | `/apps/{slug}/publication` | publication state | `marketplace-publishing` |
| — | App DTO `createdBy`, `creator` | creator attribution | `creator-ownership` |

A gated endpoint with its flag OFF answers `503 {error: "feature_disabled"}`,
the same shape as the existing `v1-registry-write` gate.

---

## E. Feature flags

All are `release` flags, default **OFF**, `web_exposed` (the UI reads them).
They are registered in `packages/feature-flags/flag-registry.yaml`.

| Flag | Gates (server **and** UI) | Removal criterion |
|---|---|---|
| `fuzefront.apps.build-with-agent` | build-session API; the "Build your application" card | 100% rolled out and stable for 30 days |
| `fuzefront.apps.creator-ownership` | writing `created_by_user_id`, the `App#creator` grant, `createdBy`/`creator` on DTOs; the creator/contact block in app detail | as above, after the Permit tenant-removal check (F) |
| `fuzefront.apps.marketplace-publishing` | publication-request endpoints; the "Publish to marketplace" action and the admin review queue | as above |

The flags are independent. You can turn on building without creator
attribution (apps are still org-owned, just without a creator recorded), and
publishing works for hand-registered apps without building. Permit decides
real authority; a flag only rolls a capability out.

---

## F. Rollout and remaining work

| # | Item | Owner | State |
|---|---|---|---|
| 1 | Plan, flags, migration 018, contract (app-registry 1.2.0), backend routes, tests | backend-engineer | **this PR** |
| 2 | Frames `design/frames/app-builder/`: the card, the build form, session-in-progress, deployed, failed/cancelled/builder-unavailable, the creator/"former member" block, the publish request, the admin review queue | product-designer | frames-only PR, needs owner approval per flow |
| 3 | UI: card + build flow on `ApplicationsPage.tsx` (covered by `app-management` frames, so `gate-frames-first` blocks it until item 2 is approved), creator block, publish action | frontend-engineer | blocked on 2 |
| 4 | Permit policy: define `App#creator` (apps:write, apps:activate) and verify instance roles drop on tenant-membership removal | security / platform | config, before enabling `creator-ownership` in prod |
| 5 | FuzeAgent build endpoint + status callback | FuzeAgent repo (`@fuze`) | cross-repo |
| 6 | Env: `FUZEAGENT_BUILD_API_URL`, `FUZEAGENT_BUILD_API_TOKEN` (SealedSecret), `APP_REGISTRY_PUBLIC_BASE_URL` on applications-service | devops-engineer | chart values + sealed secret |
| 7 | Create the three flags in Unleash | feature-flags-engineer | after merge |
| 8 | Quotas: max concurrent build sessions per user/org, and billing for agent compute | backend / billing | future, flag per plan tier |
