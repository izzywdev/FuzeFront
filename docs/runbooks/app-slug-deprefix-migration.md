# Runbook — de-prefixing an app slug (`fuzeservice` → `service`)

> # ⛔ RETIRED 2026-08-19 — DO NOT RUN THIS PROCEDURE
>
> **The policy this runbook implements has been reversed by owner ruling.** The `fuze`
> prefix now **stays on the slug** and comes off the **display string** (`name`,
> `menuLabel`) instead. Existing registrations are to be **left exactly as they are** —
> the de-prefixed slugs already live (`deploy`, `call`, `executive`, `finance`, `keys`,
> `market`, `picker`) are not to be migrated, and the prefixed ones (`fuzex`, `fuzebi`)
> are not to be "corrected".
>
> Every step below still describes the mechanics accurately, and the losses it warns
> about — orphaned Permit grants, CASCADE-deleted `app_installations` rows — are exactly
> why the gate that used to demand this migration was wrong. It is kept as the record of
> what such a migration costs, should a genuine one ever be needed.
>
> The current rule, and why only the display fields are gated, is in
> [`packages/onboarding-kit/README.md`](../../packages/onboarding-kit/README.md).
>
> **The measured state table below is a snapshot from when this was written. It is
> history, not a to-do list.**


**Audience:** the platform owner. **Not an agent task.** Every step here touches the
live registry, live Permit policy, or live install records. There is no dry-run mode for
the Permit half.

**Tool:** `packages/onboarding-kit/bin/migrate-slug.mjs`
(`npx fuzefront-migrate-slug`). It is dry-run by default and refuses to delete anything
until you have answered for the two losses described below.

---

## 1. What is being corrected, and why it is not an edit

Every Fuze product registers on FuzeFront **without the `Fuze` prefix** — slug `service`,
name `Service`. Measured state at the time of writing (13 repos):

| repo | slug | name | needs migration |
|---|---|---|---|
| fuzeagent | `fuzeagent` | FuzeAgent | yes |
| fuzebi | `fuzebi` | FuzeBI | yes |
| fuzecontact | `fuzecontact` | Contact | slug only |
| fuzedeploy | `fuzedeploy` | FuzeDeploy | yes |
| fuzeexecutive | `fuzeexecutive` | FuzeExecutive | yes |
| fuzehub | `fuzehub` | FuzeHub | **SCOPED OUT — suite parent, see §6** |
| fuzekeys | `fuzekeys` | FuzeKeys | yes |
| fuzemarket | `fuzemarket` | FuzeMarket | yes |
| fuzepicker | `picker` | FuzePicker | name only — **already correct**, no migration |
| fuzeplan | `fuzeplan` | FuzePlan | yes |
| fuzesales | `fuzesales` | Sales | slug only |
| fuzeservice | `fuzeservice` | FuzeService | yes |
| fuzesocial | `fuzesocial` | FuzeSocial | yes |

`slug` is **immutable**. `PUT /apps/{slug}` states that `slug`, `builtin` and
`manifestVersion` "are immutable and must match", and the contract has no rename. So the
correction is two operations against two different rows:

1. `POST /apps` — register the short slug.
2. `DELETE /apps/{prefixed}` — remove the original.

`register.sh` does **step 1 only**. A product that de-prefixes its manifest and
redeploys therefore ends up registered **twice**, with the prefixed row still activated
and still in the launcher. Twelve products doing that is twelve ghost tiles. Step 2 is
what this runbook exists to drive.

> **Do not "fix" this by adding `(?!fuze)` to `Slug` in the contract.** Twelve live rows
> hold prefixed slugs; banning the value at the API would break their `register.sh`
> manifest refresh and could block the very DELETE that repairs them. The rule is
> enforced at **authoring** time instead — `validate-registration.mjs`, in the product's
> own repo. The registry must keep accepting the old value until the last migration is
> done.

---

## 2. The Permit answer — read this before touching anything

**Changing the slug renames every Permit key the product owns, and orphans every grant
against the old ones. Nothing errors. Affected users silently lose their roles.**

Mechanically:

- `backend/src/permit/sync-permit-schema.ts` → `loadRegisteredPolicyResult()` builds each
  stored policy as `policy = { ...raw, product: row.slug }`. **The registry slug is the
  Permit namespace**, whatever the policy file's own `product` field says.
- `backend/src/permit/product-policy.ts` → `namespaceKey()` produces `<slug>_<Key>`. So
  `fuzeservice_Ticket` → `service_Ticket`, and role `fuzeservice_agent` → `service_agent`.
- Role assignments (`permit.api.roleAssignments.assign({ user, role, tenant })`) store the
  **namespaced role key**. They keep pointing at `fuzeservice_agent`.
- `syncPermitSchema()` is get-or-create/update and **never deletes**. The old resources
  and roles therefore survive in Permit indefinitely after the registry row is gone. The
  assignment stays valid and stays un-erroring — it simply grants permissions on a
  resource type nothing checks any more.
- Runtime checks go through `checkProductPermission(user, product, …)` →
  `namespaceKey(product, resource)` with the **new** slug. No matching grant. Permit
  denies. Authorization fails closed, which is correct, and is exactly why nobody gets an
  alert.

### Is that acceptable?

**Not as a default, and it must not be hand-waved as "probably nobody has grants yet".**
Two things narrow the blast radius, and one thing keeps it real:

1. **Platform roles are unaffected.** `admin` / `editor` / `viewer` (assigned by
   `backend/src/utils/permit/role-assignment.ts` and the security package's
   `PermitAuthorizationProvider`) are **not namespaced**. Org membership, platform admin
   and every base-schema permission survive a slug change untouched. Only
   **product-declared** roles are at risk.
2. **In-repo, nothing assigns a product role yet.** `assignProductRole`,
   `unassignProductRole`, `checkProductPermission` and `requireProductPermission`
   (`backend/src/utils/permit/product-authz.ts`) have **zero call sites** anywhere in
   FuzeFront. The product-role runtime path is declared but not yet wired here.
3. **But FuzeFront is not the only writer.** The entire point of
   `PUT /apps/{slug}/policy` is that products declare and use their own roles from their
   own backends, via their own Permit credentials. The platform **cannot** assert the
   grant count is zero on a product's behalf. It has to be **measured**, per product,
   before each migration.

So: the loss is real, bounded to product-namespaced grants, and **cheap to avoid** —
because of the overlap window in §3. The tool refuses to delete without `--permit-grants`
for exactly this reason.

### Measure it (per product, before migrating)

```bash
# Every assignment in the product's namespace. Non-empty => you must remap (step 3b).
curl -s -H "Authorization: Bearer $PERMIT_API_KEY" \
  "https://api.permit.io/v2/facts/$PROJ/$ENV/role_assignments?role=fuzeservice_agent&per_page=100"
```

Repeat for each role in the product's `policy.json`. Zero across all roles → the loss is
nil and `--permit-grants` is a formality. Non-zero → do step 3b.

### Why the overlap window makes the remap safe

`mergeProductPolicy` throws only on a **key collision**. `fuzeservice_*` and `service_*`
do not collide, so while **both** slugs are registered, the synced Permit schema contains
**both complete namespaces**. That gives a window in which the old role and the new role
both exist and both work — so the remap is a pure *add-then-remove* with **no instant at
which a user holds neither**. That is why DELETE is last, and it is a Permit reason, not
just a portal reason.

---

## 3. Procedure, per product

Ordering is load-bearing. Do not reorder.

### 3a. Register the replacement (both slugs live)

```bash
node packages/onboarding-kit/bin/migrate-slug.mjs \
  --from fuzeservice --to service \
  --api https://app.fuzefront.com --token "$FUZEFRONT_REGISTRATION_TOKEN" \
  --registration ../fuzeservice/registration
```

No `--apply` — this is a **dry run**, and it changes nothing. It prints the full plan and
emits `WARNING (would block --apply)` for each acknowledgement you have not yet given, so
you can see exactly what the migration will do *before* deciding anything. (The
acknowledgements gate the DELETE, not the preview — otherwise you would have to type them
just to get output, and a confirmation you must bypass to do your job is not a decision.)

Read the plan. Confirm the `NOTE` lines about `routing.host` and `integration.scope`:
neither is rewritten, because a hostname needs DNS/cert/ingress and the MF scope must keep
matching the global the deployed bundle actually publishes. If either genuinely needs to
change, that is a **separate** product change, shipped before this migration, not during
it.

You now have two ways to open the overlap window that step 3b needs. Either **redeploy the
product with its de-prefixed manifest** (the other wave of work — `register.sh` performs
step 1 on its own), or come back and run `--apply` with both flags once 3b and 3c are
ready. The tool handles both: it resumes cleanly from a state where the replacement is
already registered.

### 3b. Force a Permit sync, then remap the grants

```bash
# In the platform: run the schema sync job so BOTH namespaces exist in Permit.
kubectl -n fuzefront create job --from=cronjob/permit-schema-sync permit-sync-$(date +%s)
curl -s https://app.fuzefront.com/health | jq '.permitSync'   # outcome must be "ok"
```

`outcome: "ok"` is required. `registry_unavailable` means **no** product policy reached
Permit and the new namespace does not exist — stop, fix, re-run.

Then, for every assignment found in §2:

```bash
# ADD the new grant first. Never remove before adding — the whole point of the
# overlap window is that no user is ever left without either role.
curl -X POST -H "Authorization: Bearer $PERMIT_API_KEY" -H 'Content-Type: application/json' \
  "https://api.permit.io/v2/facts/$PROJ/$ENV/role_assignments" \
  -d '{"user":"<user>","role":"service_agent","tenant":"<tenant>"}'

# Verify, THEN remove the old one.
curl -X DELETE -H "Authorization: Bearer $PERMIT_API_KEY" \
  "https://api.permit.io/v2/facts/$PROJ/$ENV/role_assignments" \
  -d '{"user":"<user>","role":"fuzeservice_agent","tenant":"<tenant>"}'
```

### 3c. Capture the install rows

`app_installations.app_id` references `apps.id` **ON DELETE CASCADE**
(`backend/src/migrations/017_app_scope_levels_and_installations.ts`). Deleting the
prefixed app **destroys every personal and organization install** of the product. Installs
are not part of the frozen `/api/v1/app-registry` contract — they live on the legacy
`/api/apps/:id/install` surface — so the migration tool can neither read nor restore them.

```sql
-- Capture before deleting. Keep this output.
SELECT i.* FROM app_installations i
  JOIN apps a ON a.id = i.app_id
 WHERE a.slug = 'fuzeservice';
```

Then decide: re-create them against the new `apps.id` after the migration, or accept that
users and orgs must re-install. **Either is fine; silently discovering it afterwards is
not.** A product with zero rows here makes this a no-op.

### 3d. Run the migration

```bash
node packages/onboarding-kit/bin/migrate-slug.mjs \
  --from fuzeservice --to service \
  --api https://app.fuzefront.com --token "$TOKEN" \
  --registration ../fuzeservice/registration \
  --permit-grants --installs --apply
```

The tool will, in order: register the short slug (or refresh it if a redeploy already
did), re-submit `policy.json` and `billing-profile.json` under the new slug, match the
old app's status (a **suspended** app is not switched on by migrating it), **re-read the
registry and verify** the replacement is present, correct and at the right status — and
only then `DELETE` the prefixed row.

Every failure path aborts **before** the delete. The worst outcome it can produce is both
rows present, which is a duplicate tile: visible, harmless, and fixed by re-running.

### 3e. Verify, then clean up Permit

```bash
curl -s -H "Authorization: Bearer $TOKEN" https://app.fuzefront.com/api/v1/app-registry/apps \
  | jq '[.[] | select(.slug|test("^fuze"))] | map(.slug)'
```

Load the portal and confirm one tile, that it mounts, and that a user with the product
role can still reach a gated route.

`syncPermitSchema` never deletes, so `fuzeservice_Ticket` / `fuzeservice_agent` remain in
Permit as orphans. They grant nothing that anything checks, so they are harmless — but
delete them by hand once the migration is verified, or the next person to read the Permit
schema will find two namespaces per product and no way to tell which is live.

---

## 4. Rollback

Before the DELETE lands there is nothing to roll back — both rows exist and the old one is
still serving. Re-run without `--apply`.

After the DELETE: re-register the prefixed slug from the product's `registration/`
directory (`register.sh` against the old manifest) and re-add the old Permit grants.
Install rows are **not** recoverable except from the §3c capture.

---

## 5. Order the fleet in

Do **`fuzeservice` first, alone**, and let it sit for a day. It is a plain single-surface
product with a policy, so it exercises every step without being the one that hurts if it
goes wrong. Then batch the rest. Do not run all twelve in one window — the failure mode
you are watching for (a product whose users quietly lost a role) takes hours to show up,
and twelve simultaneous migrations make it unattributable.

`fuzepicker` needs **no migration** — its slug is already `picker`. Only its display name
carries the prefix, and `name` is mutable via the ordinary manifest refresh: de-prefix it
in the repo and redeploy.

`fuzecontact` and `fuzesales` need the **slug** migration only; their names are already
correct.

---

## 6. Scoped out: FuzeHub

**`fuzehub` must not be migrated with this tool, and the tool refuses it.**

FuzeHub registers five rows — the parent plus four sibling surfaces (`fuzehub-talent`,
`fuzehub-recruiter`, `fuzehub-ventures`, `fuzehub-marketplace`), grouped in the menu by an
identical `nav.suite.id`. Migrating the parent alone breaks three things at once:

- the siblings keep `nav.suite.id: "fuzehub"` and **split into a second menu group**;
- their own slugs stay prefixed, so the product is half-corrected forever;
- the product-level policy and billing profile bind to the **primary** slug only (see
  `register.sh`), so they move to a row the siblings no longer relate to.

Doing it correctly means registering five replacements, re-pointing five suite ids and
deleting five originals as **one atomic operation**. The frozen contract offers no
transaction, so atomicity would have to be simulated — and a simulated transaction across
five deletes is precisely where a tool leaves a product showing three tiles. That is the
worst possible place to be clever.

So: FuzeHub is a **maintenance-window, human-driven** migration, with the five
replacements registered and verified *first*, all four `nav.suite.id` values repointed to
`hub`, and the five originals deleted last. It is not in scope for the tool and should not
be forced into it.

---

## 7. What the tool refuses, and why

| Refusal | Reason |
|---|---|
| `--from` does not start with `fuze` | This is not a general rename tool. A rename nobody reviewed is a delete nobody reviewed. |
| `--to` still starts with `fuze` | That is the thing being corrected. |
| neither slug is registered | "Nothing to do" and "you typed the slug wrong" look identical against the registry; exiting 0 on the second is how a migration gets ticked off without happening. |
| the app is `builtin` | `DELETE` 403s on built-ins, so the migration could never finish — it would only ever add a permanent duplicate. Built-ins are de-prefixed by changing the platform seed and re-seeding. |
| suite siblings detected | §6. |
| `GET /apps` unreadable | Siblings cannot be ruled out, so a delete cannot be proven safe. |
| `--permit-grants` missing (on `--apply`) | §2. A dry run warns instead, so you can still see the plan. |
| `--installs` missing (on `--apply`) | §3c. A dry run warns instead. |
| verification failed after registering | The replacement is not confirmed equivalent, so the original stays. |
