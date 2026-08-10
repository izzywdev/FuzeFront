---
key: FF-EPIC-18
title: Configuration Trust & Operations — secrets, audit, change events, and portability
label: [fuzefront, platform, config-management, contract-first, permit-gated, security, needs-jira-upload]
github: TBD
jira: FFRNT-151
status: ready
priority: High
domain: Platform
---

## 🎯 Epic: Configuration Trust & Operations

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-18 |
| **Domain** | Platform |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `backend-engineer` + `security` + `test-engineer`) |
| **Target Release** | Next deploy window (post FF-EPIC-17) |
| **Effort Estimate** | L |

---

### 📌 Problem Statement
> FF-EPIC-17 delivers a config store that resolves values correctly, but a config store nobody can
> audit, that silently serves stale values to running services, that cannot hold an API key, and that
> cannot be exported is not usable for the things configuration is actually used for. Org-level settings
> change who can do what — without an audit trail there is no answer to "who turned this off". Services
> cache resolved config — without change events they keep serving the old value indefinitely after an
> admin "fixed" it, which is worse than not letting them change it at all. And every real tenant
> onboarding needs to copy a known-good configuration rather than re-enter forty settings by hand.

### 🎯 Goal
> Configuration is trustworthy and operable: every change is attributable and revertible, secret values
> are encrypted and never disclosed in bulk, consumers learn about changes instead of caching them
> forever, apps declare their key catalog from code rather than by hand, and a scope's configuration can
> be exported, diffed and re-applied.

### 👥 Target Personas
- **Compliance / Security Reviewer** — needs to see who changed a security-relevant setting and when.
- **Platform Operator** — needs a changed value to take effect across running services without a restart.
- **Portal Admin** — needs to onboard a new tenant from a known-good preset rather than by hand.
- **App Developer** — needs their key catalog to stay in sync with their code automatically.
- **End User** — needs to store a credential as a setting without it being readable back.

### ✅ Features In Scope
- [ ] Feature 1: Secret-typed values — encrypted at rest, masked on read, excluded from bulk export.
- [ ] Feature 2: Append-only audit history of every set / unset / lock / unlock, with actor and reason.
- [ ] Feature 3: Revert a key at a scope to any previous value from its history.
- [ ] Feature 4: `config.changed` events published so consumers invalidate their caches.
- [ ] Feature 5: Version stamp / ETag per `(namespace, scope)` so clients can poll cheaply.
- [ ] Feature 6: Declarative key-definition registration — apps publish a manifest, upserted idempotently.
- [ ] Feature 7: Import / export of a scope's configuration (JSON + YAML) with a dry-run diff.
- [ ] Feature 8: Presets — named value bundles applied atomically to a scope.

### 🚫 Out of Scope
- The UI surfaces for any of this — audit-history and secret-input UI are FF-EPIC-19-S5.
- Effective-dated / scheduled future values — a later epic if demand appears.
- A full secrets-management product. This stores small secret-typed settings; SealedSecrets and the
  cluster secret store remain the home for infrastructure credentials.
- Cross-environment promotion pipelines (dev→prod config sync) — export/import is the primitive that
  would enable it, not the pipeline itself.

### 🏗️ High-Level Architecture Notes
> **Secrets.** `is_secret` keys are encrypted at rest with an envelope key held outside the config DB,
> masked on every read, and omitted from export. The audit trail stores a redaction, never plaintext —
> an audit log that records secret values is a secret store with worse access control. Reveal is a
> separate, individually-authorized, individually-audited operation, not a field on the bulk read.
>
> **Audit.** Append-only `config_value_history`, written in the same transaction as the value change so
> a change can never exist without its audit row. Revert is not a delete — it replays an earlier value as
> a new `set`, so the history of the revert is itself in the history.
>
> **Change events.** Publishing `config.changed` is what makes a config *service* rather than a config
> *table*. Consumers cache resolved config on the boot path; without invalidation the system's observable
> behaviour is "settings changes take effect at the next deploy", which defeats the point. The event
> carries namespace + scope + changed keys, and pairs with a monotonic version stamp per
> `(namespace, scope)` so a consumer that missed an event can still detect staleness by comparing a
> cheap ETag rather than refetching everything.
>
> **Declarative registration.** Apps ship a manifest of their key definitions and the service upserts it
> idempotently at startup. Hand-maintained catalog rows drift from the code that reads them within one
> release; a manifest makes the catalog a build artifact instead of an operational chore.
>
> **Import/export and presets** share one apply path: validate everything, then write atomically. Dry-run
> returns the diff without writing, so an admin sees what a preset will change before it changes it.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Config changes with a recorded actor | N/A | 100% |
| Secret values retrievable in plaintext via bulk read or export | N/A | 0 |
| Time for a changed value to take effect in a running consumer | Next deploy | < 60s via event, bounded by ETag poll otherwise |
| Catalog definitions drifting from the code that reads them | Unbounded | 0 for apps using manifest registration |
| Tenant onboarding config steps | Manual, per-setting | 1 preset application |

### 📋 Child Stories
| Story ID | Jira | Summary | Status |
|----------|------|---------|--------|
| FF-EPIC-18-S1 | [FFRNT-256](https://fuzefront.atlassian.net/browse/FFRNT-256) | Secret-typed values — encryption, masking, export exclusion | Open |
| FF-EPIC-18-S2 | [FFRNT-257](https://fuzefront.atlassian.net/browse/FFRNT-257) | Append-only audit history | Open |
| FF-EPIC-18-S3 | [FFRNT-261](https://fuzefront.atlassian.net/browse/FFRNT-261) | Revert a value to a previous version | Open |
| FF-EPIC-18-S4 | [FFRNT-262](https://fuzefront.atlassian.net/browse/FFRNT-262) | `config.changed` events for cache invalidation | Open |
| FF-EPIC-18-S5 | [FFRNT-263](https://fuzefront.atlassian.net/browse/FFRNT-263) | Version stamp / ETag per (namespace, scope) | Open |
| FF-EPIC-18-S6 | [FFRNT-277](https://fuzefront.atlassian.net/browse/FFRNT-277) | Declarative key-definition registration from an app manifest | Open |
| FF-EPIC-18-S7 | [FFRNT-278](https://fuzefront.atlassian.net/browse/FFRNT-278) | Import / export with dry-run diff | Open |
| FF-EPIC-18-S8 | [FFRNT-279](https://fuzefront.atlassian.net/browse/FFRNT-279) | Presets — named bundles applied atomically | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17 (all of it — there must be a catalog and a value store first).
- **Blocks:** FF-EPIC-19-S5 (secret + audit UI surfaces).
- **Related:** FF-EPIC-17-S6 (the write path these features hook into).

### 📎 References
- Config core epic: `docs/planning/epics/EPIC-17-configuration-service-core.md`
- Existing event conventions: `services/billing-service` webhook/event router
- Secret handling precedent: SealedSecrets scaffolding under `deploy/`

---

## Stories

### 📖 Story: A setting can hold a credential without disclosing it

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-256](https://fuzefront.atlassian.net/browse/FFRNT-256) |
| **Story ID** | FF-EPIC-18-S1 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want **to store an API key as a setting and know it cannot be read back** so
> that **integrations can be configured without turning the settings page into a credential disclosure**.

#### 📌 Background & Context
`is_secret` exists on the key definition from FF-EPIC-17-S2 but carries no behaviour yet. This story
gives it teeth across every read path — resolution, bulk read, export and audit.

#### ✅ Acceptance Criteria
1. **Given** a key with `is_secret = true` **When** a value is written **Then** it is encrypted at rest with a key held outside the config database.
2. **Given** a secret with a value set **When** the effective config is read **Then** the response indicates the key is set and returns a mask, never the plaintext.
3. **Edge case:** **Given** a secret value **When** the scope's configuration is exported **Then** the key appears with its value omitted and flagged, so an import round-trip does not silently blank it — an export that drops secrets without saying so produces an import that wipes them.
4. **Error case:** **Given** the encryption key is unavailable **When** a secret is read **Then** the request fails explicitly rather than returning the ciphertext, an empty value, or the default.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Security review passed (`security` agent) on the key-management design
- [ ] No plaintext secret in logs, audit rows, or export output — asserted by test
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Envelope encryption for `is_secret` values; masking on all read paths; export exclusion | — | 6 | Open |
| Backend | Individually-authorized, individually-audited reveal operation | — | 2 | Open |
| QA | Plaintext-never-leaks tests across read/export/audit/log paths; missing-key failure test | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S5, FF-EPIC-17-S6.
- **Blocks:** FF-EPIC-18-S7 (export must know how to handle secrets), FF-EPIC-19-S5.

#### ⚠️ Risks & Assumptions
- **Assumption:** An envelope key can be provisioned via the existing SealedSecret path.
- **Risk:** Key rotation is an afterthought that becomes impossible later — decide the rotation story now and record it, even if rotation itself ships later.

#### 📎 References
- Security agent: `.claude/agents/security.md`

---

### 📖 Story: Every configuration change is attributable

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-257](https://fuzefront.atlassian.net/browse/FFRNT-257) |
| **Story ID** | FF-EPIC-18-S2 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (6 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Compliance Reviewer**, I want **an append-only record of every configuration change with who
> made it and when** so that **a security-relevant setting change can be traced to a person rather than
> discovered as a mystery**.

#### 📌 Background & Context
Org-level configuration frequently changes what people can do. The history table is also the substrate
for revert (S3) and for the audit UI (FF-EPIC-19-S5).

#### ✅ Acceptance Criteria
1. **Given** any set / unset / lock / unlock **When** it succeeds **Then** a `config_value_history` row is written in the same transaction with `old_value`, `new_value`, `action`, `changed_by_user_id`, `changed_at` and optional `reason`.
2. **Given** a key at a scope **When** its history is requested **Then** changes are returned newest-first and paginated per `gate-pagination`.
3. **Edge case:** **Given** a value change that is rolled back by a failing bulk write **When** the transaction aborts **Then** no history row survives — history must never record a change that did not happen.
4. **Error case:** **Given** a secret-typed key **When** it changes **Then** the history row stores a redaction for both old and new values, never plaintext.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Migration is idempotent and documented
- [ ] History is append-only — no update/delete path exists, asserted by test
- [ ] `gate-pagination` green on the history endpoint
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | `config_value_history` migration + transactional write on every mutation + paginated read endpoint | — | 6 | Open |
| QA | Transaction-rollback leaves no history; secret redaction; append-only enforcement | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S6.
- **Blocks:** FF-EPIC-18-S3, FF-EPIC-19-S5.

#### ⚠️ Risks & Assumptions
- **Assumption:** The acting principal is always available on the write path; system-initiated changes record a service identity rather than null.
- **Risk:** History grows without bound on hot keys — decide a retention/rollup policy now rather than discovering the table size in production.

#### 📎 References
- Pagination standard: `gate-pagination`

---

### 📖 Story: A bad configuration change can be undone

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-261](https://fuzefront.atlassian.net/browse/FFRNT-261) |
| **Story ID** | FF-EPIC-18-S3 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 6 (4 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want **to revert a setting to a previous value** so that **a mistaken change can
> be undone immediately without me having to remember what the value used to be**.

#### 📌 Background & Context
Builds directly on S2's history. Revert is deliberately implemented as a forward-only operation.

#### ✅ Acceptance Criteria
1. **Given** a key with history at a scope **When** an authorized admin reverts to a specific historical version **Then** that value becomes current and the revert is itself recorded as a new history entry.
2. **Given** a revert **When** it completes **Then** it is validated against the key's *current* definition, so reverting cannot reintroduce a value that is no longer valid.
3. **Edge case:** **Given** the target history entry is an `unset` **When** it is reverted to **Then** the current override is removed and the key resolves from its parent again — reverting to "no value here" is a legitimate target, not an error.
4. **Error case:** **Given** a key now locked by an ancestor scope **When** a revert is attempted beneath that lock **Then** it is refused with the same 409 as a direct write — revert must not be a bypass around locking.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Revert respects locks and current validation — asserted by test
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Revert endpoint replaying a history entry as a new validated set | — | 4 | Open |
| QA | Revert-to-unset, revert-under-lock refusal, revert-fails-current-validation tests | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-18-S2.
- **Blocks:** FF-EPIC-19-S5.

#### ⚠️ Risks & Assumptions
- **Assumption:** Reverting a secret is out of scope for v1 unless the plaintext is still retrievable — otherwise the revert target is a redaction.
- **Risk:** Users expect revert to be an "undo stack" — document that it targets a specific version, not a relative step back.

#### 📎 References
- History story: FF-EPIC-18-S2

---

### 📖 Story: A changed setting reaches running services

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-262](https://fuzefront.atlassian.net/browse/FFRNT-262) |
| **Story ID** | FF-EPIC-18-S4 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (6 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Platform Operator**, I want **services to learn when configuration changes** so that **a setting
> I change takes effect in a running system rather than at the next deploy**.

#### 📌 Background & Context
Consumers cache resolved config on their boot path. Without invalidation the observable behaviour is
that configuration changes do nothing until a restart — which makes the whole service misleading rather
than merely limited.

#### ✅ Acceptance Criteria
1. **Given** a value change at any scope **When** it commits **Then** a `config.changed` event is published carrying namespace, scope, and the changed keys.
2. **Given** a consumer using `@fuzefront/config-client` with caching **When** it receives the event for a namespace it has cached **Then** it invalidates and re-resolves on next read.
3. **Edge case:** **Given** a bulk write of 20 keys **When** it commits **Then** **one** event is published listing all changed keys, not 20 events — a settings-page save must not produce an invalidation storm.
4. **Error case:** **Given** the event bus is unavailable **When** a value is written **Then** the write still succeeds and the staleness is bounded by the S5 version-stamp poll — configuration writes must not depend on the bus being up.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Event schema defined alongside the frozen contract
- [ ] Bus-unavailable path tested — write succeeds, no data loss
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Publish `config.changed` on commit; coalesce bulk writes into one event | — | 4 | Open |
| Backend | Cache-invalidation support in `@fuzefront/config-client` | — | 2 | Open |
| QA | Single-event-per-bulk-write, invalidation round-trip, bus-down write-still-succeeds tests | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S6.
- **Related:** FF-EPIC-18-S5 (the fallback when an event is missed).

#### ⚠️ Risks & Assumptions
- **Assumption:** The existing event/bus infrastructure is available to this service.
- **Risk:** Treating events as guaranteed delivery — they are not; S5's version stamp is the correctness backstop and must ship with this, not after it.

#### 📎 References
- Config client: `@fuzefront/config-client` (FF-EPIC-17-S1)

---

### 📖 Story: A consumer can check for changes cheaply

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-263](https://fuzefront.atlassian.net/browse/FFRNT-263) |
| **Story ID** | FF-EPIC-18-S5 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 6 (4 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **App Developer**, I want **a cheap way to ask whether my namespace's config has changed** so
> that **I can stay current without refetching everything on a timer or trusting event delivery**.

#### 📌 Background & Context
The correctness backstop for S4. Events can be missed; a monotonic version per `(namespace, scope)`
cannot be.

#### ✅ Acceptance Criteria
1. **Given** any change affecting a `(namespace, scope)` **When** it commits **Then** that pair's version stamp increases monotonically.
2. **Given** a client with a cached version **When** it issues a conditional read **Then** an unchanged namespace returns 304 without a body.
3. **Edge case:** **Given** a change at *portal* scope **When** an *org* beneath it computes its version **Then** the org's stamp also changes — the version must reflect the resolved view, not just rows owned by that exact scope, or inherited changes go undetected.
4. **Error case:** **Given** a client sends a malformed or unknown version token **When** the conditional read runs **Then** it returns the full current config rather than an error, so a bad cached token degrades to a normal read.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Inherited-change propagation explicitly tested
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Monotonic version per (namespace, scope) reflecting the resolved view; ETag/conditional read | — | 4 | Open |
| QA | Ancestor-change propagation, 304 behaviour, malformed-token degradation tests | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S4.
- **Related:** FF-EPIC-18-S4.

#### ⚠️ Risks & Assumptions
- **Assumption:** Computing a resolved-view version is cheap enough to do per request.
- **Risk:** A naive per-scope counter misses ancestor changes (AC3) — that is the defect this story most likely ships with if the acceptance test is skipped.

#### 📎 References
- Resolution engine: FF-EPIC-17-S4

---

### 📖 Story: An app's key catalog stays in sync with its code

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-277](https://fuzefront.atlassian.net/browse/FFRNT-277) |
| **Story ID** | FF-EPIC-18-S6 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (6 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **App Developer**, I want **to declare my key definitions in a manifest my app ships** so that
> **the catalog matches the code that reads it, without anyone hand-creating rows**.

#### 📌 Background & Context
Hand-maintained catalog rows drift from code within one release. A manifest makes the catalog a build
artifact.

#### ✅ Acceptance Criteria
1. **Given** an app publishes a key manifest **When** registration runs **Then** definitions are upserted and re-running with an unchanged manifest is a no-op.
2. **Given** a manifest that renames a key's `display_name` or `description` **When** it is re-registered **Then** metadata updates while existing stored *values* for that key are preserved.
3. **Edge case:** **Given** a manifest that omits a key which previously existed **When** it is registered **Then** the key is marked deprecated rather than deleted — deleting it would silently destroy every tenant's value for it.
4. **Error case:** **Given** a manifest that changes a key's `value_type` incompatibly with existing stored values **When** it is registered **Then** registration fails with a report of the conflicting values instead of leaving the catalog and the data inconsistent.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Idempotency asserted by test (re-register is a no-op)
- [ ] Destructive-change refusal asserted by test
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Manifest schema + idempotent upsert + deprecation-on-omission + incompatible-change refusal | — | 6 | Open |
| QA | Idempotency, metadata-update-preserves-values, omission-deprecates, type-conflict-refuses tests | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S2.

#### ⚠️ Risks & Assumptions
- **Assumption:** Apps can run registration at startup without racing each other; upsert is idempotent so concurrent registration is safe.
- **Risk:** Auto-deprecation on omission fires when a manifest is partially generated or truncated — require the manifest to declare completeness for its namespace rather than inferring deletion from absence.

#### 📎 References
- Catalog schema: FF-EPIC-17-S2

---

### 📖 Story: A scope's configuration can be exported, reviewed, and re-applied

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-278](https://fuzefront.atlassian.net/browse/FFRNT-278) |
| **Story ID** | FF-EPIC-18-S7 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (6 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **to export a scope's configuration and import it elsewhere after seeing
> exactly what would change** so that **I can replicate a known-good setup without re-entering settings
> by hand or discovering the differences afterwards**.

#### 📌 Background & Context
Shares one validated, atomic apply path with presets (S8). Dry-run is what makes import safe enough to
use on a live tenant.

#### ✅ Acceptance Criteria
1. **Given** a scope with overrides **When** it is exported **Then** JSON and YAML output contain only that scope's own overrides — not the full resolved set — so an import does not pin every inherited value.
2. **Given** an export file **When** it is imported with `dryRun` **Then** the response is a diff of adds / changes / no-ops with nothing written.
3. **Edge case:** **Given** an import containing a key locked by an ancestor **When** it is applied **Then** that key is reported as skipped-because-locked and the rest still apply — one locked key must not fail an otherwise valid import, but it must not be silently dropped either.
4. **Error case:** **Given** an import where any key fails validation **When** it is applied without `dryRun` **Then** nothing is written and the response names every failing key — atomic, like the bulk write it reuses.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Round-trip export→import produces no diff — asserted by test
- [ ] Secrets excluded and flagged, never silently blanked
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Export (own-overrides-only, JSON+YAML) + import with dry-run diff on the atomic apply path | — | 6 | Open |
| QA | Round-trip no-diff, locked-key-skipped-and-reported, all-or-nothing validation failure tests | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S6, FF-EPIC-18-S1 (export must know how to handle secrets).
- **Blocks:** FF-EPIC-18-S8 (presets reuse the apply path).

#### ⚠️ Risks & Assumptions
- **Assumption:** Exporting own-overrides-only is the right default; a "full resolved snapshot" export is a separate, clearly-labelled mode if needed.
- **Risk:** Exporting the resolved set by mistake would pin every inherited value on import, permanently detaching the target from its parents — AC1 exists specifically to prevent that.

#### 📎 References
- Bulk write: FF-EPIC-17-S6

---

### 📖 Story: A known-good configuration can be applied as a preset

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-279](https://fuzefront.atlassian.net/browse/FFRNT-279) |
| **Story ID** | FF-EPIC-18-S8 |
| **Parent Epic** | FF-EPIC-18 — Configuration Trust & Operations |
| **Priority** | Low |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 6 (4 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **named configuration presets I can apply to a scope** so that **onboarding
> a tenant is one action rather than forty**.

#### 📌 Background & Context
A thin layer over S7's apply path: a stored, named bundle of values instead of an uploaded file.

#### ✅ Acceptance Criteria
1. **Given** a stored preset **When** it is applied to a scope **Then** all its values are written atomically and the change is recorded in history as a single attributable action.
2. **Given** a preset **When** it is previewed against a scope **Then** the same dry-run diff as import is returned before anything is written.
3. **Edge case:** **Given** a preset containing a key that no longer exists in the catalog **When** it is applied **Then** that entry is reported as skipped and the remainder applies — presets outlive the keys they reference.
4. **Error case:** **Given** a caller without Permit authority at the target scope **When** they apply a preset **Then** it is refused — a preset must not be a path around per-scope write authorization.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Preset application is Permit-gated identically to direct writes
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | `config_presets` + apply/preview reusing the atomic import path, Permit-gated | — | 4 | Open |
| QA | Atomic apply, stale-key skip, unauthorized-apply refusal tests | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-18-S7.

#### ⚠️ Risks & Assumptions
- **Assumption:** Presets are platform/portal-authored; end users do not create them in v1.
- **Risk:** A preset becomes a second, divergent source of defaults — keep it a one-shot apply, never a live inheritance source, or it becomes an unmodelled tier in the resolution chain.

#### 📎 References
- Import/export: FF-EPIC-18-S7
