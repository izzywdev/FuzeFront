# Runbook — root admin identity, Gmail linking, and becoming a platform superadmin

**Jira:** [FFRNT-299](https://fuzefront.atlassian.net/browse/FFRNT-299) ·
**Related gaps (in-UI flows):** [FFRNT-296](https://fuzefront.atlassian.net/browse/FFRNT-296) (connect/disconnect UI), [FFRNT-298](https://fuzefront.atlassian.net/browse/FFRNT-298) (platform-superadmin promotion)

This runbook documents the **current, pre-UI reality**. Several steps below are manual
(GitOps blueprint / sealed-secret read) precisely because the in-app flows do not exist yet —
they are tracked by the tickets above. The platform-superadmin setup, by contrast, is now
**automated** first-deploy Permit seeding for the configured admins (§3.0, FFRNT-380); the
direct DB write is break-glass only. Everything here is verified against the code paths cited,
not against docs.

> **Boundary reminder:** prod is GitOps. Do **not** hand-deploy or `kubectl apply` app
> changes to prod. The read-only inspection commands below are fine; anything that mutates
> cluster state must go through the normal pipeline / a deploy window.

---

## 1. The identities, disambiguated

There are **two** "root admin" identities plus the root org. They are not the same account
and do not share a password.

### 1.1 The root organization (durable, exists in prod)

- Fixed id `00000000-0000-0000-0000-000000000010`, name `FuzeFront`, slug `fuzefront`.
- Created by migration [`015_seed_root_platform_organization.ts`](../../backend/src/migrations/015_seed_root_platform_organization.ts)
  (a migration, not a seed, so it runs unconditionally on every boot — including prod).
- Initially **owned by the `platform-registrar` service principal** (`00000000-0000-0000-0000-000000000001`,
  migration `014`), which has **no password** and can never complete an interactive login.
  `ensureRootPortal()` / `adoptRootOrganizationOwner()` promotes ownership to a real admin
  when one appears.

### 1.2 Authentik `akadmin` — the real prod break-glass login (identity/SSO layer)

- Username `akadmin`. Email = `authentik.bootstrapEmail`:
  - **prod:** `admin@fuzefront.com` (`deploy/helm/fuzefront/values-prod.yaml`)
  - **local:** `admin@fuzefront.dev` (`deploy/helm/fuzefront/values.yaml`)
- Password = **`AUTHENTIK_BOOTSTRAP_PASSWORD`** — a **sealed secret** in `fuzefront-secrets`
  ([`templates/secret.yaml`](../../deploy/helm/fuzefront/templates/secret.yaml),
  [`templates/authentik.yaml`](../../deploy/helm/fuzefront/templates/authentik.yaml)).
  **The literal value is not in git** — only the SealedSecret is. This is the IdP superuser
  and administers Authentik at `/if/admin/`.
- Bootstrap creds must be present on **both** `authentik-server` and `authentik-worker`
  (the worker runs the bootstrap blueprint that creates `akadmin`).

**Read the live bootstrap password (read-only, requires cluster access):**

```bash
kubectl -n fuzefront get secret fuzefront-secrets \
  -o jsonpath='{.data.AUTHENTIK_BOOTSTRAP_PASSWORD}' | base64 -d; echo
```

### 1.3 Seeded app admin — DEV / CI ONLY, never prod

- `admin@fuzefront.dev` / **`admin123`** (roles `['admin','user']`) and
  `demo@fuzefront.dev` / `demo123` (roles `['user']`) — [`backend/src/seeds/001_initial_users.ts`](../../backend/src/seeds/001_initial_users.ts).
- Seeds are gated behind `NODE_ENV !== 'production'`, so **these do not exist in prod.**
  Do not expect `admin@fuzefront.dev / admin123` to work against `app.fuzefront.com`.

---

## 2. Linking izzy.weinberg@gmail.com to an admin identity (today = GitOps, not UI)

There is **no in-app "connect Google" flow in prod yet** (see FFRNT-296). Linking is done at
the IdP by an Authentik blueprint + email matching.

### 2.1 How it works

- [`source-google.yaml`](../../deploy/helm/fuzefront/authentik/blueprints/source-google.yaml)
  sets `user_matching_mode: email_link` — a Google sign-in whose **verified email** matches
  an existing Authentik user **merges into that account** instead of creating a duplicate.
- [`groups-fuzeinfra-admins.yaml`](../../deploy/helm/fuzefront/authentik/blueprints/groups-fuzeinfra-admins.yaml)
  **pre-creates** Authentik user `izzy` / **izzy.weinberg@gmail.com** in the `fuzeinfra-admins`
  (`is_superuser: true`) group, with **no password** (Google-only).
- Net effect: the **first** Google sign-in with `izzy.weinberg@gmail.com` links straight into
  that superuser account. No post-login clickops.

### 2.2 Important caveat — this is NOT the same as FuzeFront app platform-admin

- `fuzeinfra-admins` / `is_superuser` grants **Authentik admin + Grafana + ArgoCD** authority
  (the group name is a contract consumed by Grafana `roleAttributePath` and ArgoCD `policy.csv`).
- It does **not** set the FuzeFront **application** `users.roles` to `['admin']`, and therefore
  does **not** by itself make the account a FuzeFront **platform superadmin** (§3). A
  Google-provisioned FuzeFront user lands with `roles = ['user']`.

### 2.3 To do it

1. Ensure the Google source is configured in prod (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   sealed; empty creds leave the source inert / no button).
2. Confirm the two blueprints above are applied in the FuzeFront Authentik silo.
3. Sign in at `https://app.fuzefront.com` with **Continue with Google** using
   `izzy.weinberg@gmail.com`. First sign-in links into the pre-created superuser account.
4. Break-glass remains `akadmin` (§1.2) if Google federation ever breaks.

---

## 3. Platform Permit seeding & becoming a superadmin

### 3.0 First-deploy Permit seeding (automated — FFRNT-380)

On a fresh platform deploy the Permit authorization model is seeded **automatically,
idempotently, and fail-soft** — there is **no manual Permit setup and no manual DB write** for
the configured platform. Two mechanisms, both safe to re-run on every deploy/boot:

1. **Permit policy schema** — the resources/actions/roles from
   [`backend/src/permit/schema.ts`](../../backend/src/permit/schema.ts), including the
   tenant-role hierarchy (`owner`/`admin` ⊇ `member`/`editor` ⊇ `viewer`, FFRNT-376) and the
   ReBAC `Organization.parent` relation with its derived `org-admin` role — is pushed to Permit
   by both:
   - the Helm `post-install,post-upgrade` hook
     [`permit-schema-job.yaml`](../../deploy/helm/fuzefront/templates/permit-schema-job.yaml)
     (`node dist/permit/sync-permit-schema.js`), and
   - the backend boot bootstrap (`syncPermitSchemaFromRegistry` in
     [`backend/src/index.ts`](../../backend/src/index.ts)), which also merges per-product policies.
2. **Root tenant instance + root-admin grant** — the backend boot bootstrap
   (`runPostListenBootstrap` in [`index.ts`](../../backend/src/index.ts)) then, in order:
   - `ensureRootPortal()` — the seeded root portal;
   - [`ensureRootOrgAdmins()`](../../backend/src/services/rootOrgAdmin.ts), which **(a)** seeds
     the ROOT org as a Permit **resource instance** (`createOrganizationResourceInstance`,
     idempotent) so the parent→child derivation has an instance to derive **from** — without it
     `org-admin` targets a nonexistent `Organization:<root>` and the whole mechanism resolves to
     nothing; **(b)** promotes every email in `PLATFORM_ROOT_ADMIN_EMAILS` to
     `roles:['…','admin']` plus an active `owner` membership on the root org; and **(c)** grants
     Permit ReBAC `org-admin` on the root org to every `admin` user (excluding `platform-registrar`);
   - a **5-minute interval** (`ensureConfiguredRootAdmins`) so a configured admin's **first login**
     takes effect without a restart.

   Every step is idempotent (Permit treats a repeat grant as a benign conflict; the instance seed
   swallows already-exists) and **fail-soft** — Permit being unreachable never blocks boot, because
   authorization already fails closed.

**Configured platform admins need no manual step.** `PLATFORM_ROOT_ADMIN_EMAILS` is set from Helm
[`rootAdmins.emails`](../../deploy/helm/fuzefront/values.yaml) (currently
`izzy.weinberg@gmail.com`), wired in
[`templates/backend.yaml`](../../deploy/helm/fuzefront/templates/backend.yaml). Once that account
exists (its first Google sign-in, §2), the boot bootstrap / 5-minute interval promotes it and
grants root `org-admin` **automatically — no SQL, no hand restart.** To add another platform
admin, add their email to `rootAdmins.emails` and let the normal GitOps deploy apply it; the
seeding does the rest. The break-glass DB write in §3.2 is only for a one-off promotion when a
GitOps change to `rootAdmins.emails` is not available.

### 3.1 The mechanism (what a superadmin grant resolves to)

- A **platform superadmin** = a `users` row whose `roles` JSON array contains `admin`.
- On every backend boot, [`ensureRootOrgAdmins()`](../../backend/src/services/rootOrgAdmin.ts)
  grants the Permit **ReBAC `org-admin` role on the ROOT org** to every such user (excluding
  `platform-registrar`).
- `org-admin` is declared **derived parent→child** over `Organization.relations.parent`
  ([`backend/src/permit/schema.ts`](../../backend/src/permit/schema.ts)), so root org-admin ⇒
  admin over **every** tenant in the hierarchy.

For a **configured** admin (an email in `rootAdmins.emails`) the `roles` write happens
automatically (§3.0) — no manual step. A general-purpose authorized in-UI promotion for a
non-configured account is still tracked by FFRNT-298; until it lands, promote a non-configured
account either by adding it to `rootAdmins.emails` (preferred) or, break-glass, by the direct DB
write below.

### 3.2 Break-glass only — promoting a NON-configured account by hand

> Prefer adding the email to Helm `rootAdmins.emails` and deploying (§3.0): the seeding then
> promotes and grants it automatically, no SQL. Use the direct DB write below **only** as
> break-glass — a one-off promotion when a GitOps change is not available — and never for an
> account already listed in `rootAdmins.emails` (the boot bootstrap handles those).

1. Identify the projected `users` row (matched by email; the local `id` is a generated uuid,
   deliberately **not** the OIDC `sub`):

   ```sql
   SELECT id, email, roles FROM users WHERE email = 'izzy.weinberg@gmail.com';
   ```

2. Add `admin` to `roles` (keep `user`):

   ```sql
   UPDATE users
      SET roles = '["admin","user"]'::jsonb, updated_at = NOW()
    WHERE email = 'izzy.weinberg@gmail.com';
   ```

3. Restart the backend so `ensureRootOrgAdmins()` re-runs and grants Permit root org-admin
   (in prod this is a GitOps-safe rollout, not a hand-deploy):

   ```bash
   kubectl -n fuzefront rollout restart deploy/fuzefront-backend
   ```

4. Verify the Permit grant took (the derivation needs the root grant to derive **from**;
   without it the whole platform-admin mechanism resolves to nothing).

> **Do not** treat "knowing the id" or "having the row" as authorization. Real authz is the
> token + Permit. This DB write is the *grant source*, enforced by Permit at request time.

---

## 4. Putting it together — the end-to-end you asked about

1. **Sign in as the prod root admin:** `akadmin` — `admin@fuzefront.com` + the sealed
   `AUTHENTIK_BOOTSTRAP_PASSWORD` (§1.2). (Dev only: `admin@fuzefront.dev / admin123`.)
2. **Link your Gmail:** first **Continue with Google** as `izzy.weinberg@gmail.com` links into
   the pre-created `izzy` superuser account via the blueprint + `email_link` (§2). This is an
   IdP/infra-admin identity, separate from `akadmin`.
3. **Become a FuzeFront platform superadmin:** for `izzy.weinberg@gmail.com` this is
   **automatic** — the email is in Helm `rootAdmins.emails`, so the boot bootstrap / 5-minute
   interval promotes the account to `roles:['admin','user']`, makes it `owner` of the root org,
   and grants Permit root `org-admin` on its own, with no SQL and no hand restart (§3.0). For a
   different, non-configured account, add it to `rootAdmins.emails` and deploy (preferred), or
   use the break-glass DB write (§3.2).
4. **Move a social link between accounts (disconnect/connect):** not possible in the UI in
   prod today — the disconnect (unlink) path exists server-side and in the UI client, but the
   **connect** path and the `/account/security/connections` surface are unbuilt (FFRNT-296).
   Also note email-matching means one Gmail maps to one account, so "moving" is unlink-then-
   relink once that flow exists.

---

## 5. What is tracked to remove the manual steps

| Manual step here | Replaced by |
|---|---|
| Connect/disconnect Google via blueprint + DB | [FFRNT-296](https://fuzefront.atlassian.net/browse/FFRNT-296) — in-UI connect + `/account/security/connections` |
| Hub not reachable in prod (flag OFF, sub-routes 404) | [FFRNT-297](https://fuzefront.atlassian.net/browse/FFRNT-297) — route wiring + flag rollout |
| Promote a **configured** admin (in `rootAdmins.emails`) | ✅ **done** — automated first-deploy Permit seeding ([FFRNT-380](https://fuzefront.atlassian.net/browse/FFRNT-380)); no manual step (§3.0) |
| Promote a **non-configured** account without a GitOps change | [FFRNT-298](https://fuzefront.atlassian.net/browse/FFRNT-298) — first-admin bootstrap + authorized in-UI promotion (break-glass DB write until then, §3.2) |

Parent epic for the account-security UI: [FFRNT-139](https://fuzefront.atlassian.net/browse/FFRNT-139).
