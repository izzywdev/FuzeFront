# selection-list-service: authorization review (2026-10-04)

**Type:** independent, read-only security and authz review. No product code was changed.
**Baseline:** `origin/master` @ `c446e4e3c3daa80979f06e4125c7f48ad66a6751`.
**Scope:** `services/selection-list-service/src/**` (auth, authz, authz.flags, flagGate, flags, every router, app.ts mount order, events), `services/selection-list-service/openapi.yaml` v2.0.0, the Permit schema (`backend/src/permit/schema.ts`), the Security API it calls (`backend/security/src/routes/authz.ts`), Helm (`ingress.yaml`, `selection-list-service-deployment.yaml`, `values*.yaml`), and the tests (`services/selection-list-service/tests/`, `tests/selection-list-service/`).
**History reviewed:** #1217 (closed, **not merged**; its content landed in squash `02753b6f`, PR #1225 "Consolidates #1211, #1212, #1213, #1217, #1220 and #1221") and #1234 (`433b20fd`).

Line numbers refer to files at the baseline SHA.

---

## Verdict

**Safe to enable behind the flag: NO.**

These findings block enabling. Each one has to be fixed, not just tracked:

| Blocks | Finding | Why it blocks |
|---|---|---|
| yes | **C-1** Security API grant/revoke open to every human session | Every list-level guarantee (manage_access, owner-only purge, last-owner 409) can be bypassed with one direct call to `/api/v1/security/authz/grants`. This is live in prod already: `securityService.enabled: true` in `values-prod.yaml:111`. |
| yes | **H-1** authz flag is OFF in prod and Helm never sets it | When the service is enabled, nothing is authorized. Any org member can purge any list in the org and grant themselves `list-owner`. Those grants are written to the real Security API, so they **outlive** any later decision to turn authz on. |
| yes | **H-2** `SelectionList` is not in the Permit schema | Turning authz on is not possible today: every check denies, and every create fails on the `list-owner` grant. |
| yes | **H-3** tenant-level checks reuse instance actions | When H-2 is fixed by declaring the resource, the matrix either loses per-list ReBAC or breaks list/create/quota/resolve. This needs a contract decision before the schema is written. |
| yes | **H-4** one request crashes the pod | Any authenticated member of an enabled org can kill the only replica with one request. |
| no (fix soon) | M-1 … M-4, L-*, I-* | Real defects, but none of them on its own makes enabling unsafe once the items above are closed. |

Even with every security item fixed, **the service cannot serve a real user in prod as wired** (I-1). No FuzeFront issuer mints a token with an org claim, the UI sends no `Authorization` header, and the image probably cannot load the flag client. Today it fails closed, which is the safe direction. The upside is that nobody can enable it by accident before C-1 and H-1 are fixed.

---

## Findings (ranked)

| ID | Sev | Where (file:line) | Impact | Evidence | Recommended fix / owner |
|---|---|---|---|---|---|
| **C-1** | **Critical** | `backend/security/src/routes/authz.ts:119-131` (`requireAuthzAdmin` gates **machine** callers only), `:244-264` (POST `/authz/grants`), `:266-280` (DELETE); exposed publicly at `deploy/helm/fuzefront/templates/ingress.yaml:23` and `:139` (`/api/v1/security`) | Any logged-in user can `POST /api/v1/security/authz/grants {subject:<self>, tenant:<any org>, role:"list-owner", resource:{type:"SelectionList",key:<id>}}`. They can also grant **tenant-wide `admin` on any tenant**, and `DELETE` any grant, including other users' list-owner grants. For selection lists, this makes manage_access, owner-only purge and the last-owner 409 meaningless. Platform-wide, it is a full tenant-admin escalation. | The file header says it outright: "Human callers are unaffected by this gate (unchanged pre-existing behavior)". `requireAuthzAdmin` returns `true` for `kind === 'human'`. `caller()` only proves *who* the caller is. Nothing checks that the caller may grant the given role on the given tenant/resource. The only grant tests are `tests/authz.machine-caller.test.ts:177-230`, which are machine-only. The service **depends** on this hole: `grantListOwner()` (`services/selection-list-service/src/middleware/authz.ts:434-450`) and `access.ts:270-293` grant with the *end user's* token. | **backend-engineer (backend/security), P0, independent of selection lists.** Human grant/revoke has to be authorized. Require `manage` on `Organization` for tenant-wide roles, and `manage_access` on the instance for resource-scoped roles, with a `check()` against the caller before `provider.grant/revoke`. Selection-list-service then needs its own identity to grant the creator `list-owner` on create, because the creator has no `manage_access` yet. Use a workload token (`/tokens/workload`) whose scope is limited to the `SelectionList` type, not the user's token. Not patched here: it is a cross-service design change, not a small diff. |
| **H-1** | **High** | `src/middleware/authz.ts:296-305` (flag OFF → `next()` with a warning), `:376-382`; `src/middleware/authz.flags.ts:536-546` (env-only, default `false`); `deploy/helm/fuzefront/templates/selection-list-service-deployment.yaml:33-63` (no `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED`); `values.yaml`/`values-prod.yaml` (no key); `docs/runbooks/selection-lists-flag-rollout.md` preconditions (never mention it) | Production default = **no authorization**. Once `fuzefront.selection-lists.service` is ON for an org, every member of that org can call every route: purge any list (`DELETE ?purge=true`), read everything, and `PUT /:listId/access/<self> {role:"list-owner"}` on any list. The `PUT` path still writes a **real** Security API grant (`access.ts:285-293` runs whatever the flag says). So the escalation persists after authz is switched on later. The runbook says "Authorization is the Security API (`requireAuthzCheck`), never the flag", which is false while this flag is unset. | The only place the variable is ever `true` is CI (`.github/workflows/ci.yml:713`) and unit tests. `grep -rn SELECTION_LIST_AUTHZ_ENABLED deploy/` returns nothing. | **backend-engineer** (code) + **devops-engineer** (Helm env). Patch P-1 below: never pass through in `NODE_ENV=production`, and set the env explicitly in the chart. Turning authz on right now fails closed because of H-2. That is the correct state for a released service until H-2 and H-3 land. |
| **H-2** | **High** (blocker; fails closed) | `backend/src/permit/schema.ts` (resources: Organization, App, UserManagement, Docs, ServiceEndpoint, Chat, DevPortalCatalog, DevPortalPlayground, with **no `SelectionList`**); also absent from `backend/src/permit/products/*` and `permit-schema-job.yaml` | With authz ON, every `check` on `SelectionList` denies, so the service is unusable. `grant(list-owner on SelectionList:<id>)` targets a resource role that does not exist, so every create returns 500. `grantListOwner` runs whatever the flag says (`lists.ts:476`), so creates may already fail with authz OFF *(inferred: depends on Permit rejecting an undeclared resource role; not exercised live)*. The CI suite is green only because the stand-in `tests/selection-list-service/helpers/fake-security-api.mjs` builds the role matrix in-process. | `grep -n -i selection backend/src/permit/*.ts backend/src/permit/products/*.ts deploy/helm/fuzefront/templates/permit-schema-job.yaml` → no matches (exit 1). | **backend-engineer** (schema) after **contract-designer** settles H-3. Declare `SelectionList` with the five instance roles from `openapi.yaml:121-127`. Add an `organization` relation plus `org-admin` derivation if "org admin derives list-owner" is intended: the acceptance suite asserts it (`security/authz.test.ts` header), but only the fake implements it. |
| **H-3** | **High** (design) | `lists.ts:193` (`GET /` → tenant-level `read`), `lists.ts:382` (`POST /` → tenant-level `add_value`), `quota.ts:30`, `resolve.ts:52`; spec `x-permit-action` at `openapi.yaml:190,276,1070,1125` | Permit evaluates RBAC tenant roles *and* ReBAC instance roles. A tenant role that grants `SelectionList:read` or `add_value` applies to **every** instance in the tenant *(inferred from Permit's documented RBAC+ReBAC model; confirm on the PDP)*. Two outcomes: (a) give members tenant-level `read`/`add_value` and per-list `list-viewer`/`list-contributor` distinctions disappear, so anyone can add items to any list; or (b) don't, and `GET /`, `POST /`, `/quota` and `/resolve` deny for everyone. The fake hides this with a rule no real policy contains: `if (!resource.key) return ['read','add_value'].includes(action)` (`fake-security-api.mjs`, `decide()`). | Code + spec read; fake read. | **contract-designer:** give tenant-level operations their own actions (e.g. `create` for `POST /`, `list` for `GET /`, `/quota`, `/resolve`), granted to tenant roles. Keep `read`/`add_value` instance-only. This is a MAJOR spec bump. Then make the fake model exactly the declared schema, so CI tests the real policy shape. |
| **H-4** | **High** (authenticated DoS) | Express `4.19.2` (`package.json`), no `unhandledRejection` handler (`src/index.ts`), DB awaits outside any try/catch: `resolve.ts:144`, `translations.ts` (all 7 handlers, e.g. `:97,:180,:252,:284,:345,:420,:468`), `lists.ts:546`, `items.ts:174,329,460,589,709,789` (`getListSourceLocale` before `try`) | In Express 4, a rejected async handler is not forwarded to `next()`, and on Node ≥15 an unhandled rejection terminates the process. One request makes Postgres error (e.g. `POST /api/v1/resolve {"ids":["front_sli_\u0000"]}`: a NUL byte in a `text` parameter gives SQLSTATE 22021) and the pod dies. `replicas: 1` (`values.yaml`). It can be repeated at will by any member of an enabled org. With authz OFF (H-1), every in-org route above is a vector. | **Verified:** a minimal Express 4.19.2 app whose async handler throws exits the Node process with code 1 (scratch reproduction, Node 22). **Inferred:** Postgres rejects `\u0000` in text parameters (well-known; not run against a DB here). | **backend-engineer.** Patch P-2: a process backstop, a terminal error handler, and wrapping every async route (or moving to Express 5, which forwards rejections). |
| **M-1** | Medium | `items.ts:694` (`DELETE /:listId/items/:itemId?purge=true` needs `remove_value`); spec `openapi.yaml:50-52` ("purge … permitted only to a `list-owner`") vs `:648` (`x-permit-action: remove_value`) | `list-editor` can **irreversibly** purge items, breaking every consumer row that stores the id. This contradicts the spec's own global rule. List purge is correct (`lists.ts:785` → `delete`, owner-only per the matrix). | The spec contradicts itself; the code follows the operation-level action. | **contract-designer** decides. If owner-only is intended, patch P-4 adds a `delete` check when `purge=true`. |
| **M-2** | Medium | Last-owner guard `access.ts:251-264`, `:372-385` (mirror-only count); `access.ts:269-293` (revoke-then-grant); `events/user-deleted.handler.ts` (never revokes); `lists.ts:828` (purge drops mirror rows without revoking) | The 409 guarantee holds only while the mirror equals Permit. They can diverge in three ways. (1) A PUT that changes an owner's role revokes `list-owner` and then fails on the grant: Permit has no grant, but the mirror rolls back to "owner". The count is now inflated, so the real last owner can be demoted next. (2) Deleted users stay counted as owners. (3) C-1 lets anyone revoke directly. Any of these can leave a list with **zero effective owners**. | Code read. Serialization is correct (`forUpdate` at `:244`/`:361`); the gap is the source of truth, not the race. | **backend-engineer:** run the guard against the authority (`listGrants`/`check` for `list-owner` on the instance) or make the PUT compensate (re-grant the old role on failure). Have `user-deleted` revoke grants and mirror rows, with an org-admin fallback via the H-2 derivation. |
| **M-3** | Medium (data retention) | `events/org-deleted.handler.ts:27,40,53,56,62-63` | The handler queries `selection_lists.org_id` and `is_active`, and `selection_list_org_quota.org_id`. **None of these columns exist**: the schema has `organization_id` and `status` (`migrations/20260810_000001_core_tables.ts:21-24`, `…000003…:42`). Every `identity.org.deleted` event throws and goes to the DLQ, so a deleted org's lists, items and grants are kept indefinitely. | Column names diffed against the migrations. No unit test covers this handler. | **backend-engineer.** Patch P-3. |
| **M-4** | Medium | `services/quota.service.ts:150-182` (counts only `status:'active'`); `user_lists`/`list_locales` reported (`:239-255`) but never enforced anywhere in `src/`; no rate limiting in-service or at ingress | Repeating archive + create grows `selection_lists` and `selection_list_items` without bound, past `org_lists`/`list_items`. The spec says create is "Subject to the `org_lists` and `user_lists` quotas" (`openapi.yaml:273-274`), but `user_lists` is never checked. | `grep -rn "maxListsPerUser\|maxLocales" src` → only the usage reporter. | **backend-engineer:** enforce `user_lists`/`list_locales`, and count archived rows toward a hard storage ceiling. **devops-engineer:** ingress rate limit on `/api/v1/resolve` and the write routes. |
| **L-1** | Low | `lists.ts:612,661,692` | `PATCH {status:"archived"\|"active"}` needs only `update`, so `list-editor` can archive or unarchive, even though `POST /archive` and `DELETE` need `delete`. Not destructive, and the spec allows it (`SelectionListUpdate.status`). | Code + spec. | contract-designer: align or document. |
| **L-2** | Low | `middleware/auth.ts:78` | Accepts **any** HS256 JWT signed with the shared `JWT_SECRET`, with no `iss`/`aud`/`kind` check. When `DELEGATION_SIGNING_KEY` is unset, delegation/workload tokens (`backend/security/src/routes/security.ts:68-71,621,685`) verify here as a "user". None of them carry `orgId`/`organization_id`/`organizationId` today, so org routes return 401. No exploit found; this is a hardening gap. | Code read. | Pin `algorithms:['HS256']` and reject `kind` ∈ {`fuze-workload`,`fuze-delegation`}, or verify `aud`. |
| **L-3** | Low | `translations.ts:175,340,457` | Bodies for translation PUT and autofill don't reject unknown properties (contract: `additionalProperties:false`). Only named fields are read, so no id can bind (no BOPLA); this is a conformance gap only. | Code read. | Add the same `allowedProps` check `lists.ts:393` uses. |
| **L-4** | Low | `resolve.ts:8-11,166-167` | `resolve` is org-scoped but has no per-list `read`. An org member resolves labels of lists they have no grant on, if they hold the ids. This is a documented hot-path trade-off, but `openapi.yaml:131` says "every route re-checks". | Code + spec. | Accept in the spec explicitly, or bulk-check the distinct `list_id`s. |
| **L-5** | Low | `lists.ts:809-831` | Purge deletes mirror rows but never revokes the Security API grants, which leaves orphan `SelectionList:<id>` role assignments. Harmless because ids are never reused; it is PDP hygiene. | Code read. | Revoke the instance's grants (or delete the resource instance) after commit. |
| **L-6** | Low | Ruleset "Protect Master" required contexts | `Selection list service (integration/acceptance)` is **not a required check**, so its "real gate" status depends on `notify` only. It ran green on the PR heads of #1225 (`e89d1b00`) and #1234 (`5a2dc687`), and was `skipped` on merge commit `433b20fd`. | `gh api repos/izzywdev/FuzeFront/rulesets/17974934` → contexts: gate-lint, gate-test, gate-build, gate-sast, gate-secret-scan, gate-dependency-scan, Security Scan, In-repo packages…, gate-frontend-build, gate-ds-conformance, gate-sealed-keys. | platform-governance/devops: add it to the ruleset once stable. |
| **I-1** | Info (fails closed) | `backend/security/src/routes/auth.ts:189-192,741` and `providers/authentik/AuthentikIdentityProvider.ts:354` (session claims `{userId, sessionId, tid}`); `packages/selection-lists-ui/src/api.ts:25-26` (no `Authorization`); `services/selection-list-service/package.json` (no `@fuzefront/feature-flags` dep; Dockerfile prod stage doesn't copy it); `selection-list-service-mcp-gateway.yaml:75` (upstream `selection-list-service` vs Service `fuzefront-selection-list-service`) | In prod: no token carries an org claim, so every route returns 401. The UI never authenticates. The release-flag client probably can't load (`require` fails → `null` → flag OFF forever → 404) *(inferred; the check is `docker run <image> node -e "require('@fuzefront/feature-flags')"`)*. The MCP gateway points at a non-existent host. | Code read. | Product/backend/devops: decide the org-scoped token (Authentik `organization_id` vs a FuzeFront org-session token) before enablement. Not a security hole. |
| **I-2** | Info | `.claude/skills/selection-lists/SKILL.md:199` | Says the access routes check `'admin'`; the code uses `manage_access`. Stale doc. | grep. | Fix in place. |
| **I-3** | Info | `lists.ts:40-42` vs `translations.ts:41-43`, `resolve.ts:29-31` | Two different `SUPPORTED_LOCALES` sets (`it,nl,pl` vs `hi,ar,he`). | Code read. | Use one source (`packages/i18n`). |

---

## The specific checks requested

**(a) authN + org scoping + per-role check + fail-closed.** Verified for every route.
- AuthN: `app.ts:36` mounts `authMiddleware` on `/v1` before every router, including `/v1/resolve` (`app.ts:52`), so the #1234 change holds. A missing org claim gives 401 (`authz.ts:290-292`, plus a per-handler check).
- Org scoping: every list lookup is `WHERE id = ? AND organization_id = ?`. Items are scoped by `list_id` after the list check, and reorder/autofill `item_ids` are restricted to the list.
- Route → action matches the spec on all 23 operations: lists `read/add_value/read/update/delete/delete`; items `read/add_value/update_value/update_value/remove_value/remove_value`; translations `read/translate/translate/read/translate/translate/translate`; access `manage_access` ×3; quota `read`; resolve `read`.
- Fail-closed: a thrown Security API call gives 403 (`authz.ts:358-367`). The Security API returns `{allow:false}` on provider error (`backend/security/src/routes/authz.ts:150-177`). The client times out at 3000 ms and denies (`packages/auth/src/authzTypes.ts:119-120`). `filterReadable` throws and returns 500, never "all rows" (`authz.ts:393-410`).
- **But** all of this is inert while H-1 holds, and is bypassable through C-1.

**(b) `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED`.** The production default is **unset, so OFF, so pass-through with a warning**. No `values*.yaml` and no template sets it. Shipping it OFF *is* a real hole as soon as `selectionListService.enabled` and the release flag are ON (H-1). Making it worse, `PUT /access` writes real grants with the flag OFF, so the hole leaves persistent residue.

**(c) BOLA/BOPLA.**
- Ids are minted server-side only: `lists.ts:433`, `items.ts:348` (`mintId`).
- Create bodies reject unknown properties: `lists.ts:393-401`, `items.ts:303-311`, `access.ts:197-204`.
- Cross-org ids return 404 from the authz pre-check (`authz.ts:320-332`, before any decision is asked) and from the org-scoped handler queries. A denied read returns 404 (`authz.ts:348-352`). Denied *writes* on an **in-org** list return 403, which is a within-org existence signal and allowed by the spec.
- `resolve` cannot return other orgs' labels (`resolve.ts:166-167`); foreign ids go to `missing`.
- Gaps: L-3 (translation bodies) and L-4 (no per-list read on resolve).

**(d) `grantListOwner()` on create.** **Called**: `lists.ts:476`, inside the create transaction, after the list and translation inserts. The Security API grant runs first and the mirror row second, through the same `trx`, so a failed grant rolls the list back. The earlier gap is closed. Caveats: it uses the caller's token (C-1 dependency), and the grant targets a role Permit doesn't define (H-2).

**(e) Last-owner 409.** PUT demotion (`access.ts:251-264`) and DELETE (`:372-385`) both refuse when the mirror count is ≤ 1. They are serialized by `SELECT … FOR UPDATE` on the list's access rows (`:244`, `:361`), so they are race-free. The guarantee is only as strong as mirror == Permit, and M-2 lists three ways that breaks. C-1 bypasses it entirely.

**(f) Purge/delete requires list-owner.** List purge and archive need `delete` (`lists.ts:785`, `:879`), which is owner-only in the matrix. That holds only with authz ON (H-1) and a real schema (H-2). Item purge needs only `remove_value` (M-1).

**(g) Flag gate.** `requireSelectionListsFlag` is mounted at `app.ts:42`, after auth and before every `/v1/selection-lists` router (quota, lists, items, translations, access). `/v1/resolve` has its own check (`resolve.ts:54-60`).
- Express path matching is the same for the gate and the routers (case-insensitive prefix), so there is no path-shape bypass.
- Evaluation errors return 404 (`flagGate.ts:209-218`).
- `FLAGS_FORCE_ON` is ignored under `NODE_ENV=production` (`flags.ts:162-163`), and Helm hard-codes `NODE_ENV=production` (`deployment.yaml:34-35`).
- The gate is not authz: it passes everyone in an enabled org. The runbook says so too, but that is only true once H-1 is fixed.
- Minor: on `/v1/resolve` authz runs *before* the flag check, so a denied caller gets 403 rather than 404 while the service is dark. Low value, no data exposure.

**(h) Rate/quota/pagination.** Page caps are 200 on lists (`lists.ts:38,207`), items (`items.ts:35,183`) and access (`access.ts:44,117`), which equals the `bulkCheck` ceiling (`backend/security/src/routes/authz.ts:192`). Resolve is capped at 500 ids (`resolve.ts:33,74`). Translation reads are bounded by locales. **No rate limiting** anywhere, and quota gaps per M-4.

**(i) The three #1217 test edits** (as landed in `02753b6f`):

| # | File | Edit | Direction |
|---|---|---|---|
| 1 | `tests/selection-list-service/security/mirror-not-authority.test.ts` (+ `helpers/db.ts`) | `skipIfNoDb` decided `test.todo` vs `test` at *definition* time, when `dbAvailable` was always `false`, so every test was a silent todo. Now it always registers a real test, which **throws** if the DB is missing. Column `organization_id` → `org_id` matches `migrations/…000005…:18` (the access table has no `organization_id`). | **Strengthened.** Changed from vacuous green to real assertions; a missing DB is now a failure, not a skip. |
| 2 | `tests/selection-list-service/contract/quota.test.ts` | Adds `afterEach` that purges the fill lists in the `org_lists` block, so later item-quota/concurrency tests aren't starved at the 3-list ceiling. No assertion removed or loosened; `403 QUOTA_EXCEEDED` is still asserted. | **Neutral** (test isolation only). |
| 3 | `tests/selection-list-service/contract/items.test.ts` | Removes "purging a list with live items → **409 CONFLICT**". Replaces it with "purge → **204**, then `GET` → 404, then `resolve` puts the item in `missing`". | **Changed direction, spec-aligned.** The 409 was a safety guard the frozen spec never declared: `openapi.yaml:376-380` says purge "cascades to every item, translation and access grant", with responses 200/204/401/403/404. The new test asserts *more*, but a destructive-op guard was intentionally dropped. Acceptable because the spec wins. No test asserts that a non-owner cannot **purge**: `security/authz.test.ts:128-131` `doDelete` archives only. In this code purge and archive share `delete`, so it is covered by implication, not explicitly. |

The rest of the same squash: `services/selection-list-service/tests/access.routes.test.ts` was rewritten (763 lines). Every removed guarantee has a successor test:
- last-owner 409 → `:429`, `:518` (code renamed `LAST_OWNER` → `CONFLICT` per spec)
- write ordering → `:454`, `:558`
- instance scoping → `:359`, `:531`
- fail-closed 403 → `:570`, `:586`
- invalid role → `:299` (code renamed `INVALID_ROLE` → `VALIDATION_ERROR` per spec)

`authz.middleware.test.ts` changes the default `mockDb.first` from `null` to an existing row, which the new pre-check requires. It adds explicit tests for the 404-not-oracle and not-in-org cases. No weakening found.

---

## Proposed patches (not applied; for human approval)

### P-1: never pass authz through in production (H-1)

```diff
--- a/services/selection-list-service/src/middleware/authz.ts
+++ b/services/selection-list-service/src/middleware/authz.ts
@@
+/**
+ * Is authorization ENFORCED for this request? Always in production: the
+ * pass-through / kill-switch path exists only for dark deploys outside prod,
+ * and an unset env var must never silently disable authz on a released
+ * service (docs/security/selection-lists-authz-review-2026-10.md, H-1).
+ */
+async function authzEnforced(ctx: FlagContext): Promise<boolean> {
+  if (process.env.NODE_ENV === 'production') return true;
+  return getBooleanFlag(FLAGS.AUTHZ_ENABLED, false, ctx);
+}
+
 export function requireAuthzCheck(resource: string, action: string) {
@@
     const flagCtx: FlagContext = { userId, orgId, appId: req.appId };
-    const authzEnabled = await getBooleanFlag(FLAGS.AUTHZ_ENABLED, false, flagCtx);
+    const authzEnabled = await authzEnforced(flagCtx);
@@
 export async function isAuthzEnabled(req: Request): Promise<boolean> {
-  return getBooleanFlag(FLAGS.AUTHZ_ENABLED, false, {
+  return authzEnforced({
     userId: req.userId,
     orgId: req.orgId,
     appId: req.appId,
   });
 }
```

```diff
--- a/deploy/helm/fuzefront/templates/selection-list-service-deployment.yaml
+++ b/deploy/helm/fuzefront/templates/selection-list-service-deployment.yaml
@@
             - name: NODE_ENV
               value: "production"
+            # Authz is enforced in production regardless (src/middleware/authz.ts
+            # authzEnforced); declared explicitly so the rendered manifest says so.
+            - name: FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED
+              value: "true"
```

Consequence: with H-2 open, every request in prod fails closed with 403. That is the correct state for a service that has no policy yet.

### P-2: one bad request must not kill the process (H-4)

```diff
--- a/services/selection-list-service/src/index.ts
+++ b/services/selection-list-service/src/index.ts
@@
+// Express 4 does not forward async-handler rejections; without this backstop a
+// single DB error (e.g. a NUL byte in a text parameter) terminates the process.
+process.on('unhandledRejection', (err) => {
+  logger.error({ err }, 'unhandled rejection (route missing try/catch) — process kept alive');
+});
```

```diff
--- a/services/selection-list-service/src/app.ts
+++ b/services/selection-list-service/src/app.ts
@@
   app.use('/v1', resolveRouter);
 
+  // Terminal error handler: anything forwarded via next(err) is a 500, never a
+  // stack trace and never a hung socket.
+  // eslint-disable-next-line @typescript-eslint/no-unused-vars
+  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
+    getLog(req).error({ err }, 'unhandled route error — 500');
+    if (!res.headersSent) res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
+  });
+
   return app;
```

Then wrap every async handler so rejections reach that handler: `const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);`. Apply it to the routes listed in H-4. Upgrading to Express 5 does the same thing natively. The backstop alone prevents the crash, but the request still hangs until timeout, so the wrap is required as well.

### P-3: org-deleted handler uses the real column names (M-3)

```diff
--- a/services/selection-list-service/src/events/org-deleted.handler.ts
+++ b/services/selection-list-service/src/events/org-deleted.handler.ts
@@
-    () => db('selection_lists').where({ org_id: organizationId }).count('id as n').first(),
+    () => db('selection_lists').where({ organization_id: organizationId }).count('id as n').first(),
@@
-      await trx('selection_list_access').where({ org_id: organizationId }).delete();
-      const listIds = await trx('selection_lists').where({ org_id: organizationId }).pluck('id');
+      const listIds = await trx('selection_lists').where({ organization_id: organizationId }).pluck('id');
       if (listIds.length > 0) {
+        // by list_id, not org_id: access.org_id is nullable (migration 000005) and
+        // a NULL row would block the list delete (FK ON DELETE RESTRICT).
+        await trx('selection_list_access').whereIn('list_id', listIds).delete();
         await trx('selection_list_audit').whereIn('list_id', listIds).delete();
@@
-        await trx('selection_lists').where({ org_id: organizationId }).delete();
+        await trx('selection_lists').where({ organization_id: organizationId }).delete();
       }
-      await trx('selection_list_org_quota').where({ org_id: organizationId }).delete();
+      await trx('selection_list_org_quota').where({ organization_id: organizationId }).delete();
@@
-      .where({ org_id: organizationId, is_active: true })
-      .update({ is_active: false, updated_at: new Date() });
+      .where({ organization_id: organizationId, status: 'active' })
+      .update({ status: 'archived', updated_at: new Date() });
```

This needs a unit test against a migrated DB. Mocked-knex tests cannot catch a wrong column name, which is how this shipped.

### P-4: item purge requires `delete` (M-1; only if contract-designer confirms owner-only)

```diff
--- a/services/selection-list-service/src/routes/items.ts
+++ b/services/selection-list-service/src/routes/items.ts
@@
-router.delete('/:listId/items/:itemId', requireAuthzCheck('SelectionList', 'remove_value'), async (req: Request, res: Response): Promise<void> => {
+// Purge is irreversible and breaks consumer references: owner-only (openapi
+// §"Archive is the default; purge is explicit"). Archive stays remove_value.
+const requirePurgeAuthz = requireAuthzCheck('SelectionList', 'delete');
+function requireDeleteIfPurge(req: Request, res: Response, next: NextFunction): void {
+  if (req.query.purge === 'true') { void requirePurgeAuthz(req, res, next); return; }
+  next();
+}
+
+router.delete('/:listId/items/:itemId', requireAuthzCheck('SelectionList', 'remove_value'), requireDeleteIfPurge, async (req: Request, res: Response): Promise<void> => {
```

This must go together with a spec amendment (`x-permit-action` on `deleteSelectionListItem`) and a version bump. The spec is frozen, so the code must not move first.

---

## What I verified, inferred, and did not do

**Verified (artifact read or command run):** every file and line cited above, at `c446e4e3`. The #1217 PR state was checked via API (`closed`, `merged_at: null`) and its content via the `02753b6f` diff. The three test diffs and the access/authz unit-test diffs were read. CI conclusions on PR heads `e89d1b00` and `5a2dc687` (unit and integration `success`) and on merge `433b20fd` (`skipped`) came from the check-runs API, and the ruleset contexts from the rulesets API. The Express 4.19.2 async-throw crash (exit 1) was reproduced locally in a scratch app. `securityService.enabled: true` in `values-prod.yaml:111`.

**Inferred (with the check that would settle it):**
- Postgres rejects `\u0000` in text parameters (22021). Settle with `SELECT $1::text` and a NUL against any PG.
- Permit RBAC tenant roles apply to all instances (H-3), and Permit rejects a grant of an undeclared resource role (H-2). Settle with a check and a grant against the prod PDP in a sandbox tenant.
- The prod image can't `require('@fuzefront/feature-flags')` (I-1). Settle with `docker run` on the image.

**Not done:**
- I did not run the unit or acceptance suites locally; I relied on CI conclusions.
- I did not probe prod, and in particular did not exercise C-1 live.
- I could not search existing issues: GraphQL and search are blocked for this session, so C-1 may already be tracked.
- I did not review `backend/security` beyond the grants/check routes, or the MCP gateway's auth forwarding.
- I did not open tickets or PRs. Per the task, all patches above are proposals.

**Handoffs (out of scope for security; named owners):**
- C-1: backend-engineer (backend/security), P0, platform-wide.
- H-1: backend-engineer + devops-engineer.
- H-2: backend-engineer.
- H-3, M-1, L-1, L-4: contract-designer.
- H-4, M-2, M-3, M-4, L-2, L-3, L-5: backend-engineer.
- M-4 rate limit, L-6, I-1 MCP host: devops-engineer / platform-governance.
