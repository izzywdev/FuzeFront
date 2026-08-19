# Plan D — provisioning-service

**Date:** 2026-06-19
**Status:** Implementing

---

## Capability + hard requirements

A thin Kafka → HTTP bridge: consume `identity.user.created`, call security-service
`POST /internal/provision` (idempotent, header-auth'd), emit poison messages to a DLQ,
retry 5xx with bounded exponential backoff.

Hard requirements:
- No DB, no domain logic. All provisioning logic stays in security-service.
- DLQ on schema-invalid / JSON-parse failure (Zod catch).
- Bounded retry-with-backoff (3 retries, 200ms base, 2× factor, max 2 s) on transient
  HTTP 5xx.
- `/health` for Kubernetes probes.
- Config via env vars / Helm chart Secret — zero hardcoded secrets.
- Mirror email-service TS/Dockerfile/jest/Helm/lerna/skaffold/release structure.

---

## Library & Architecture Review

### Kafka consumer

| Option | Fit | Notes |
|---|---|---|
| `TypedConsumer` from `@fuzefront/shared` | Full | Project-native; DLQ wired in; already used by email-service / sms-service. **Adopted.** |
| Raw `kafkajs` | Full | More boilerplate; no DLQ helper. Runner-up if shared consumer ever becomes a bottleneck. |
| `kafkajs` with `kafkajs-retry` lib | Overkill | Retry belongs at the HTTP layer here, not the Kafka layer — topic offset only moves after a commit, and the endpoint is idempotent. |

**Recommendation: adopt `TypedConsumer`** — it handles DLQ, JSON parse failures, and Zod validation in one place.

### HTTP client with retry

| Option | Fit | Notes |
|---|---|---|
| `axios` + `axios-retry` | Good | Familiar, explicit retry config. |
| `node-fetch` + custom retry | Minimal | Less config surface; bespoke but tiny for 3 retries. |
| `got` with built-in retry | Good | More config knobs than needed. |
| Native `fetch` (Node 18+) + custom | Good | Zero deps. Chosen — Node 18 built-in `fetch` + a 30-line retry wrapper is the lightest option and matches Node version in all service Dockerfiles. |

**Recommendation: native `fetch` + bespoke `retryWithBackoff`** — no extra dependency, easily mockable in tests.

---

## Componentization decision

**Standalone microservice** (`services/provisioning-service`). Rationale:
- Independent lifecycle from security-service; can scale/restart independently.
- Consumer-only: no DB, no routes except `/health`.
- Already established pattern in the repo (email-service, sms-service).

Public interface: none (no ingress, no API). Internal interface: reads from
`identity.user.created`, writes failures to `identity.user.created.dlq`.

---

## Implementation plan (bite-sized)

1. **`services/provisioning-service/`** — mirror email-service structure.
2. **`src/config.ts`** — `loadConfig()` reads `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `SECURITY_SERVICE_URL`, `INTERNAL_PROVISION_SECRET`, `PORT`.
3. **`src/provision.ts`** — `callProvision(userId, config)`: `fetch` with `x-internal-secret` header, `retryWithBackoff` on 5xx, throws on 4xx.
4. **`src/handler.ts`** — `handleUserCreated(event, deps)`: validates event, calls `callProvision`, logs result. Deps interface for test injection.
5. **`src/app.ts`** — Express `/health` endpoint.
6. **`src/index.ts`** — wires Kafka consumer + Express server + graceful shutdown.
7. **`tests/`** — unit tests: success, 5xx-retry, DLQ-on-invalid, no-double-call.
8. **Helm**: `deploy/helm/fuzefront/templates/provisioning-service.yaml`, values block, prod overlay entry.
9. **GitOps**: `lerna.json`, `skaffold.yaml`, `release.yml`, `values-prod.yaml`.

---

## Security-service in-cluster URL

From `deploy/helm/fuzefront/templates/security.yaml`:
- Service name: `fuzefront-security`
- Port: `3002` (`.Values.securityService.port`)

Therefore: `SECURITY_SERVICE_URL=http://fuzefront-security:3002`
