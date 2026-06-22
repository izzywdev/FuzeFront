# API Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opaque, hashed-at-rest API tokens to FuzeFront — both personal access tokens (PAT, acting as the owning user) and org/service tokens (acting as an org principal, surviving user offboarding). Tokens integrate into the existing auth middleware (`backend/src/middleware/auth.ts`) alongside JWT, are scoped through the existing Permit.io policy layer, and are managed via a new section of `@fuzefront/identity-ui`.

**Architecture:** All token logic lives inside `backend/` (new route `backend/src/routes/api-tokens.ts`, new migration `009_create_api_tokens_table.ts`, token service `backend/src/services/api-token.ts`, middleware extension in `auth.ts`). No new microservice is warranted — tokens are a first-class backend concern with no independent scaling needs. The UI is entirely within `@fuzefront/identity-ui` (existing package). The Permit principal for a service token is a synthetic user keyed `svc_token:<token_id>`.

**Tech Stack:** Node 18, TypeScript, `crypto` (stdlib — Node built-in, zero-dependency), Knex 3, PostgreSQL, `permitio` 2.4 (already installed), `express-rate-limit` 7 (already installed).

---

## Capability & Hard Requirements

| Requirement | Detail |
|---|---|
| Token types | Personal Access Token (PAT) + Org/Service Token |
| Encoding | Opaque random bytes; never stored in plaintext |
| Hash algorithm | SHA-256 (see justification in §Library & Architecture Review) |
| Format | `ff_live_<22-char base62 prefix>.<43-char base64url body>` |
| Scopes | Subset of owner's Permit permissions; enforced per-request via Permit |
| Expiry | Configurable (nullable = no expiry for service tokens); `expires_at` stored |
| Revocation | Instant; `revoked_at` timestamp; sync scan on auth |
| last-used | Updated async (fire-and-forget UPDATE) on each successful verify |
| Created-by | UUID of the user who created the token |
| One-time display | Raw token shown once at creation; never retrievable again |
| Multi-tenancy | PATs scoped to the user's org(s); service tokens scoped to one org |
| Offboarding safety | Service tokens owned by the org; NOT cascade-deleted when creator leaves |
| Rate limiting | Max 10 failed token auth attempts / min per IP (use existing `express-rate-limit`) |
| Logging | Never log the raw token; log only `token_prefix` |
| Leaked-token scanning | Prefix-based; integrates with future secret-scanning pipeline |
| Expiry reminders | Optional: emit `notify.email.requested` Kafka event N days before expiry (requires email-service plan) |

---

## Library & Architecture Review

### Feature: API token hashing

**Hard requirements:**
- Lookup must be prefix-based (cheap index scan) before hash comparison.
- Tokens are 256+ bits of CSPRNG output — they are NOT passwords; dictionary/rainbow-table attacks are irrelevant.
- Throughput: every authenticated API request hits the hash comparison path. The hash must be fast.
- Zero new production dependencies preferred.

### Candidate Comparison

| Option | Fit | Maturity | License | Footprint | Security | Exit cost |
|---|---|---|---|---|---|---|
| **`crypto.createHash('sha256')` (stdlib)** | 100% — fast, CSPRNG tokens are already high-entropy | Node built-in, stable | N/A | 0 bytes added | Adequate for high-entropy tokens; NOT adequate for passwords | 0 |
| **`argon2` npm package** | Overkill — argon2 is designed for low-entropy secrets (passwords). For 256-bit random tokens SHA-256 provides equivalent security at ~1000× lower latency. | v0.31.2 (2024); active | MIT | native binary (node-gyp) | Best for passwords, wasteful here | Moderate (native binary CI pain) |
| **`bcrypt` / `bcryptjs`** | Already installed (`bcryptjs: ^2.4.3`). Same argument as argon2 — low-entropy design, slow by intent. | Stable | MIT | small | Good for passwords; irrelevant advantage here | Low |
| **`nanoid` or `uuid` for token generation** | Already have `uuid` v9. Can use `crypto.randomBytes` directly for the token body. | Stable | MIT | Tiny | Fine | Low |

**Recommendation: Build using Node `crypto` stdlib (SHA-256 + `crypto.randomBytes`).**

Rationale:
- API tokens are 256-bit CSPRNG output. An attacker who compromises the hash store must still brute-force 2^256 candidates; SHA-256 speed provides zero marginal advantage to them.
- argon2/bcrypt's intentional slowness protects against brute-force of LOW-entropy secrets (passwords). That attack vector is irrelevant here.
- Zero new dependencies: no `node-gyp`, no native binary in Docker image, no CI friction.
- If a future audit demands HMAC-SHA-256 or SHA3-256, it is a one-line change in `api-token.ts`.

**Runner-up:** `argon2` — switch to it only if FuzeFront ever stores ANY partially-guessable token material (e.g., user-chosen PINs embedded in tokens).

### Feature: Token management — build vs. adopt

Evaluated `passport-http-bearer`, `express-jwt`, and `oslo` (from Lucia auth). All are designed for JWT or OAuth bearer flows and do not provide opaque hashed token storage. Building the thin token layer ourselves is justified: it is ~200 lines, fits directly into the existing Knex/Permit/Express patterns, and has no lock-in.

### Componentization decision

| Unit | Decision | Justification |
|---|---|---|
| `backend/src/services/api-token.ts` | Inline in `backend/` | Token logic has no independent lifecycle/scaling from the backend itself. Second consumer would only be a future gateway, which would call the backend's REST API, not import the service. |
| `backend/src/routes/api-tokens.ts` | Inline in `backend/` | Follows identical pattern to `routes/auth.ts`, `routes/organizations.ts`. |
| `@fuzefront/identity-ui` UI components | Extend existing package | Token management pages/components slot naturally into the identity-ui micro-frontend alongside org and user settings. No new package boundary needed. |

---

## Data Model

### Migration `009_create_api_tokens_table.ts`

```ts
table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

// Lookup key — first 22 chars of base62 prefix; uniquely identifies token row
// without revealing the secret. Stored plaintext; used in WHERE clause.
table.string('token_prefix', 32).notNullable().unique()

// SHA-256 hex of the full raw token (64 hex chars)
table.string('token_hash', 64).notNullable()

// 'user' or 'org'
table.enu('owner_type', ['user', 'org']).notNullable()

// FK to users.id (PAT) or organizations.id (service token)
table.uuid('owner_id').notNullable()

// Human-readable label
table.string('name', 255).notNullable()

// Array of scope strings, e.g. ["App:read","App:install"]
// Validated at creation to be <= owner's current permissions
table.jsonb('scopes').notNullable().defaultTo('[]')

table.timestamp('expires_at').nullable()          // null = never expires
table.timestamp('last_used_at').nullable()
table.uuid('created_by').notNullable()            // always a user UUID
table.timestamp('revoked_at').nullable()          // null = active
table.timestamps(true, true)

// Indexes
table.index(['token_prefix'])                     // lookup path
table.index(['owner_type', 'owner_id'])           // list tokens for owner
table.index(['created_by'])
table.index(['expires_at'])                       // expiry sweep job
table.index(['revoked_at'])
```

**FK rules:**
- `owner_id` references `users(id)` when `owner_type = 'user'` — CASCADE DELETE (PAT dies with user).
- `owner_id` references `organizations(id)` when `owner_type = 'org'` — CASCADE DELETE (service token dies with org, NOT with creator).
- `created_by` references `users(id)` — SET NULL on delete (creator can be offboarded; token lives).

Because PostgreSQL polymorphic FKs require a trigger or deferred constraint, implement as CHECK + application-layer validation rather than a FOREIGN KEY constraint for `owner_id`. Document this in the migration comment.

---

## Token Format & Generation

```
ff_live_<PREFIX>.<BODY>
```

| Segment | Value |
|---|---|
| `ff_live_` | Fixed human-readable prefix (8 chars); enables secret-scanning grep/regex in logs, code, and CI |
| `<PREFIX>` | First 22 chars of base62-encoded `crypto.randomBytes(16)` — stored as `token_prefix` in DB |
| `.` | Separator |
| `<BODY>` | `crypto.randomBytes(32)` → base64url (43 chars) — combined with PREFIX for the hash input |

**Full token length:** `8 + 22 + 1 + 43 = 74 chars`

**Hash input:** `sha256(token_prefix + '.' + token_body)` — i.e., the canonical token string minus the `ff_live_` header. This lets the DB lookup scan by prefix first, then verify the full hash.

**Generation pseudocode:**
```ts
const prefixBytes = crypto.randomBytes(16)
const bodyBytes   = crypto.randomBytes(32)
const prefix      = base62(prefixBytes).slice(0, 22)
const body        = bodyBytes.toString('base64url')
const raw         = `ff_live_${prefix}.${body}`
const hashInput   = `${prefix}.${body}`
const hash        = crypto.createHash('sha256').update(hashInput).digest('hex')
// Store: token_prefix=prefix, token_hash=hash
// Return: raw (shown once to user, never stored)
```

---

## Verification Flow in `auth.ts`

Current `authenticateToken` only handles JWT. The updated function branches on token shape:

```
Authorization: Bearer <value>
  ├─ starts with "ff_live_" → API token path
  └─ else                   → existing JWT path (unchanged)
```

**API token verification steps:**
1. Parse prefix: extract the 22-char prefix segment after `ff_live_` and before `.`.
2. DB lookup: `SELECT * FROM api_tokens WHERE token_prefix = :prefix LIMIT 1` (indexed, fast).
3. If not found → 401 `Invalid token`.
4. Check `revoked_at IS NULL` → 401 `Token revoked` if set.
5. Check `expires_at IS NULL OR expires_at > NOW()` → 401 `Token expired` if past.
6. Compute `sha256(prefix + '.' + body)` from the raw bearer value.
7. Constant-time compare: `crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(computedHash))` — protects against timing side-channels.
8. Build `req.user` / set `req.apiToken` context (see §Principal Mapping below).
9. Fire-and-forget: `db('api_tokens').where('id', token.id).update({ last_used_at: new Date() })` — do NOT await; do NOT block the request.
10. Call `next()`.

**Security invariant:** Steps 1–7 must use constant-time operations where applicable. Never short-circuit after prefix lookup with a string comparison; always call `timingSafeEqual`.

---

## Principal Mapping into Permit

Permit's `permit.check(user, action, resource)` takes a string user key. API tokens produce principals as follows:

| Token type | `req.user.id` passed to Permit | Permit user synced as |
|---|---|---|
| PAT (`owner_type = 'user'`) | `owner_id` (the user UUID) | Existing user — already synced via `user-sync.ts`. Token scopes further narrow what Permit sees. |
| Service token (`owner_type = 'org'`) | `svc_token:<token_id>` (synthetic) | Synced on first use via `permit.api.users.sync({ key: 'svc_token:<id>', attributes: { is_service_token: true, org_id: owner_id } })` |

**Scope enforcement — two-stage:**
1. **Permit check** (existing): `checkPermission({ user: principalKey, action, resource })` — enforces what the owner has been granted in Permit.
2. **Scope gate** (new, in `api-token.ts`): after Permit allows, check `token.scopes.includes('<ResourceKey>:<action>')`. If the token's explicit scope list does NOT include the requested action, deny with 403 `Scope not granted by token`.

This means token scopes are a NARROWING mask on top of Permit: a token cannot grant MORE than the owner's Permit permissions. The scope check happens inside `requirePermission` (or a new `requireTokenScope` middleware wrapper) after the Permit check passes.

**Service token Permit role assignment:** When a service token is created for org `O`, the backend calls:
```ts
permit.api.roleAssignments.assign({
  user: `svc_token:<token_id>`,
  role: mapScopesToPermitRole(token.scopes), // 'viewer' | 'editor' | 'admin'
  tenant: token.owner_id,                    // the org UUID
})
```
`mapScopesToPermitRole` selects the minimal role whose permission set covers all requested scopes (viewer ⊆ editor ⊆ admin per `permitSchema`).

**Revocation propagation:** When `revokeToken` is called:
1. Set `revoked_at = NOW()` in `api_tokens`.
2. For service tokens: `permit.api.roleAssignments.unassign(...)` to remove the Permit role.
3. No cache invalidation required — the DB lookup on every request is the source of truth (tokens are not cached).

---

## Scope Model

Scopes mirror the existing Permit `<ResourceKey>:<action>` convention defined in `backend/src/permit/schema.ts`:

```
Organization:read   Organization:update  Organization:manage
App:read            App:create           App:update   App:delete   App:install   App:uninstall
UserManagement:view_members   UserManagement:invite   UserManagement:remove   UserManagement:update_role
```

**Scope validation at creation:**
1. Fetch `getUserPermissions(creatorUserId, orgId)` from Permit.
2. For PATs: scopes ⊆ creator's current Permit permissions. Enforced at creation AND re-checked at first use (permissions can shrink).
3. For service tokens: scopes ⊆ `owner.role`'s permission set at creation time.
4. Store the explicit scope list in `api_tokens.scopes` (JSONB).

**Scope display:** UI shows human-readable labels mapped from the `<Resource>:<action>` strings. Spec in §UI below.

---

## Management REST API

Mount at `app.use('/api/tokens', apiTokensRoutes)` in `index.ts`.

All routes require `authenticateToken` (JWT or existing valid API token) + ownership checks.

| Method | Path | Auth required | Description |
|---|---|---|---|
| `POST` | `/api/tokens` | JWT or PAT with `tokens:create` scope | Create PAT or service token |
| `GET` | `/api/tokens` | JWT | List caller's PATs (paginated, 50/page) |
| `GET` | `/api/organizations/:orgId/tokens` | JWT + `Organization:manage` | List org's service tokens |
| `DELETE` | `/api/tokens/:tokenId` | JWT + ownership or org manage | Revoke (sets `revoked_at`) |
| `GET` | `/api/tokens/:tokenId` | JWT + ownership | Get metadata (never raw token) |

**POST `/api/tokens` request body:**
```json
{
  "name": "CI deploy token",
  "owner_type": "user" | "org",
  "owner_id": "<uuid>",
  "scopes": ["App:read", "App:install"],
  "expires_at": "2027-01-01T00:00:00Z" | null
}
```

**POST `/api/tokens` response (201, ONE-TIME ONLY):**
```json
{
  "id": "<uuid>",
  "token": "ff_live_<prefix>.<body>",
  "token_prefix": "<prefix>",
  "name": "CI deploy token",
  "scopes": ["App:read", "App:install"],
  "expires_at": "2027-01-01T00:00:00Z",
  "created_at": "..."
}
```
The `token` field is ONLY present in the creation response. All subsequent GET responses omit it.

---

## Security Controls

| Control | Implementation |
|---|---|
| Hash at rest | SHA-256 hex in `token_hash` column; raw token never written to DB or logs |
| Constant-time compare | `crypto.timingSafeEqual` in verification step 7 |
| No plaintext logging | `auth.ts` logs only `token_prefix` (already the pattern for JWT `tokenPreview`). Prohibit logging `token`, `token_hash`, or anything after `ff_live_` |
| Leaked-token prefix scanning | `ff_live_` prefix enables trivial grep/regex in: git pre-commit hooks, GitHub secret scanning, SIEM alerts, log aggregators |
| Rate limiting | Apply `express-rate-limit` at the `/api/*` router level for token-auth failures: 10 req/min per IP; existing `express-rate-limit` v7 is already installed |
| Revocation | Instant: `revoked_at` checked on every request; no TTL/cache |
| Scope ≤ owner | Enforced at creation AND at request time (2-stage check) |
| Expiry | Checked server-side on every request; client clock is irrelevant |
| Service token orphan prevention | `owner_id` references `organizations.id`; `created_by` is SET NULL on user delete |
| Audit log | Every token creation/revocation writes a structured log line with `token_prefix`, `owner_id`, `actor_id`. Future: emit Kafka `identity.token.created/revoked` event for audit trail |

---

## Management UI (`@fuzefront/identity-ui`)

The UI lives in the identity-ui micro-frontend. Coordinate with the identity-ui plan for the exact page/route mount point. These are the component specs.

### Design system (fuse-seam)

All components extend existing tokens. No one-off styles.

| Token use | Purpose |
|---|---|
| `--color-surface-raised` | Token row background |
| `--color-text-danger` | Revoke button + expiry warning |
| `--color-accent-primary` | Create button, copy-to-clipboard icon |
| `--radius-md`, `--shadow-sm` | Card/modal chrome |
| Monospace: `--font-family-mono` | Token display in one-time reveal |

### Components

#### `<TokenCreateModal>`
- **Trigger:** "New token" button on the token list page.
- **Fields:** Name (required), Owner (user / org selector), Scopes (checkbox group with human labels), Expiry (date picker or "No expiry" toggle).
- **States:** Idle → Loading (POST in flight) → Success (one-time reveal) → Error.
- **One-time reveal state:** Full-width monospace input with copy-to-clipboard button; prominent warning banner: "This token will not be shown again. Copy it now." Dismiss closes modal; does NOT re-show token.
- **A11y:** `aria-modal`, focus trap, `aria-live="polite"` on success/error messages.

#### `<TokenList>`
- **Columns:** Name, Type (PAT / Service), Scopes (badge list, truncated), Expires (relative date or "Never"), Last used (relative date or "Never"), Actions.
- **Empty state:** "No tokens yet. Create one to get programmatic access."
- **Per-row actions:** Revoke (confirmation dialog with `aria-describedby`).
- **Scope badges:** Map `App:read` → "Read apps", `App:install` → "Install apps", etc.
- **Expiry warning:** Highlight row in `--color-text-warning` if `expires_at` within 14 days.

#### `<RevokeConfirmDialog>`
- Destructive action pattern from design system.
- States: Idle → Loading → Success (row removed) → Error (toast).

#### `<ScopeSelector>`
- Grouped checkboxes: Apps, Organization, User Management.
- Each scope shows resource + action in human language.
- Disables scopes outside owner's current Permit permissions (fetched at modal open).

---

## File Map

### New files — `backend/`
| File | Responsibility |
|---|---|
| `backend/src/migrations/009_create_api_tokens_table.ts` | Create `api_tokens` table with all columns + indexes |
| `backend/src/services/api-token.ts` | `generateToken()`, `hashToken()`, `verifyToken()`, `createToken()`, `revokeToken()`, `listTokens()`, `updateLastUsed()` |
| `backend/src/routes/api-tokens.ts` | Express router: POST /tokens, GET /tokens, DELETE /tokens/:id, GET /tokens/:id, GET /organizations/:orgId/tokens |

### Modified files — `backend/`
| File | Change |
|---|---|
| `backend/src/middleware/auth.ts` | Branch on `ff_live_` prefix; call `verifyToken()` from service; build `req.user` + set `req.apiToken` metadata; keep JWT path unchanged |
| `backend/src/types/express.d.ts` | Add `apiToken?: { id: string; scopes: string[]; ownerType: 'user' | 'org' }` to `Request` |
| `backend/src/types/shared.ts` | Export `ApiToken` interface matching DB columns |
| `backend/src/index.ts` | `app.use('/api/tokens', apiTokensRoutes)` |
| `backend/src/permit/schema.ts` | Add `ApiToken` resource + `create/read/revoke` actions for future fine-grained control (optional, phase 2) |
| `backend/src/utils/permit/user-sync.ts` | Add `syncServiceTokenToPermit(tokenId, orgId, role)` and `removeServiceTokenFromPermit(tokenId)` |

### New files — `@fuzefront/identity-ui`
| File | Responsibility |
|---|---|
| `frontend/identity-ui/src/components/tokens/TokenCreateModal.tsx` | Create + one-time reveal modal |
| `frontend/identity-ui/src/components/tokens/TokenList.tsx` | List with revoke actions |
| `frontend/identity-ui/src/components/tokens/RevokeConfirmDialog.tsx` | Destructive confirm dialog |
| `frontend/identity-ui/src/components/tokens/ScopeSelector.tsx` | Grouped scope checkbox component |
| `frontend/identity-ui/src/components/tokens/index.ts` | Barrel export |
| `frontend/identity-ui/src/pages/TokensPage.tsx` | Page wrapper, data fetching, error boundaries |
| `frontend/identity-ui/src/api/tokens.ts` | Typed fetch wrappers for all token endpoints |

### Test files
| File | What it covers |
|---|---|
| `backend/tests/services/api-token.test.ts` | `generateToken` format, `hashToken` determinism, `verifyToken` constant-time branch, `createToken` DB write, `revokeToken` sets revoked_at |
| `backend/tests/middleware/auth-api-token.test.ts` | Prefix branching, valid token → req.user set, expired token → 401, revoked token → 401, wrong hash → 401, timing-safe compare called |
| `backend/tests/routes/api-tokens.test.ts` | POST create (201 + token in body), GET list (no token in body), DELETE revoke, ownership enforcement |
| `frontend/identity-ui/src/components/tokens/__tests__/TokenCreateModal.test.tsx` | One-time reveal logic, copy button, dismiss hides token |
| `frontend/identity-ui/src/components/tokens/__tests__/TokenList.test.tsx` | Render with/without tokens, expiry warning highlight, revoke flow |

---

## Task Breakdown (TDD, bite-sized)

Each task: write failing tests first, implement to green, verify.

### Task 1: Migration — create `api_tokens` table
- [ ] Write `009_create_api_tokens_table.ts` (up + down)
- [ ] Run migration in test DB; verify schema with `\d api_tokens`
- [ ] Files: `backend/src/migrations/009_create_api_tokens_table.ts`

### Task 2: `api-token.ts` service — generation + hashing
- [ ] Write tests: `generateToken()` returns `ff_live_<22>.<43>` format; `hashToken()` is deterministic; prefix extraction works
- [ ] Implement `generateToken()`, `hashToken()`, `extractPrefix()`
- [ ] Files: `backend/src/services/api-token.ts`, `backend/tests/services/api-token.test.ts`

### Task 3: `api-token.ts` service — DB operations
- [ ] Write tests: `createToken()` inserts row + returns raw token once; `revokeToken()` sets `revoked_at`; `listTokens()` excludes revoked; `verifyToken()` returns token row or null
- [ ] Implement using Knex (inject db instance for testability)
- [ ] Files: same as Task 2

### Task 4: Update `auth.ts` — API token branch
- [ ] Write tests: bearer starting with `ff_live_` routes to token path; valid token sets `req.user`; expired/revoked/wrong-hash return 401; JWT path is unchanged
- [ ] Implement `ff_live_` branch in `authenticateToken`; add `req.apiToken` metadata to request type
- [ ] Files: `backend/src/middleware/auth.ts`, `backend/src/types/express.d.ts`, `backend/tests/middleware/auth-api-token.test.ts`

### Task 5: Update `auth.ts` — async last-used update
- [ ] Test: verify `updateLastUsed()` is called fire-and-forget (mock resolves after response)
- [ ] Implement fire-and-forget UPDATE; do NOT await
- [ ] Files: `backend/src/middleware/auth.ts`, `backend/src/services/api-token.ts`

### Task 6: Service token Permit sync
- [ ] Write tests: `syncServiceTokenToPermit()` calls `permit.api.users.sync` + `permit.api.roleAssignments.assign` with correct keys; `removeServiceTokenFromPermit()` calls `unassign`
- [ ] Implement; add to `user-sync.ts`
- [ ] Files: `backend/src/utils/permit/user-sync.ts`

### Task 7: REST routes — POST create token
- [ ] Write integration test: POST `/api/tokens` with valid JWT → 201 with `token` field; second GET → no `token` field
- [ ] Implement route: validate body, check owner permissions, call `createToken()`, call `syncServiceTokenToPermit()` for org tokens, return 201
- [ ] Files: `backend/src/routes/api-tokens.ts`, `backend/tests/routes/api-tokens.test.ts`

### Task 8: REST routes — GET list + DELETE revoke
- [ ] Write tests: GET returns array without `token_hash` field; DELETE → 204 + `revoked_at` set; non-owner DELETE → 403
- [ ] Implement list + revoke routes; add ownership middleware
- [ ] Files: same as Task 7

### Task 9: Mount routes in `index.ts` + Swagger annotations
- [ ] Add `app.use('/api/tokens', apiTokensRoutes)` in `index.ts`
- [ ] Add JSDoc `@swagger` annotations on all routes
- [ ] Files: `backend/src/index.ts`, `backend/src/routes/api-tokens.ts`

### Task 10: Rate limiting for token auth failures
- [ ] Write test: 11th failed token auth from same IP within 1 min → 429
- [ ] Apply `express-rate-limit` with `skip` logic (only count 401 responses from `ff_live_` path)
- [ ] Files: `backend/src/middleware/auth.ts` or new `backend/src/middleware/rate-limit.ts`

### Task 11: `@fuzefront/identity-ui` — API client
- [ ] Write tests: `createToken()`, `listTokens()`, `revokeToken()` call correct endpoints
- [ ] Implement `frontend/identity-ui/src/api/tokens.ts`
- [ ] Files: `frontend/identity-ui/src/api/tokens.ts`

### Task 12: `<ScopeSelector>` component
- [ ] Write tests: renders grouped checkboxes; disables scopes beyond owner permissions; emits correct scope array on change
- [ ] Implement using design system tokens
- [ ] Files: `frontend/identity-ui/src/components/tokens/ScopeSelector.tsx`

### Task 13: `<TokenCreateModal>` — form + one-time reveal
- [ ] Write tests: shows form initially; on success shows token with copy button; token NOT shown after dismiss
- [ ] Implement modal; copy-to-clipboard with `navigator.clipboard.writeText`
- [ ] Files: `frontend/identity-ui/src/components/tokens/TokenCreateModal.tsx`

### Task 14: `<TokenList>` + `<RevokeConfirmDialog>`
- [ ] Write tests: renders list; expiry-near rows have warning class; revoke opens dialog; confirm calls API + removes row
- [ ] Implement
- [ ] Files: `frontend/identity-ui/src/components/tokens/TokenList.tsx`, `RevokeConfirmDialog.tsx`

### Task 15: `<TokensPage>` — integration + routing
- [ ] Wire `TokensPage` into identity-ui routing; add nav link
- [ ] Write smoke test: page loads, shows empty state, Create button opens modal
- [ ] Files: `frontend/identity-ui/src/pages/TokensPage.tsx`, relevant identity-ui router file

### Task 16: Expiry reminder event (optional, requires Kafka/email-service plan)
- [ ] Implement a cron/scheduled job that queries `api_tokens WHERE expires_at BETWEEN now() AND now() + INTERVAL '14 days' AND revoked_at IS NULL` and emits `notify.email.requested` Kafka events
- [ ] Gated by `ENABLE_TOKEN_EXPIRY_REMINDERS=true` env var
- [ ] Files: `backend/src/jobs/token-expiry-reminder.ts`

---

## Verification Checklist

Before marking each task done, the implementing agent MUST verify:

- [ ] `npm test -- --testPathPattern=api-token` passes with no skipped tests
- [ ] No raw token string appears in any log output (grep `ff_live_` in test log output)
- [ ] `crypto.timingSafeEqual` is used in the verification path (grep `timingSafeEqual`)
- [ ] Migration `up` and `down` both execute without error against a test DB
- [ ] A token with `revoked_at` set returns 401 (not 403 or 500)
- [ ] A token past `expires_at` returns 401 with message `Token expired`
- [ ] A service token's Permit role is unassigned on revocation (mock verify)
- [ ] `token_hash` column is NEVER included in any API response (grep routes for `token_hash`)
- [ ] One-time reveal UI: after modal dismiss, re-opening token detail shows no `token` field

---

## Global Constraints

- TypeScript strict mode **off** for `backend/` (match existing — `"strict": false, "noImplicitAny": false`)
- Pin every new dependency to exact minor version; currently zero new deps needed
- All unit tests mock `db` (inject via function parameter) and `permit` (jest.mock)
- Secret: no new secrets required; uses existing `JWT_SECRET`, `PERMIT_API_KEY` env vars
- Never use `git --no-verify`
- Do NOT touch `frontend/` files outside `identity-ui/` package
- Do NOT modify existing migrations

---

## Open Questions

1. **Scope granularity for service tokens:** Should scopes be limited to the role enum (`viewer / editor / admin`) or support the full `<Resource>:<action>` string list? The plan opts for the full string list (more flexible) but requires `mapScopesToPermitRole` heuristic. Confirm with the team.
2. **Token auth caching:** At high request volumes, the DB lookup per token becomes a bottleneck. The plan intentionally avoids a cache (simplicity + instant revocation). If throughput exceeds ~500 token-authed req/s, add a short-TTL Redis cache keyed by `token_prefix` with a `revoked` sentinel. Revisit at that scale.
3. **Expiry reminder Kafka dependency:** Task 16 depends on the Kafka/email-service plan being merged first. If that plan is delayed, the reminder can alternatively be a simple cron that emails via the `email-service` HTTP API.
4. **Offboarding flow:** If a user who created a service token is deleted, `created_by` becomes NULL (SET NULL). The org admin should receive a notification to review orphaned service tokens. This is not implemented in this plan.
5. **`identity-ui` route mount point:** Confirm the exact URL (`/settings/tokens` vs `/account/tokens` vs per-org `/org/:orgId/tokens`) before Task 15. The component tree is agnostic to the mount point.
