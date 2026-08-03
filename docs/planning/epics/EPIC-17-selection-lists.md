---
key: FF-EPIC-17
title: Enable organizations to define governed, translatable selection lists as reusable reference data
label: [fuzefront, platform, selection-lists, contract-first, design-system-first, permit-gated, feature-flag, deploy-window]
github: TBD
jira: FFRNT-186
status: ready
priority: High
domain: Platform / Data
---

## 🎯 Epic: Selection Lists

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-17 |
| **Jira** | [FFRNT-186](https://fuzefront.atlassian.net/browse/FFRNT-186) |
| **Domain** | Platform / Data |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `contract-designer` + `product-designer` + `backend-engineer` + `frontend-engineer` + `devops-engineer`) |
| **Target Release** | Next available sprint |
| **Effort Estimate** | L (16 stories · 51 sub-tasks · 288 pts = 288 h) |

---

### 📌 Problem Statement

> FuzeFront has no way for an organization to define its own reference data. Every dropdown in
> every consuming product is hard-coded in that product's source or invented ad hoc, so two apps
> in the same org disagree about what "Region" or "Lead Status" means, and renaming a label
> requires a code change and a deploy. There is also no runtime i18n path for user-authored
> content at all — `packages/i18n` and `packages/i18n-translate` translate **static UI strings at
> build time, stored in git** (`packages/i18n/README.md`: *"Git is the store. There is no
> translation service, database, or runtime spinner"*), which is structurally the wrong mechanism
> for content an org authors at runtime.

### 🎯 Goal

> An org defines named selection lists whose values carry a hidden immutable UUID (what consuming
> apps persist), a stable interop `code`, and localized labels — governed per-list per-action via
> Permit and bounded by per-org, per-user and per-list quotas.

### 👥 Target Personas

- **Org Admin** — owns the org's taxonomies and decides who may change them.
- **List Owner / Editor** — a business user who curates one list's values without needing org-wide edit rights.
- **Translator** — renders an existing vocabulary in another language, and must *not* be able to add or remove values.
- **Consuming product developer** — stores a UUID and renders a localized label, without re-implementing lookups.

### ✅ Features In Scope

- [ ] Frozen OpenAPI contract + `@fuzefront/selection-list-client`, ahead of any implementation.
- [ ] `selection-list-service` microservice — lists, values (immutable UUID + immutable `code` + explicit `sort_order`), archive/purge semantics.
- [ ] Runtime i18n for org-authored content — side translation tables, locale fallback chain, machine-translation autofill reusing `@fuzefront/i18n-translate`.
- [ ] Per-list ReBAC authorization with action granularity (`read`, `add_value`, `update_value`, `remove_value`, `translate`, `update`, `delete`, `manage_access`).
- [ ] Quota enforcement — max lists per org, max lists per user, max values per list × languages — atomic and plan-tier aware.
- [ ] Management + translation-workbench UI and an embeddable `<SelectionListPicker>`, behind `fuzefront.selection-lists.service` (default OFF).

### 🚫 Out of Scope

- **Per-item ACLs** — deliberate; see *Decisions* below.
- **Cross-org list sharing / public list marketplace** — no demand yet; adds a whole trust model.
- **CSV / external taxonomy import** — valuable, but independent of the core governance model.
- **Moving quota storage into the key-value configuration microservice** — this epic only puts quota resolution behind a single interface so that move is a one-implementation swap.

---

## Decisions

Owner-confirmed before planning:

| Decision | Choice |
|---|---|
| Authorization granularity | **Per-list ReBAC + action granularity.** Not per-item ACLs. |
| Default access on create | **Org-wide read, creator owns.** |
| Deleting a value | **Archive by default; purge explicit + audit-logged.** |
| Quota source | **Plan-tier via Permit attributes + per-org DB override**, behind one interface so it can move to the forthcoming key-value configuration-storage microservice without touching call sites. |

### Why per-list, not per-item

The load-bearing decision; recorded so the reasoning survives into implementation.

- **Items are the wrong entity to attach authorization to.** They are the high-cardinality one —
  hundreds of values × 11 locales per list. Per-item Permit resource instances would be tens of
  thousands per org, and every list render becomes a per-item filter instead of one check.
- **A partially-visible selection list is a broken selection list.** The list *is* the unit of
  meaning: a closed vocabulary. If a viewer cannot see value X their picker silently omits it, and
  the UUIDs another user stored become un-interpretable to them. Two people filling the same form
  get different option sets — a data-consistency bug, not access control.
- **The real requirement is action granularity.** "Who can add / edit / remove items or entire
  lists?" is fully answered per-user, per-list, per-action without per-item ACLs.
- **The door stays open cheaply.** `selection_list_items.created_by` is in the schema from day one,
  so "you may only edit values you created" later becomes an ABAC condition on an existing column,
  not a new authorization subsystem.

---

## 🏗️ High-Level Architecture Notes

New standalone service modelled on `services/chat-service/` — the cleanest in-repo template
(`app.ts`, knex `db/migrations` + `knexfile.ts` + `migrate.ts`, `routes/`, `middleware/auth.ts`,
`openapi.yaml` + `.spectral.yaml`, `Dockerfile`, jest `tests/` mirroring `src/`).

```
services/selection-list-service/    # the service
selection-list-client/              # typed client, sibling of billing-client/, portal-client/
packages/selection-lists-ui/        # UI package (only after frames approved)
design/frames/selection-lists/      # product-designer, frames-ONLY PR — HARD GATE
```

### Reuse, do not re-invent

| Need | Reuse |
|---|---|
| JWT → `req.userId` / `req.orgId` | `services/chat-service/src/middleware/auth.ts` |
| PDP check, fail-closed | `services/chat-service/src/agent/permit.ts` |
| Permit resource/role IaC + sync | `backend/src/permit/schema.ts`, `sync-permit-schema.ts` |
| Plan → Permit attributes | `services/billing-service/src/services/permit.service.ts` |
| Rate limiting | `services/chat-service/src/middleware/ratelimit.ts` |
| Locale registry (11 langs, `dir`, `sourceLanguage: en`) | `i18n.languages.json`, `packages/i18n/src/languages.ts` |
| LLM translation, placeholder safety, source hashing | `packages/i18n-translate/src/{translate,llm,placeholders,hash}.ts` |
| Client package shape | `billing-client/package.json` |

### Data model

```sql
selection_lists (
  id              UUID PK DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  key             TEXT NOT NULL,               -- org-unique slug, e.g. 'countries'
  source_locale   TEXT NOT NULL DEFAULT 'en',
  status          TEXT NOT NULL CHECK (status IN ('active','archived')),
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at, updated_at TIMESTAMPTZ,
  UNIQUE (organization_id, key)
)

selection_list_items (
  id          UUID PK DEFAULT gen_random_uuid(),  -- THE hidden value consumers persist
  list_id     UUID NOT NULL REFERENCES selection_lists(id) ON DELETE RESTRICT,
  code        TEXT NOT NULL,                      -- interop key; IMMUTABLE after create
  sort_order  INTEGER NOT NULL,                   -- gapped (100,200,300); explicit order
  status      TEXT NOT NULL CHECK (status IN ('active','archived')),
  created_by  UUID NOT NULL,
  created_at, updated_at TIMESTAMPTZ,
  UNIQUE (list_id, code)
)

selection_list_translations      (list_id, locale, name,  description,
                                  source_hash, is_machine BOOL, PK(list_id, locale))
selection_list_item_translations (item_id, locale, label, description,
                                  source_hash, is_machine BOOL, PK(item_id, locale))

selection_list_access (list_id, user_id, role, granted_by, granted_at, PK(list_id,user_id))
selection_list_audit  (id, list_id, item_id, actor_id, action, before JSONB, after JSONB, at)
selection_list_org_quota (organization_id PK, max_lists, max_lists_per_user,
                          max_items_per_list, max_locales, updated_by, updated_at)
```

Things that are easy to get wrong and must not be:

- **`ON DELETE RESTRICT`** items→list. A list cannot be deleted out from under its items.
- **Side translation tables, not a JSONB locale map.** The quota is language-multiplied
  ("max values per list × languages"), so translations must be countable rows. It also makes
  "which lists lack Spanish" a query, and matches `i18n-translate`'s row-per-string,
  hash-the-source shape for autofill.
- **`locale` validated against `i18n.languages.json`** (11 codes) at write time, not free text.
- **`source_hash` + `is_machine`** invalidate a machine translation when the source label changes,
  and let the UI mark unreviewed strings.
- **`selection_list_access` is a read-model mirror, never the authority.** Permit is the decision
  point. The mirror exists only so `GET /selection-lists` can paginate "lists I can see" in SQL
  instead of N PDP calls. Every mutation still calls the PDP, fail-closed. *A mirror that quietly
  becomes the authority is a classic security regression* — FFRNT-242 asserts it cannot.

### Authorization

`SelectionList` Permit resource, relation `organization: 'Organization'`, following the ReBAC
pattern already proven by `Organization.roles['org-admin']`.

| role | read | add_value | update_value | remove_value | translate | update | delete | manage_access |
|---|---|---|---|---|---|---|---|---|
| `list-owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list-editor` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `list-contributor` | ✓ | ✓ | ✓ | | ✓ | | | |
| `list-translator` | ✓ | | | | ✓ | | | |
| `list-viewer` | ✓ | | | | | | | |

Org `admin` derives `list-owner` on every list in the tenant, preserving the support path. On
create: creator → `list-owner`, org members → `list-viewer`. `list-translator` is deliberately
separate: a translator renders an existing vocabulary and must not change what it contains.

### Quotas

Ceilings: `max_lists` per org, `max_lists_per_user`, `max_items_per_list`, `max_locales`. **The
stricter of org and per-user binds.** Resolution: `selection_list_org_quota` row → Permit tenant
attribute from plan tier → platform ceiling in config, behind one `QuotaResolver` interface.

**Enforcement must be atomic** — `pg_advisory_xact_lock` on the org id inside the insert
transaction, because count-then-insert races. `403 { code: 'QUOTA_EXCEEDED', scope, limit, current }`
names *which* ceiling was hit, and `GET /v1/selection-lists/quota` lets the UI warn before the wall.

### i18n and resolution

Read resolves `?locale=` → `Accept-Language` → list `source_locale` → `en`. **Never return a null
label.** Each field reports the locale it actually resolved from, so the UI can badge fallbacks.
`POST .../translations/{locale}/autofill` machine-translates from the source locale, writes
`is_machine: true` + `source_hash`, and requires the `translate` action.

### API surface

```
GET    /v1/selection-lists                     POST   /v1/selection-lists
GET    /v1/selection-lists/{listId}            PATCH  /v1/selection-lists/{listId}
POST   /v1/selection-lists/{listId}/archive    DELETE /v1/selection-lists/{listId}?purge=true
GET    /v1/selection-lists/{listId}/items      POST   /v1/selection-lists/{listId}/items
PATCH  /v1/selection-lists/{listId}/items/{itemId}
POST   /v1/selection-lists/{listId}/items/{itemId}/archive
DELETE /v1/selection-lists/{listId}/items/{itemId}?purge=true
PUT    /v1/selection-lists/{listId}/items/reorder
PUT    /v1/selection-lists/{listId}/translations/{locale}
PUT    /v1/selection-lists/{listId}/items/{itemId}/translations/{locale}
POST   /v1/selection-lists/{listId}/translations/{locale}/autofill
GET    /v1/selection-lists/{listId}/access     PUT/DELETE .../access/{userId}
GET    /v1/selection-lists/quota
POST   /v1/resolve                             # bulk UUID → localized label
```

`POST /v1/resolve` is the hot path — consumers store UUIDs and render many at once. It must
resolve archived IDs (historical records still render) and be cacheable. Without it, every
consumer re-implements N+1 lookups.

---

### 📊 Success Metrics

| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Active orgs with ≥ 1 selection list | 0 | 60% within 2 sprints of GA |
| Hard-coded dropdown definitions in consuming products | [Establish baseline in Sprint 1] | −50% |
| p95 `POST /v1/resolve` latency @ 100 UUIDs | — | < 100 ms |
| Label changes requiring a code deploy | 100% | 0% |

### 📋 Child Stories

Authored per the FuzePlan `ticket-creator` skills and validated against the `ticket-enforcer`
rubric. Sub-task points are strictly `{2, 4, 8}`; **1 point = 1 hour**; story points are their sum.

| # | Jira | Story | Sub-tasks | Pts |
|---|---|---|---|---|
| S1 | FFRNT-187 | Consuming teams build against a frozen SelectionList API contract | FFRNT-203…206 | 16 |
| S2 | FFRNT-188 | Owner approves the SelectionList UX before any UI is written | FFRNT-207…209 | 18 |
| S3 | FFRNT-189 | The service persists lists, values, translations and grants | FFRNT-210…213 | 24 |
| S4 | FFRNT-190 | An org member creates a list and manages its values | FFRNT-214…217 | 24 |
| S5 | FFRNT-191 | A translator renders a list in another language | FFRNT-218…221 | 24 |
| S6 | FFRNT-192 | The platform stops an org exceeding its list and value ceilings | FFRNT-222…224 | 20 |
| S7 | FFRNT-193 | A list owner controls who may read, edit, translate and delete it | FFRNT-225…228 | 32 |
| S8 | FFRNT-194 | A consuming app resolves many stored UUIDs in one call | FFRNT-229…230 | 12 |
| S9 | FFRNT-195 | An org admin manages selection lists from the shell | FFRNT-231…234 | 28 |
| S10 | FFRNT-196 | A translator works through a list's missing translations | FFRNT-235…237 | 16 |
| S11 | FFRNT-197 | A product embeds a selection list picker without re-implementing it | FFRNT-238…240 | 12 |
| S12 | FFRNT-198 | Verification is independent of the implementers | FFRNT-241…243 | 20 |
| S13 | FFRNT-199 | The built UI is proven against the approved frames | FFRNT-244…245 | 16 |
| S14 | FFRNT-200 | The service is deployable on FuzeInfra | FFRNT-246…249 | 14 |
| S15 | FFRNT-201 | Selection lists ship dark behind a default-OFF feature flag | FFRNT-250…251 | 6 |
| S16 | FFRNT-202 | A consuming team integrates without reading the source | FFRNT-252…253 | 6 |

**Sequencing.** S1 and S2 are the sequential gates and run first, in parallel with each other.
S3–S8 fan out behind S1. S9–S11 are blocked by S2's per-flow approval (`gate-frames-first`). S12
runs against S1's spec, independent of the implementers. S13 writes ALL-RED specs the moment S2
merges, before S9 exists.

**Sizing (SIZING.md).** Longest single-developer chain S1→S3→S4→S7→S9→S13 ≈ 140 h ≈ 17.5 work days
≈ 1.75 sprints — inside the Epic ceiling of N×D = 6 sprints / 60 work days. No story exceeds one
sprint. No decomposition required.

**Deploy window.** `master` is deploy-on-push with `required_signatures` — the epic is labelled
`deploy-window` and must never be bot-merged.

### 🔗 Dependencies

- **Blocked By:** — (no hard external dependency; S1 and S2 are internal sequential gates)
- **Related:** FF-EPIC-06 (feature-flags platform — supplies `fuzefront.selection-lists.service`);
  the forthcoming key-value configuration-storage microservice, which will later own quota limits.

### 📎 References

- Jira epic: [FFRNT-186](https://fuzefront.atlassian.net/browse/FFRNT-186)
- Design-first gate: `docs/planning/design-first-ui-pipeline.md`
- Ticket standard: FuzePlan `ticket-creator` skills, validated against `ticket-enforcer`
- Service precedent: `services/chat-service/` · Client precedent: `billing-client/`
