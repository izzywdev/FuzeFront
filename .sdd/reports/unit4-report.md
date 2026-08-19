# Unit 4 Report — chat-service Foundation

## What Was Built

Scaffolded `services/chat-service` — the Express microservice foundation for the AI chat RAG
feature. No RAG/agent/LLM logic (later units).

### Files Created

```
services/chat-service/
  package.json              @fuzefront/chat-service 1.0.0, private:true
  tsconfig.json             mirrors email-service
  jest.config.js            mirrors email-service (ts-jest, roots: tests/)
  Dockerfile                multi-stage node:18-alpine, user chatservice, PORT=3006
  src/
    config.ts               loadConfig() — all env vars from Helm template + REDIS_URL
    index.ts                bootstrap: loadConfig, createApp, listen, SIGTERM/SIGINT
    app.ts                  createApp(): express.json(), GET /health (unauthenticated)
    db/
      knexfile.ts           dev (ts migrations), production (dist migrations), fuzefront_platform
      index.ts              exports configured knex instance `db`
      migrations/
        001_create_chat_tables.ts  all 4 tables — exact SQL from plan §6e
    middleware/
      auth.ts               stateless JWT verify, req.userId + req.orgId from token claims
      ratelimit.ts          express-rate-limit 7.x + rate-limit-redis 4.x; 3 factory fns
  tests/
    tsconfig.json           mirrors email-service tests tsconfig
    app.test.ts             GET /health -> 200 {status:'ok', service:'chat-service'}
    middleware/
      auth.test.ts          5 cases: no token, wrong sig, expired, valid, valid+orgId
      ratelimit.test.ts     20 allowed + 21st -> 429; constructors don't throw (null Redis)
    db/
      migration.test.ts     exports up/down (always); live round-trip (skipped: no DB)
```

`lerna.json` packages array updated: `services/chat-service` added (no change to root workspaces,
matching email-service pattern).

## Helm Template Env Var Matching

Checked `deploy/helm/fuzefront/templates/chat-service.yaml`. All vars the template sets are
read by `config.ts`:

| Helm env var | config.ts reads | Status |
|---|---|---|
| `PORT` | `process.env.PORT` | MATCH |
| `LITELLM_URL` | `process.env.LITELLM_URL` | MATCH |
| `CHROMA_URL` | `process.env.CHROMA_URL` | MATCH |
| `BACKEND_URL` | `process.env.BACKEND_URL` | MATCH |
| `PERMIT_PDP_URL` | `process.env.PERMIT_PDP_URL` | MATCH |
| `KAFKA_BROKERS` | `process.env.KAFKA_BROKERS` | MATCH |
| `DB_HOST` | `process.env.DB_HOST` | MATCH |
| `DB_PORT` | `process.env.DB_PORT` | MATCH |
| `DB_NAME` | `process.env.DB_NAME` | MATCH |
| `DB_USER` | `process.env.DB_USER` | MATCH |
| `DB_PASSWORD` | `process.env.DB_PASSWORD` | MATCH |
| `JWT_SECRET` | `process.env.JWT_SECRET` | MATCH |
| `ANTHROPIC_API_KEY` | `process.env.ANTHROPIC_API_KEY` | MATCH |
| `OPENAI_API_KEY` | `process.env.OPENAI_API_KEY` | MATCH |
| `LITELLM_MASTER_KEY` | `process.env.LITELLM_MASTER_KEY` | MATCH |

**Mismatch: `REDIS_URL` is NOT set by the Helm template.**
The ratelimit middleware reads `process.env.REDIS_URL` and falls back to
`redis://redis.fuzeinfra.svc.cluster.local:6379` (the FuzeInfra Redis default from values.yaml).
Since the Helm template does not explicitly set `REDIS_URL`, the service will use the
hardcoded default, which is correct for the fuzeinfra namespace. No template edit needed — the
default is sensible. A future Helm improvement could make it explicit via
`{{ printf "redis://%s:%d" .Values.fuzeinfra.redis.host .Values.fuzeinfra.redis.port }}`.

## Auth Middleware Design

`src/middleware/auth.ts` is stateless — no DB lookup, no `users` table dependency. It:
- Extracts `Authorization: Bearer <token>` header.
- Calls `jwt.verify(token, JWT_SECRET)` (HS256 default).
- Sets `req.userId` and optionally `req.orgId` from token claims.
- Returns 401 for missing, invalid, or expired tokens.
- Strips all `console.log` noise present in `backend/src/middleware/auth.ts`.

## DB Migration

`001_create_chat_tables.ts` uses the exact SQL from plan §6e via `knex.raw()`:
- `chat_conversations` (FK → users + organizations)
- `chat_messages` (FK → chat_conversations ON DELETE CASCADE; role CHECK constraint)
- `chat_audit_log` (permit_decision CHECK constraint)
- `chat_feedback` (FK → chat_messages ON DELETE CASCADE; rating CHECK constraint)

`down()` drops in reverse FK order: feedback → audit_log → messages → conversations.

## Rate-Limit Design

Three factory functions (§10f):
- `createChatStreamLimiter()` — 20/min (SSE stream)
- `createConfirmLimiter()` — 60/min (tool confirm ACKs)
- `createGlobalLimiter()` — 100/min (all authenticated routes)

Key generator: `req.userId ?? req.ip`. Redis client injected for testability (null = in-memory
store). If the live Redis connection fails at startup, the limiter silently degrades to in-memory
(no crash). `lazyConnect: true` on ioredis prevents blocking startup.

## Verification

### `tsc --noEmit`
```
Exit code: 0 (clean)
```

### `npx jest`
```
Test Suites: 4 passed, 4 total
Tests:       2 skipped (live-DB migration), 11 passed, 13 total
Time:        ~4 s
```
Live-DB tests skipped because `DB_HOST`/`TEST_DB_URL` are not set in this environment.
The migration module's `up` and `down` export shape are asserted in all environments.

### Docker
Docker Desktop not available in this environment. Dockerfile mirrors email-service's working
multi-stage structure exactly (same base image, same pattern, adapted paths and user/port).

## Dependency Notes

`rate-limit-redis` and `ioredis` were added to root `node_modules` via `npm install --save-dev`
from the root directory. The root `package.json` was restored to its original state (those
dev-dep additions were reverted). The packages remain available in root `node_modules` (present
in `package-lock.json` as resolved) and resolve correctly for the non-workspace service at test
time via Node's module resolution walk-up.

For a clean reproducible build (Dockerfile), the `npm ci` step in the build stage must install
these packages. The chat-service `package.json` declares them as `dependencies`, so they will be
installed by `npm ci --workspace=services/chat-service` once the service is added to root
workspaces or installed standalone.
