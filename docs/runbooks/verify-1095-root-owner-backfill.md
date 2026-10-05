# Post-deploy verification — PR #1095 (root owner + membership backfill)

**What deployed:** migrations `029_set_root_owner_and_backfill_memberships` (monolith
`backend/src`) and `020_set_root_owner_and_backfill_memberships` (security
`backend/security/src`). They (1) set `organizations.owner_id` for the root org to
the resolved platform owner, (2) give that owner an `owner` membership, and (3)
backfill a `member` membership for every other user.

**Root org id:** `00000000-0000-0000-0000-000000000010` (`ROOT_ORG_ID`).
**Platform registrar (bootstrap identity, NOT a person):** `00000000-0000-0000-0000-000000000001`.
**Owner resolution order:** `ROOT_OWNER_EMAIL` env → default `izzy.weinberg@gmail.com`
(repo CODEOWNER) → oldest non-registrar user.

> Requires prod DB + cluster access (GitOps on FuzeInfra). This session cannot run
> these; hand to a session/operator that holds prod credentials.

---

## 0. Confirm which email the owner resolved to

If the platform account's email is **not** `izzy.weinberg@gmail.com` and
`ROOT_OWNER_EMAIL` was unset at deploy, ownership fell to the *oldest non-registrar
user*, which may be the wrong account. Check first:

```sql
-- Does the expected owner account exist by email?
SELECT id, email, created_at FROM users
WHERE lower(email) = lower('izzy.weinberg@gmail.com');
```

Check the deployment env actually in effect:

```bash
# kubectl against the prod namespace (adjust ns/deploy names to the chart)
kubectl -n fuzefront get deploy -o name | grep -Ei 'backend|security'
kubectl -n fuzefront set env --list deploy/<backend-deploy> | grep -i ROOT_OWNER_EMAIL || echo "ROOT_OWNER_EMAIL unset -> default used"
```

If the email is wrong: set `ROOT_OWNER_EMAIL` to the correct account email in the
backend + security deployment env (via the chart / GitOps, never a manual cluster
edit) and re-run the migration — it is idempotent and never throws, so a re-run is
safe and will move ownership to the right account.

---

## 1. Root org now has a human owner (not the registrar, not NULL)

```sql
SELECT id, name, slug, owner_id FROM organizations
WHERE id = '00000000-0000-0000-0000-000000000010';
```

PASS: `owner_id` is a real user id, and **not** `00000000-0000-0000-0000-000000000001`
and not NULL. Resolve it to a person:

```sql
SELECT u.id, u.email FROM users u
JOIN organizations o ON o.owner_id = u.id
WHERE o.id = '00000000-0000-0000-0000-000000000010';
```

PASS: the email is the intended platform owner.

## 2. Owner has an `owner` membership on root

```sql
SELECT user_id, role, status FROM organization_memberships
WHERE organization_id = '00000000-0000-0000-0000-000000000010'
  AND user_id = (SELECT id FROM users WHERE lower(email)=lower('izzy.weinberg@gmail.com'));
```

PASS: one row, `role = 'owner'`, `status = 'active'`.

## 3. Every user got a root membership (the backfill)

```sql
-- Should return 0 rows: users with NO active root membership.
SELECT u.id, u.email FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships om
  WHERE om.user_id = u.id
    AND om.organization_id = '00000000-0000-0000-0000-000000000010'
    AND om.status = 'active'
);
```

PASS: 0 rows. (Sanity: `count(active root memberships) >= count(users)`.)

## 4. The migrations actually ran

```sql
-- Monolith DB:
SELECT name, migration_time FROM knex_migrations
WHERE name LIKE '029_set_root_owner%';
-- Security DB (same physical prod DB; may share knex_migrations or use its own table):
SELECT name, migration_time FROM knex_migrations
WHERE name LIKE '020_set_root_owner%';
```

PASS: one row each (migration recorded). If missing, the deploy's migrate step did
not run — check the release/deploy job + pod init logs for `[029]` / `[020]` lines:
`[029] set root … owner_id … -> …` and `[029] root owner=…; backfilled N member row(s)`.

## 5. The "Your organizations" HTTP 500 is gone

The 500 in the original screenshot was the root-absence surfacing. With root present +
owned:

```bash
# As the platform owner (authenticated), the org list should 200 and show root
# with role owner, not GUEST:
curl -fsS -H "Authorization: Bearer <token>" https://app.fuzefront.com/api/organizations | jq '.[] | {id,name,role}'
```

PASS: 200, root org present with `role: "owner"` (not `GUEST`), no 500. Cross-check
app logs for any remaining 500 on that route.

---

## If anything FAILS

The migration is idempotent and never throws. The fix for a wrong owner or a missed
backfill is: correct `ROOT_OWNER_EMAIL` (step 0) if needed, then re-run the migration
through the normal deploy path. Do **not** hand-edit rows in prod; if a one-off repair
is unavoidable, do it as a new idempotent migration PR, not a manual `UPDATE`.
