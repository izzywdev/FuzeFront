# App scopes, the consolidated user menu, and the notification service

Plan of record for four related changes to the FuzeFront shell and one new
backing microservice. Written before implementation so the schema, the API
surface and the isolation model are decided once, in the open, rather than
re-derived per file.

- **A —** every registered app declares an **install scope level**: personal,
  organization, or both. Installing a `both` app asks where; installing at org
  level asks **for me** or **for everyone**.
- **B —** the **organization switcher** moves out of the top bar and into the
  user-avatar menu.
- **C —** an **account switcher** joins it: up to `MAX_PARALLEL_ACCOUNTS = 5`
  signed-in accounts on one browser, isolated so no state leaks between them.
- **D —** the **language switcher** moves into the same menu.
- **E —** the notification bell stops being a decorative stub and gets a real
  **notification-service** — schema, API, delivery, and a shell client.

---

## A. App install scopes

### The gap today

`apps` has `organization_id` (ownership) and `visibility`
(`private | organization | public | marketplace`, migration 006). Neither says
**who an app can be installed for**, and there is no installation record at
all — an app is either registered to an org or it isn't. So there is no way to
express "this app makes sense for one person" versus "this app is a workspace-wide
capability", and no way for a member to add an app for themselves without
imposing it on every colleague.

Ownership, visibility and installation are three different questions. This adds
the third.

### Schema

**`apps.scope_level`** — new enum column, `app_scope_level_enum`:

| value | meaning |
|---|---|
| `personal` | installable only into a user's own space |
| `organization` | installable only into an organization |
| `both` | either; the install flow asks |

Default for existing and new rows is **`both`**. Every app on master today was
registered under an org-centric model but nothing about those apps forbids a
personal install, and `both` is the only default that leaves every current flow
working. Installation is not the authorization boundary — `visibility`,
org membership and Permit still gate what a user may see and do — so a
permissive default here does not widen access.

Note the existing `apps.scope` column is the **Module-Federation** scope
(webpack remote container name). The new column is deliberately `scope_level`,
not `scope`, so the two never collide.

**`app_installations`** — new table, one row per installation:

| column | notes |
|---|---|
| `id` | uuid pk |
| `app_id` | → `apps(id)` on delete cascade |
| `scope` | `personal \| organization` — where it landed |
| `install_mode` | `self \| everyone` — org installs only; personal is always `self` |
| `user_id` | → `users(id)`; set for `personal`, and for `organization`+`self` |
| `organization_id` | → `organizations(id)`; set for `organization` |
| `installed_by` | → `users(id)`, who performed it |
| `status` | `active \| revoked` |
| `settings` | jsonb, per-installation config |
| timestamps | |

Shape is enforced in the database, not only in the route, via a CHECK:

```
(scope = 'personal'     AND user_id IS NOT NULL AND organization_id IS NULL     AND install_mode = 'self')
OR
(scope = 'organization' AND organization_id IS NOT NULL AND
   ((install_mode = 'self'     AND user_id IS NOT NULL) OR
    (install_mode = 'everyone' AND user_id IS NULL)))
```

and three **partial unique indexes** so "install" is idempotent per target and
cannot duplicate:

- `(app_id, user_id) WHERE scope='personal' AND status='active'`
- `(app_id, organization_id) WHERE scope='organization' AND install_mode='everyone' AND status='active'`
- `(app_id, organization_id, user_id) WHERE scope='organization' AND install_mode='self' AND status='active'`

Uninstall is a soft revoke (`status='revoked'`, `revoked_at`) — the partial
indexes are scoped to `status='active'` precisely so an app can be uninstalled
and reinstalled without a unique-violation.

### API

Mounted on the existing host backend under `/api/apps`:

| method | path | notes |
|---|---|---|
| `GET` | `/api/apps/:id/installations` | installations of this app visible to the caller |
| `POST` | `/api/apps/:id/install` | `{ scope, organizationId?, mode? }` |
| `DELETE` | `/api/apps/:id/install/:installationId` | revoke |
| `GET` | `/api/apps/installed` | the caller's **effective** app list for an org |

Authorization, fail-closed at each step:

1. The caller must be able to *see* the app at all — same `scopeAppsQuery`
   visibility rule the collection read already applies (org member, or the app
   is `public`/`marketplace`). Anything else is a 404, not a 403: a stranger
   must not be able to probe which app ids exist.
2. `scope` must be permitted by the app's `scope_level`. A `personal`-only app
   installed at org scope is a 422, and vice-versa.
3. Org-scoped installs require an **active membership** of that org.
4. `mode: 'everyone'` additionally requires `owner` or `admin` on that org — one
   member must not be able to push an app into every colleague's launcher.
   A plain member installing into an org gets `mode: 'self'`.

"Effective installs" for a user in an org is the union of their personal
installs, their org `self` installs, and every `everyone` install on that org.

---

## B + C + D. The consolidated user menu

### Why one menu

The top bar currently carries the org switcher, the app selector, the language
`<select>`, a theme toggle, the bell and the avatar. On a phone that does not
fit, and three of those six are *identity* controls that belong together: which
account am I, which organization am I in, and which language do I read. The
avatar menu is where a user already looks for "who am I".

After this change the top bar keeps: hamburger, brand, app selector, theme
toggle, bell, avatar. Everything identity-shaped is one click into the avatar.

Menu order, top to bottom:

1. **Account header** — name, email, role of the *active* account.
2. **Accounts** — the signed-in accounts, active one checked; *Add account* when
   under the cap; per-row *Sign out*.
3. **Organization** — the active account's orgs, active one checked; *Create
   organization* when permitted.
4. **Language** — the curated language list; drives the shared i18next instance
   and the `<html dir>` flip through the existing centralized direction manager.
5. Profile / Settings / Admin.
6. Sign out (of the active account).

### C. Multi-account isolation

The hard part. `localStorage` is per-origin, so two accounts in one browser
share a namespace by default — that is exactly the leak to design against.

**Storage model.** Every per-account key moves under a namespace:

```
ff.acct.<accountId>.authToken
ff.acct.<accountId>.sessionId
ff.acct.<accountId>.user
ff.acct.<accountId>.activeOrganizationId
```

`ff.accounts` holds the roster (id, email, display name, added-at) and
`ff.activeAccountId` the browser-wide default. There is exactly one function
that resolves the active account's token, and every caller — the axios
interceptor, the federated-app loader, the chat widget, the flags client, the
account-security page — reads through it. A token can therefore never be read
for an account that is not the active one.

**Per-tab active account.** The active account id is held in `sessionStorage`
(per-tab), falling back to the `localStorage` default when a tab has none. That
is what makes the accounts genuinely *parallel*: account A in tab 1 and account
B in tab 2 at the same time, each tab pinned to its own identity, neither able
to observe the other's in-memory state. `MAX_PARALLEL_ACCOUNTS = 5` bounds the
roster.

**Switching is a teardown, not a state update.** A switch writes the new active
id and performs a full-page navigation. React state, the app-registry cache, the
feature-flag cache, mounted Module-Federation remotes and any open socket all
die with the document. Nothing survives to be read under the wrong identity.
A soft in-place switch would leave every one of those holding account A's data
while account B's token is on the wire; that is the leak, so the reload is the
feature, not laziness.

**Legacy scrub.** The unnamespaced `authToken` / `sessionId` / `user` /
`ff.activeOrganizationId` keys are migrated into the active account's namespace
on first load and then removed, so a stale global key can never shadow a
namespaced one.

**What this does not claim.** Same-origin isolation is a *storage and lifecycle*
boundary, not a browser security boundary. Anything with script execution on the
origin — an XSS, a hostile federated remote given `document` access — can read
every namespace, exactly as it could read a single account's token today. Real
cross-account isolation at the browser level would need separate origins or
browser profiles. This design bounds accidental leakage (stale caches, wrong
token on a request, one account's org list rendering under another), which is
the actual failure mode, and does not pretend to bound a compromised origin.

---

## E. Notification service

### Shape

A standalone Express + Postgres microservice, modelled on `chat-service`: its
own `services/notification-service/` tree, its own knex migrations run by a
pre-upgrade Job, its own Helm template, and a same-origin proxy on the host
backend at `/api/v1/notifications` so the browser never makes a cross-origin
call (the repo's same-origin API rule).

Why a service rather than routes on the host backend: notifications are written
by *every* other service (billing, provisioning, chat, app-registry) and read on
a long-lived stream. That is a different load and lifecycle from the host
backend's request/response CRUD, and an inbox table growing at event volume does
not belong in the shell's hot path.

### Schema

**`notifications`** — one row per *recipient*, not per event. Fan-out happens at
write time so the read path is a single indexed scan on `(user_id, created_at)`:

| column | notes |
|---|---|
| `id` uuid pk | |
| `user_id` | recipient; the fan-out anchor |
| `organization_id` | nullable; org the notification belongs to, for org-scoped filtering |
| `app_id` | nullable; originating app/service |
| `type` | dotted event type, e.g. `billing.invoice.paid` |
| `category` | `system \| billing \| security \| app \| social` |
| `severity` | `info \| success \| warning \| error` |
| `title`, `body` | rendered text |
| `action_url`, `action_label` | optional deep link |
| `data` jsonb | structured payload for the client |
| `dedupe_key` | nullable; unique per user among live rows, so a retried producer cannot double-post |
| `read_at`, `seen_at`, `archived_at` | nullable timestamps — read/seen are different questions ("badge cleared" vs "opened") |
| `expires_at` | nullable; swept |
| `created_at` | |

Indexes: `(user_id, created_at desc)`, a partial `(user_id) where read_at is null`
for the badge count, `(organization_id, created_at desc)`, and a partial unique
`(user_id, dedupe_key) where dedupe_key is not null and archived_at is null`.

**`notification_preferences`** — `(user_id, category, channel)` → enabled, where
channel is `in_app | email | sms | push`. Absent row means the category default.
Only `in_app` is delivered by this service today; the other channels are
recorded so the existing email-service / sms-service can consume them without a
schema change later.

**`notification_deliveries`** — per-notification, per-channel delivery attempt
and status (`pending | sent | failed | skipped`), for the out-of-band channels.
Written but not yet driven; it exists so a delivery worker is an additive change.

### API

`/api/v1/notifications` (same-origin, proxied):

| method | path | notes |
|---|---|---|
| `GET` | `/` | paginated inbox; filters: `status`, `category`, `organizationId` |
| `GET` | `/unread-count` | the badge |
| `GET` | `/stream` | SSE; live push, heartbeat-kept |
| `POST` | `/:id/read`, `/read-all`, `/:id/unread` | |
| `POST` | `/seen` | badge-cleared, distinct from read |
| `DELETE` | `/:id` | archive |
| `GET`/`PUT` | `/preferences` | |
| `POST` | `/internal/publish` | **service-to-service only**, internal-token auth, fans out to recipients |

Every user-facing route reads `user_id` from the verified JWT and **never** from
the request — the inbox is inherently per-user, so there is no id in a path or
body that could be tampered into another user's mailbox. `/internal/publish` is
the one privileged route and is gated on the shared internal service token, the
same mechanism the existing internal routes use.

### Delivery

SSE, not WebSockets. The stream is one-directional server→client, the shell
already reloads on account switch (so a stale stream cannot outlive an identity),
and SSE survives the nginx/ingress path without an upgrade dance. Reconnection is
the browser's built-in `EventSource` retry; the client re-fetches the unread
count on reconnect so a missed event during a drop self-heals.

### Client

`NotificationBell` in the shell: badge from `unread-count`, panel listing recent
notifications with per-item read/archive, "mark all read", and an `EventSource`
subscription that prepends live arrivals. Fails quiet — a notification service
that is down must degrade to an empty bell, never to a broken shell.
