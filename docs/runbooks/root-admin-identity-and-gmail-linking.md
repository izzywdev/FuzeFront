# Runbook — root admin identity, Gmail linking, and becoming a platform superadmin

**Jira:** [FFRNT-299](https://fuzefront.atlassian.net/browse/FFRNT-299) ·
**Related gaps (in-UI flows):** [FFRNT-296](https://fuzefront.atlassian.net/browse/FFRNT-296) (connect/disconnect UI), [FFRNT-298](https://fuzefront.atlassian.net/browse/FFRNT-298) (platform-superadmin promotion)

This runbook documents the **current, pre-UI reality**. Several steps below are manual
(GitOps blueprint / DB write / sealed-secret read) precisely because the in-app flows do
not exist yet — they are tracked by the tickets above. Everything here is verified against
the code paths cited, not against docs.

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

## 3. Becoming a FuzeFront platform superadmin (today = DB write + restart)

### 3.1 The mechanism

- A **platform superadmin** = a `users` row whose `roles` JSON array contains `admin`.
- On every backend boot, [`ensureRootOrgAdmins()`](../../backend/src/services/rootOrgAdmin.ts)
  grants the Permit **ReBAC `org-admin` role on the ROOT org** to every such user (excluding
  `platform-registrar`).
- `org-admin` is declared **derived parent→child** over `Organization.relations.parent`
  ([`backend/src/permit/schema.ts`](../../backend/src/permit/schema.ts)), so root org-admin ⇒
  admin over **every** tenant in the hierarchy.

There is **no API or UI** to set `roles` today (FFRNT-298). It is a direct DB write.

### 3.2 To promote an account (manual, until FFRNT-298 lands)

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
3. **Make your own account a FuzeFront platform superadmin:** set `roles:['admin','user']` on
   your `users` row and restart the backend (§3). No UI for this yet.
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
| Promote to platform superadmin via DB write | [FFRNT-298](https://fuzefront.atlassian.net/browse/FFRNT-298) — first-admin bootstrap + authorized promotion |

Parent epic for the account-security UI: [FFRNT-139](https://fuzefront.atlassian.net/browse/FFRNT-139).
