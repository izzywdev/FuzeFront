# Runbook — Selection Lists seeding: enabling it safely, watching it, backing out

**Status: PREPARED, NOT APPLIED.** Seeding is OFF everywhere and nothing in this runbook has been
executed. The selection-list-service is not even deployed in production yet
(`selectionListService.enabled: false` in `deploy/helm/fuzefront/values-prod.yaml`). This page is
the checklist to follow when that changes; it describes the code on `master` as read at the
commit noted in the footer, and marks every statement that could not be verified from this repo.

Companions: the master-flag ramp is [`selection-lists-flag-rollout.md`](selection-lists-flag-rollout.md);
onboarding an app's Authentik client is [`selection-lists-seed-clients.md`](selection-lists-seed-clients.md);
what an app sends/receives is [`../guides/SELECTION_LIST_EVENTS.md`](../guides/SELECTION_LIST_EVENTS.md);
design is [`../planning/selection-lists-events.md`](../planning/selection-lists-events.md).

> **Production is GitOps.** Nothing here is a license to hand-deploy or `kubectl apply`. Every
> change below lands by merged PR, a dispatched workflow, or an Unleash toggle. Read-only
> diagnostics (queries, topic describes) need whoever holds access; infra changes (Kafka topics,
> brokers) are delegated to FuzeInfra via `@fuze` — never edited from this repo.

## 1. What you are operating

| Piece | Where | Notes |
|---|---|---|
| Two release flags (both default OFF, fail closed) | Unleash | `fuzefront.selection-lists.service` (master) **and** `fuzefront.selection-lists.seed-defaults`. Seeding needs **both** ON **for the org**; evaluated **per message**. Both are created OFF in Unleash by dispatching `prod-unleash-ops` with `flags=selection-lists-create` (create-only; see §3). |
| Platform seeding | consumer of `identity.org.created` | Always records the org in the projection (`selection_list_ref_index`); seeds `platform-defaults` v1 (`yes-no`, `priority`, `work-status`) only if both flags are ON and the org is active and of type `organization`/`personal`. |
| App seeding | consumer of `selection-lists.seed.requested` | Attested (token with scope `selection-lists:seed`), allowlisted (`seed-sources.json`), namespaced, capped, quota-checked, atomic. |
| Outcomes | `selection-lists.seed.completed` / `.failed` | Published through the transactional outbox (`event_outbox`). |
| Allowlist | `services/selection-list-service/seed-sources.json` | Reviewed PR; validated at boot (invalid ⇒ the service **refuses to start**); synced to `selection_list_seed_sources`. Ships with **only** `platform`. |
| Ledger | `selection_list_seed_ledger` | One row per applied `(org, source, pack key, version)`: the idempotency record. |

Consumers always run when Kafka is configured; the flags are checked inside the handlers. So
"flag OFF" never means "consumer stopped": it means every message is refused (`SEEDING_DISABLED`
for app requests) or skipped (platform defaults), and the offset commits.

## 2. Prerequisites checklist — ALL must hold before the first flag flip

Tick each with evidence (command output, run URL, PR) in the issue that requests the enablement.

### 2.1 Service is deployed and healthy

- [ ] The SealedSecret `selection-list-secrets` (key `DB_PASSWORD`, the service's **own** role
      password) is minted and sealed via `rotate-sealed-secret.yml`
      (`scope=fuzefront/selection-list-secrets key=DB_PASSWORD
      manifest=deploy/contabo/sealed/selection-list-secrets.yaml`), PR merged. **Verified absent
      today:** `deploy/contabo/sealed/` holds only `selection-list-service-secrets.yaml.template`.
      See [`per-service-database-and-role.md`](per-service-database-and-role.md).
- [ ] The same Secret also carries `SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET` — the service's
      own `client_credentials` identity (scope `authz:admin`) used to write list-owner grants.
      Without them list creation / access grants **fail closed** (`values-prod.yaml` comments;
      `src/lib/machineIdentity.ts`). The secret value is Authentik-issued, so it cannot be sealed
      with `rotate-sealed-secret.yml`; use the FuzeInfra `credential-handoff.json` mechanism
      (delegate via `@fuze`), as described in the seed-clients runbook.
- [ ] In a **later** merge, `selectionListService.enabled: true` in `values-prod.yaml` (deploy
      window). Pod is Ready: `GET /ready` is 200; `GET /health` is 200.
- [ ] Boot log shows `Kafka lifecycle consumers started`, the outbox relay line
      `outbox relay started`, and the seed-pack/allowlist sync line (from `initSeeding`). If the
      log says `KAFKA_BROKERS unset - outbox relay disabled`, **stop**: events would pile up in the
      table and no outcome event would ever be delivered.
- [ ] The Unleash client is wired (`featureFlags.*` in `values-prod.yaml`; the service calls
      `init()` at boot). If Unleash is unreachable every flag reads OFF — safe, but then a ramp
      step "does nothing".

### 2.2 Permit schema is synced — before the service enforces anything

- [ ] `SelectionListCatalog` (+ the tenant-role grants) exists in the target Permit environment.
      The definition is `backend/src/permit/schema.ts`; the **backend pushes it at boot**
      (`syncPermitSchemaFromRegistry`, `backend/src/index.ts`; log
      `Permit schema synced (N resources, M roles…)`, status served on the backend's
      `GET /health` → `permit`). Confirm that line / `outcome: ok` on the **currently deployed**
      backend. Whether the live Permit environment has it **cannot be verified from this repo**.
- [ ] Order is **Permit schema → service enforcement**, never the reverse: otherwise every caller
      loses list/create/resolve at once (fail closed).
- [ ] No tenant-role grants of `SelectionList:*` actions remain in the Permit environment
      (`docs/planning/selection-lists-permit-actions.md` §6).

### 2.3 Kafka topics actually exist, with the intended settings

The chart declares the topics (`kafkaTopics.topics` in `values.yaml`), but the pre-creation Job is
**DISABLED in production** (`kafkaTopics.enabled: false` in `values-prod.yaml`, because the hook
wedged Argo syncs). So in prod the topics are **not created by the chart**, and anything not
created explicitly relies on **broker auto-create**, which uses *broker defaults* for partitions
and retention (not the values below). That matters most for one topic: `selection-lists.seed.requested`
carries bearer tokens and its intended retention is **1 day**; an auto-created topic would keep
them for the broker default.

- [ ] Describe each topic on the broker (read-only; from a Kafka pod or client with access to
      `fuzeinfra-kafka.fuzeinfra.svc.cluster.local:9092`) and compare with the chart:

      | Topic(s) | Partitions | Retention | Replication |
      |---|---|---|---|
      | `selection-lists.list.{created,updated,archived,deleted}`, `selection-lists.item.{created,updated,archived,deleted,reordered}`, `selection-lists.translation.{upserted,deleted}`, `selection-lists.access.{granted,revoked}`, `selection-lists.seed.{completed,failed}` | 3 | 7 d (`604800000` ms) | 1 |
      | `selection-lists.seed.requested` | 3 | **1 d** (`86400000` ms) | 1 |
      | `selection-lists.seed.requested.dlq` | 1 | **1 d** (`86400000` ms) | 1 |

      All with `cleanup.policy=delete`. Also required: `identity.org.created`, `identity.org.deleted`,
      `identity.user.deleted` and their `.dlq` (declared in the chart's identity block).
      ```sh
      kafka-topics.sh --bootstrap-server fuzeinfra-kafka.fuzeinfra.svc.cluster.local:9092 \
        --describe --topic selection-lists.seed.requested
      ```
- [ ] Anything missing or mis-configured is created/fixed **by FuzeInfra** (delegate via `@fuze`
      with the table above), or by first making the chart Job non-blocking (drop the Helm hook
      annotations / bound it with `activeDeadlineSeconds`, per the comment in `values-prod.yaml`)
      and re-enabling it — a `devops-engineer` change, not a docs one.
- [ ] Note the **change-event DLQs are not declared in the chart** (`<topic>.dlq` for the 13
      published change topics and the two outcome topics): the relay writes to them on a parked
      event, so they rely on auto-create (or must be created) too. Decide deliberately.

### 2.4 Authentik seed clients and the allowlist (app seeding only)

Skip for platform-defaults-only pilots.

- [ ] One dedicated Authentik `client_credentials` client **per requesting service**, scope
      `selection-lists:seed` only, secret delivered to the requester's namespace — procedure in
      [`selection-lists-seed-clients.md`](selection-lists-seed-clients.md). Today **no client
      exists** and none has been minted.
- [ ] The requester's introspected token `subject` is known (introspect a real token; do not guess
      the format) and a reviewed PR adds the app to `seed-sources.json` (camelCase keys
      `app`, `allowedSubjects`, `keyPrefixes`, `maxListsPerRequest`, `maxItemsPerRequest`,
      `enabled`). The allowlist ships with the next service release.
- [ ] Both halves exist: a registered client **without** an allowlist row is refused
      `SOURCE_NOT_ALLOWED`; an allowlist row **without** a client can never produce a valid token.

### 2.5 Platform pack translations reviewed by native speakers

- [ ] `services/selection-list-service/seed-packs/platform/platform-defaults.v1.json` carries
      list names and item labels in 10 non-English locales (`es fr de pt ru zh ja hi ar he`).
      Seeding writes them with `is_machine: false` — i.e. they present as **human-reviewed**. The
      code cannot prove they are. Get a native-speaker review of every string.
- [ ] Do it **before** the first apply: **a pack version's content is immutable once applied
      anywhere** (a changed v1 is `PACK_CONTENT_MISMATCH`). Fixing a translation after rollout
      means shipping `platform-defaults.v2.json` — and with no backfill (§6) v2 reaches only orgs
      created afterwards.

### 2.6 The known gaps are accepted by the owner

- [ ] Read §6. Two former gaps are **fixed** and no longer need an owner decision: seeded lists now
      get a `list-owner` for the org owner (SL8, see §6), and the reconciler/backfill exists (SL7,
      off by default: set `SEED_RECONCILER_ENABLED=true`). What still needs a decision: an org
      whose `identity.org.created` carried **no `ownerId`** gets lists nobody can see until a grant
      is made through the Security API (the `selection_list_seed_owner_grant_skipped_total{reason="no-owner"}`
      counter tells you which), and **app-seeded** lists (`seed.requested`) are never granted by
      the service: the requesting app must grant through the Security API.

## 3. Flag ramp

Flip flags only through the family procedure: the [`unleash-flag-enable`](../../.claude/skills/unleash-flag-enable/SKILL.md)
skill, and for the master flag the dispatchable [`prod-unleash-ops`](../../.github/workflows/prod-unleash-ops.yml)
workflow (`flags=selection-lists`). Record the owner decision (who, target orgs, date) first.

**Two facts shape the ramp, both from code:**

1. **`prod-unleash-ops` can now CREATE `fuzefront.selection-lists.seed-defaults`, but not enable it.**
   Dispatch it with `flags=selection-lists-create`: that set creates **both** selection-list flags
   as `release` flags, OFF (environment disabled, no strategy), and is idempotent (an existing flag is
   left untouched). The `selection-lists` set (staged ramp, `rollout` / `action`) still covers only
   the master flag and is percentage-only, so **enabling `seed-defaults` still needs the raw
   per-org procedure in the `unleash-flag-enable` skill** (an `orgId IN [org_…]` constraint). Run the
   create step once, before step 0 of the table below. The live Unleash state of either flag is
   **not verifiable from this repo**: read the dispatch's *Verify* output.
2. **Seeding evaluates the flags with only `orgId` — no `userId`.** The context key is
   `orgId` = the org's `org_…` TypeID. A percentage rollout with `stickiness: default` buckets on
   the user, so with no user there is no stable bucket (**inferred** from Unleash semantics —
   verify on a non-prod Unleash before relying on it). Do **per-org targeting with an `orgId`
   constraint** (`IN [org_…]`) on `seed-defaults`, not a percentage. Likewise, if the master flag
   is at a partial percentage, its seeding-time evaluation has the same problem: pilot with the
   master flag at 100% or with the same `orgId` constraint.
   **Format caveat (code gap):** the HTTP path evaluates the master flag with the org claim from
   the JWT, which may not be the TypeID the seeding path uses; a constraint written for one
   format will not match the other. Check which format your tokens carry and include both if they
   differ.

Suggested order (each step: soak, run the §4 checks, then the next):

| Step | Action | Exit check |
|---|---|---|
| 0 | Prerequisites §2 all ticked. Both flags OFF. Service deployed. | `GET /ready` 200; no `seed.failed`/parked rows; outbox pending ≈ 0 |
| 1 | Master flag ON for the pilot org(s) (per `selection-lists-flag-rollout.md`), `seed-defaults` still OFF | HTTP behaves; `seed-defaults` OFF ⇒ a created pilot org is projected but **not** seeded (log: `seeding flag is OFF for this org`) |
| 2 | `seed-defaults` ON for **one** pilot org (`orgId` constraint), then create (or trigger) its `identity.org.created` | `seed.completed` (`outcome: applied`, `trigger: org-created`, three lists) on `selection-lists.seed.completed`; one ledger row; three `selection_lists` rows with `seed_source='platform'`, `created_by='system:selection-list-service'` |
| 3 | Verify the pilot org end to end (§4.3). The org owner holds `list-owner` on each seeded list (audit action `seed.owner-granted`); other members see nothing until granted | Sign in as the org owner, confirm the three lists render, items resolve in the pilot's locales. No `list-owner` for the owner ⇒ check `selection_list_seed_owner_grants_total{result="failed"}` and the machine identity |
| 4 | Add a few more orgs to the constraint; repeat step 3 on one | zero unexplained `seed.failed`, outbox healthy |
| 5 | Add the first allowlisted **app** (PR + Authentik client), have it send one `seed.requested` for the pilot org | `seed.completed` with its `requestId`; a deliberately bad request (wrong key prefix) returns `NAMESPACE_VIOLATION` |
| 6 | Widen to all orgs only after the owner accepts §6; the flag's removal criterion is 30 days at 100% with zero `seed.failed`, **and** a backfill (the SL7 reconciler, `SEED_RECONCILER_ENABLED=true`) | — |

Enabling the flag does **not** seed existing orgs (no reconciler). A pilot org must either be
created after the flag is ON, or have its `identity.org.created` re-delivered — a replay is
**not a supported operation** and is untested; the handler is idempotent (projection upsert +
ledger), so it is expected to be safe, but treat that as **inferred**.

## 4. Monitoring

### 4.1 Metrics (Prometheus, `GET /metrics`, scraped via the chart's metrics annotations)

| Metric | Meaning | Action |
|---|---|---|
| `selection_list_outbox_failed` | rows parked as `failed` (dead-lettered) | **alert when > 0** (source comment: "ALERT when > 0") |
| `selection_list_outbox_parked_total{topic,reason}` | parks, by `max_attempts` / `schema_invalid` | **alert on any increase** |
| `selection_list_outbox_pending` | rows waiting to publish | sustained growth ⇒ relay stuck / Kafka down |
| `selection_list_outbox_oldest_pending_age_seconds` | age of the oldest pending row (0 when none) | alert on a threshold you choose (suggest minutes, not seconds — a head-of-line blocked org shows here) |
| `selection_list_outbox_publish_failures_total{topic}` | failed publish attempts (retried) | rate > 0 for long ⇒ Kafka/ACL/topic problem |
| `selection_list_outbox_published_total{topic}` | delivered | flat at 0 while changes happen ⇒ relay disabled |

The reconciler and the owner grants have their own counters (`selection_list_seed_reconciler_*`; `selection_list_seed_owner_grants_total{result=granted|failed}` - alert on any `failed` increase - and `selection_list_seed_owner_grant_skipped_total{reason}`). There are **no other seed-specific metrics.** The signals for seeding are the `seed.failed` events, the
ledger, and logs (messages `seed: request completed`, `seed: request refused (seed.failed recorded,
nothing written)`, `seeding flag is OFF for this org`, `attestation refused (ATTESTATION_INVALID)`,
`attestation could not be verified and the retry budget is exhausted`).

### 4.2 `seed.failed` events and DLQs

- **Subscribe to `selection-lists.seed.failed`** (any consumer group) and alert on
  `retryable: false` reasons — `SOURCE_NOT_ALLOWED`, `NAMESPACE_VIOLATION`, `PACK_CONTENT_MISMATCH`,
  `LIMIT_EXCEEDED`, `VALIDATION_ERROR` mean a requester is misconfigured and will not self-heal —
  and on any `INTERNAL_ERROR` (a fault persisted through 5 in-process attempts).
  `SEEDING_DISABLED` for an org you did **not** intend is also a finding.
- Outcome rows are also queryable from the service's own outbox for ~7 days (sent rows are pruned
  after 168 h, `OUTBOX_SENT_RETENTION_HOURS`). Read-only queries (**not executed in preparing this
  runbook** — column names are from the migrations; check them before relying on them):
  ```sql
  -- failures by reason and source, last 24 h
  SELECT payload->>'reason' AS reason, payload->'source'->>'app' AS app, count(*)
    FROM event_outbox
   WHERE topic = 'selection-lists.seed.failed' AND created_at > now() - interval '24 hours'
   GROUP BY 1, 2 ORDER BY 3 DESC;

  -- parked (dead-lettered) events — ALERT if any
  SELECT id, topic, organization_id, attempts, last_error, created_at
    FROM event_outbox WHERE status = 'failed' ORDER BY created_at DESC LIMIT 50;

  -- what has been applied where
  SELECT organization_id, seed_source, seed_key, version, trigger, request_id, applied_at
    FROM selection_list_seed_ledger ORDER BY applied_at DESC LIMIT 50;

  -- active orgs that never received the platform pack (the missing-backfill worklist)
  SELECT r.wire_id, r.org_type, r.updated_at
    FROM selection_list_ref_index r
   WHERE r.entity_type = 'organization' AND r.status = 'active' AND r.is_active IS NOT FALSE
     AND r.org_type IN ('organization', 'personal')
     AND NOT EXISTS (SELECT 1 FROM selection_list_seed_ledger l
                      WHERE l.organization_id = r.wire_id
                        AND l.seed_source = 'platform' AND l.seed_key = 'platform-defaults');
  ```
- **DLQs.** `selection-lists.seed.requested.dlq` holds a request that failed schema parsing (the
  handler writes a copy with `attestation.token` replaced by `[REDACTED]`) or was not valid JSON
  at all (dead-lettered verbatim by the shared consumer — **this copy can contain the raw
  token**; that is why its retention must really be 1 day, §2.3). `<topic>.dlq` for a published
  topic holds a parked outbox event: `{ raw: { eventId, topic, organizationId, correlationId,
  attempts, payload }, reason, parkedAt }`. Any message there needs a human: find why, fix, and
  re-send the *request* (requests) or have consumers refetch over HTTP (events — a parked event
  shows up to consumers as a `listRevision` gap).

### 4.3 After each enable step, verify the actual state (not just the flag)

1. The `seed.completed` event for the org exists with the expected `outcome`/`appliedVersion`.
2. `selection_list_seed_ledger` has the row; `selection_lists` has the lists with
   `seed_source`/`seed_key` set, `seed_user_modified = false`.
3. A real read through the API **after** granting an owner (HTTP lists are filtered per list):
   `seed` is non-null, `created_by` is `system:selection-list-service`, translations resolve for
   the pilot locales.
4. Outbox: `pending` back to ~0, `failed` = 0.

## 5. Rollback

**Seeding off — immediate, per org, no deploy.** Turn `fuzefront.selection-lists.seed-defaults`
OFF for the org(s) (or remove the org from the `orgId` constraint); the flag is read per message,
so the next message is already refused/skipped. Turning the **master** flag OFF stops seeding
too, *and* 404s the whole HTTP surface (the master rollback in
[`selection-lists-flag-rollout.md`](selection-lists-flag-rollout.md)). Unleash unreachable also
reads OFF (fail-safe).

**One app off:** set `enabled: false` for its row in `seed-sources.json` (PR + release; its
requests then get `SOURCE_NOT_ALLOWED`) and/or delete its Authentik provider (outstanding tokens
expire within the hour).

What the flag **does not** undo — rollback is forward-only for data:

- Seeded lists, items, translations, ledger rows, audit rows and already-published events all
  **stay**. Disabling stops *new* seeding only. Removing seeded content is a separate, deliberate
  data change (a migration or support operation) that this runbook does not define; users with
  `list-owner` can archive/purge individual lists through the API, which marks them
  `user_modified`.
- Requests that arrived while OFF were **consumed and refused** (`SEEDING_DISABLED`, offset
  committed): they are **not** replayed when the flag turns back ON. Requesters must re-send.
- `identity.org.created` events handled while OFF were projected but not seeded, and are never
  backfilled (§6).
- Change events and outcome events keep flowing regardless (publishing is not flagged). To stop
  *all* publishing, remove `KAFKA_BROKERS` from the deployment (the relay then disables itself and
  events wait in `event_outbox`) — an emergency measure; consumers also stop.

## 6. Known gaps — read before enabling, do not paper over

Originally checked against `origin/master` @ `0e70bcee`; rows marked **FIXED (SL8)** were re-verified
against the SL8 branch (`claude/sl8-fixes`) and stay in the table as a record, not as open work.

| Gap | Evidence | Consequence | Owner |
|---|---|---|---|
| ~~**Reconciler / backfill is not built**~~ **FIXED (SL7)** | `src/seed/reconciler.ts` (`runReconcilerOnce` / `startReconciler`; `SEED_RECONCILER_ENABLED=true`, default OFF) | Orgs created while a flag was OFF, and pack upgrades, are backfilled once seeding is ON for the org. It also heals a missing owner grant (SL8) | done |
| ~~**No `identity.org.updated` consumer**~~ **FIXED (SL8)** | `src/events/org-updated.handler.ts`, consumer group `${KAFKA_GROUP_ID}-org-updated`, DLQ `identity.org.updated.dlq`; tests `events.org-updated.db.test.ts` | The projection's `is_active` / `type` / `name` follow the org; flag-independent; never resurrects a tombstone; an older snapshot never overwrites a newer one. A deactivated org is no longer seeded/backfilled | done |
| ~~**Seeded lists have no list-owner**~~ **FIXED (SL8)** | `src/seed/ownerGrants.ts`, called at the end of `applyPlatformDefaults` (org-created handler **and** reconciler); migration 10 adds `selection_list_ref_index.owner_id` | The org owner (`identity.org.created.ownerId`, stored as `usr_…`) gets `list-owner` on every active platform-seeded list via the service's machine identity (fail closed), after the seed transaction commits; idempotent; a grant failure throws so the message is retried (and the reconciler re-selects the org); audit action `seed.owner-granted`. **Remaining limits:** an org with **no `ownerId`** is skipped (log + `selection_list_seed_owner_grant_skipped_total{reason="no-owner"}`); a human's later demotion/revocation is respected (never re-granted); **app-seeded** lists (`seed.requested`) get **no** grant: the requesting app must grant through the Security API (the frozen `seed.requested` schema carries no owner); other members and tenant admins still see nothing until granted | done (owner-less orgs: support) |
| **User-scoped lists unsupported** | `scope: 'user'` ⇒ `SCOPE_UNSUPPORTED` | per-user seeding cannot be offered | — |
| ~~**`seed-defaults` does not exist in Unleash**~~ **FIXED (create only)** | `prod-unleash-ops` `flags=selection-lists-create` creates `fuzefront.selection-lists.seed-defaults` and the master flag OFF (create-only; never enables) | Dispatch it once after merge. **Still open:** the workflow cannot ENABLE `seed-defaults` and its ramp strategy is percentage-only; per-org targeting (`orgId IN [org_…]`) is the raw `unleash-flag-enable` procedure | `feature-flags-engineer` |
| ~~**Org-id format in flag context**~~ **FIXED (SL8)** | `buildFlagContext` in `src/flags.ts` canonicalises `orgId` / `userId` to the wire TypeID (`org_…` / `usr_…`; a bare UUID claim is converted with the identity codec) for EVERY evaluation; test `flags.canonical-context.test.ts` | Write Unleash `orgId` constraints in the **`org_…`** form: it now matches the seeding paths and the HTTP paths alike. A constraint written with a bare UUID will match neither | done |
| ~~**Request bodies looser than the spec; `limit=0` accepted; resolve accepted non-`front_sli_` ids**~~ **FIXED (SL8)** | `acceptOnlyBodyProps` / `parseLimitParam` in `src/middleware/validateInput.ts`; `POST /v1/resolve` validates `ids`; tests `routes.request-validation.db.test.ts` + the acceptance suite | Undeclared body properties, `limit<1`, cross-type/duplicate/empty resolve ids and an unsupported locale are `400 VALIDATION_ERROR`. **Behaviour change for callers:** `POST /v1/resolve` with `ids: []` is now `400` (spec `minItems: 1`), not an empty `200` | done |
| ~~**Port mismatch (service default 3011 vs chart 3008)**~~ **FIXED service-side (SL8)** | `src/index.ts` default, `Dockerfile` `ENV PORT`/`EXPOSE` and the docs now say `3008` (the chart already set `PORT` from `selectionListService.port`, so the deployed pod was never affected) | Local runs / the image default agree with the chart. **Still `3011`:** the OpenAPI `servers` example (frozen contract; its Helm copy `deploy/helm/fuzefront/files/selection-list-service-openapi.yaml` must stay byte-identical, so amend both in a contract PR), the `fuzefront-selection-list-client` Python README/docstring base URL, and CI's explicit `PORT: '3011'` (harmless) | `contract-designer` (spec), `docs-maintainer` (py README) |
| **Prod topic pre-creation is disabled** | `kafkaTopics.enabled: false` in `values-prod.yaml` | topics may be auto-created with broker defaults; token retention on `seed.requested`/`.dlq` not guaranteed to be 1 d; change-event DLQs undeclared | `devops-engineer` / FuzeInfra via `@fuze` |
| **Service not deployed; secrets not sealed** | `selectionListService.enabled: false`; no `selection-list-secrets.yaml` under `deploy/contabo/sealed/` | nothing above can run in prod yet | `devops-engineer` |
| **Allowlist has no app sources; no seed clients exist** | `seed-sources.json` lists only `platform`; seed-clients runbook is scaffolding | every app request is `SOURCE_NOT_ALLOWED` | per onboarding PR |
| **Platform pack translations unreviewed (as far as the repo can show)** | `is_machine: false` is written for all of them | see §2.5 | owner / translators |
| **`selection_list_access` mirror lags self-grants** | a Security-API-only grant is not mirrored until the service reconciles | the roster (`GET …/access`) can omit an admin's self-granted owner | `backend-engineer` |

## 7. Quick triage

| Symptom | Likely cause | First check |
|---|---|---|
| App gets `SEEDING_DISABLED` | a flag OFF for that org (either one) | both flags for the `org_…` id; constraint format |
| App gets `SOURCE_NOT_ALLOWED` | no/disabled allowlist row, or token subject ≠ `allowedSubjects` | `seed-sources.json` vs the real introspected `subject`; was the release deployed? |
| App gets `ATTESTATION_INVALID` | expired/revoked token, or scope missing | introspect the token; does the client's scope mapping emit `selection-lists:seed`? |
| `ORG_UNKNOWN` | the org's `identity.org.created` has not been consumed | consumer group lag on `identity.org.created`; topic exists? |
| No outcome event at all | request never consumed, or outcome stuck in the outbox | `selection_list_outbox_pending` / oldest age; consumer group lag on `selection-lists.seed.requested`; topic name |
| `selection_list_outbox_failed` > 0 | events parked after 10 failed publishes or schema drift | `last_error` on the `failed` rows; the `<topic>.dlq` copy |
| `INTERNAL_ERROR` | DB/Security API fault outlasted 5 attempts | service logs around the `requestId`; Security API health (token introspection) |
| Platform pack missing for an org | created while a flag was OFF, or `appliesTo` excludes its type (`platform` org), or inactive | the §4.2 "never received" query; the reconciler (`SEED_RECONCILER_ENABLED=true`) repairs it once seeding is ON for the org |

---

*Verified against `origin/master` @ `0e70bcee` (2026-10-04): service code under
`services/selection-list-service/src/{events,seed}`, `seed-sources.json`, `seed-packs/`,
`deploy/helm/fuzefront/values{,-prod}.yaml`, `.github/workflows/prod-unleash-ops.yml`,
`backend/src/permit/schema.ts`. Not verifiable from this repo: live Unleash/Permit/Kafka state.*
