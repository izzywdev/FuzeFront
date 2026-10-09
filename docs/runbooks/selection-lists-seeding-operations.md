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
| Two release flags (both default OFF, fail closed) | Unleash | `fuzefront.selection-lists.service` (master) **and** `fuzefront.selection-lists.seed-defaults`. Seeding needs **both** ON **for the org**; evaluated **per message**. |
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

### 2.5 Platform pack translations: machine-translated, LLM-reviewed (no native review)

**Status: the 10 non-English locales of `platform-defaults` v1 are MACHINE-translated (AI-written),
were LLM-reviewed on 2026-10-05, and have NOT been reviewed by a native speaker.** The review
record (method, per-language decisions, back-translations) is in "LLM review record" below. The pack
file still says `"translationProvenance": "machine"`, and the service stores every non-English row of
it with `is_machine: true` (the English source rows are `false`), so the API and the translation events
(`isMachine: true`, `machine_translated` in the translation status) report them honestly and a
client can badge or down-rank them. An LLM review improves the text; it does not change what the text
is, so nothing presents it as human-reviewed. The pack is **not applied anywhere yet** (the service is
disabled, §6 "Service not deployed"; nothing can have been seeded), so the LLM-review corrections were made **in place
in v1** (an unapplied version is mutable; a changed *applied* version is `PACK_CONTENT_MISMATCH`).

The 10 locales: `es fr de pt ru zh ja hi ar he` (the 11th is the source locale `en`). Scope: 3 lists
(`yes-no`, `priority`, `work-status`), 10 items, i.e. 30 list-name rows + 100 item-label rows.

What `is_machine: true` means for the seeded rows (so nobody is surprised later):

- A machine row is **not** an edit: it is outside the "seeded-then-edited" hash, so an org keeps
  receiving pack upgrades. A **human** who rewrites one (`PUT …/translations/{locale}`) sets
  `is_machine: false`, which *is* an edit: that list/item is then skipped by every later upgrade.
- `POST …/translations/{locale}/autofill` with `overwrite_machine: true` may refresh these rows.
- A later pack version that still says `"machine"` and only changes translation text **is**
  propagated to already-seeded, unedited orgs (translation events only, no `list.updated`).
  A later version that drops the key (or says `"human"`) replaces the machine rows with
  `is_machine: false` text in those orgs. So **native review ships as `platform-defaults.v2.json`**
  without `translationProvenance` — never by editing v1 once it has been applied anywhere
  (a changed applied version is `PACK_CONTENT_MISMATCH`).

- [ ] **Decide** whether the pilot may run on machine translations (the owner's call, recorded
      with the other §3 decisions). Short, common words like these are low risk and have had the
      two-pass LLM review below, but they are user-visible text in 10 languages that no native
      speaker has read: prefer a pilot org whose users read English (the source locale is never
      machine) until the locales you will expose are signed off, or accept the residual risk
      explicitly (the owner accepted LLM review in place of native review on 2026-10-05).
- [ ] **Native review is now optional, not planned work** — the owner decided on 2026-10-05 that an
      LLM review replaces it ("LLM knows those languages better than me"). If a native speaker ever
      does review a locale, use the checklist below; until a human has reviewed every locale the
      pack stays `"machine"`.

#### Reviewer checklist (the criteria both LLM passes used; reusable by a native speaker)

Review in the file `services/selection-list-service/seed-packs/platform/platform-defaults.v1.json`
(the JSON is the source; each locale appears 3 times as a list `name` and 10 times as an item
`label`). English is the source of truth for meaning:

| List | English → what the label must mean |
|---|---|
| `yes-no` — "Yes / No" | `YES` Yes, `NO` No (the answer to a yes/no form field) |
| `priority` — "Priority" | `LOW` Low, `MEDIUM` Medium, `HIGH` High, `URGENT` Urgent (ticket / task priority) |
| `work-status` — "Work status" | `NOT_STARTED` Not started, `IN_PROGRESS` In progress, `BLOCKED` Blocked (cannot proceed because of something else), `DONE` Done (finished) |

For **every** string in your locale, confirm:

- [ ] **Meaning** — it means the English, in the sense above (e.g. *Blocked* is "stuck waiting on
      something", not "forbidden"; *Work status* is the status of a work item/task, not
      "employment status"; *Urgent* is a priority level, not an adjective for the person).
- [ ] **Register** — formal-neutral, the tone of a business product; no slang, no overly casual
      or overly bureaucratic wording.
- [ ] **Short dropdown label** — as short as the language allows, no trailing punctuation, no
      explanatory text; it must fit a narrow select / chip.
- [ ] **Agreement and consistency** — the four `priority` labels agree with one another (and with
      the grammatical gender of "Priority" in that language); the four `work-status` labels use
      one grammatical form; `yes-no` list name uses the same two words as the item labels.
- [ ] **Regional variety** — the locale code is the bare language (`pt`, `es`, `fr`, `de`, `ar`,
      `zh`, …). Confirm the wording is acceptable for the broad audience; if a regional split is
      needed (e.g. `pt` Brazil vs Portugal, `zh` Simplified vs Traditional, Arabic standard vs
      regional), note it — the platform has no regional locales today, so it is a product
      decision, not a pack edit.
- [ ] **Script and direction** — correct script (`zh` = Simplified assumed, `ar`/`he` right-to-left),
      correct diacritics, and the `/` in "Yes / No" renders sensibly in RTL.
- [ ] **Terminology match** — consistent with how the product's own UI in that locale already
      words priority and task status (check the i18n bundles) so the lists do not clash with it.

#### LLM review record (2026-10-05)

| | |
|---|---|
| **Date** | 2026-10-05 |
| **Method** | Two-pass LLM review with back-translation, every string of every locale (3 list names + 10 item labels × 10 locales = 130 strings) |
| **Approval** | Owner decision, 2026-10-05: an LLM review replaces native-speaker review ("LLM knows those languages better than me") |
| **Provenance after review** | Unchanged: `"translationProvenance": "machine"` ⇒ `is_machine = true`. The text is machine-produced and LLM-reviewed; **no human has reviewed it, and nothing may claim that they have.** |
| **Where the corrections landed** | In place in `platform-defaults.v1.json` (not applied anywhere, so v1 is still mutable; once any org is seeded, further changes MUST be a new `platform-defaults.v2.json`) |
| **Pinned by** | `services/selection-list-service/tests/seed.unit.test.ts`, "platform-defaults v1 locale review" (the decisions below, plus NFC / no bidi-control characters / no trailing punctuation / ≤ 24 characters / no Latin letters inside `ar` and `he`) |

**The two passes.** *Pass 1 (forward)*: each English source meaning was rendered into the locale and
judged for correctness in the sense of the table at the top of this section, register
(formal-neutral business UI), brevity, grammatical agreement within the list, consistency of
terminology within the language, regional neutrality, and script/diacritics/direction. *Pass 2
(blind back-translation)*: the final strings were back-translated to English without looking at the
source and compared with it; any drift in sense (not wording) was either fixed or recorded below. Both
passes were performed by the same model family in one session, so they are **not statistically
independent** and not equivalent to two humans: they catch calques, false friends, agreement and
register errors well, and regional or product-convention questions poorly. Treat the result as "no
known defects", not as a sign-off.

##### Decisions (what changed, and every earlier flag that was kept)

| Locale | String | Before | After | Reasoning |
|---|---|---|---|---|
| `ar` | `work-status.BLOCKED` | محظور | **متوقف** | "محظور" means *forbidden/prohibited* (a banned user, a blocked site), not *stuck on something*. "متوقف" ("halted/stopped") is the status sense, is a masculine adjective like the other three status labels, and is short. "معلّق" (pending/suspended) was rejected: it means *on hold*, which loses "cannot proceed". "متعثر" was rejected: it implies a failing project |
| `ar` | `work-status.DONE` | تم | **مكتمل** | "تم" is a bare verb ("it was done") that reads as a toast ("تم الحفظ") rather than a state. "مكتمل" ("complete") is the adjective form, parallels `NOT_STARTED`/`BLOCKED`, and matches `he` "הושלם", `fr` "Terminé", `pt` "Concluído" |
| `hi` | `priority.URGENT` | अत्यावश्यक | **तत्काल** | "अत्यावश्यक" means *essential / absolutely necessary*, which is importance rather than time pressure, and is long. "तत्काल" ("immediate, at once") is the common business wording for the top priority tier and is short. Slight drift toward *immediate* is accepted: it is the usual way the top tier is worded in Hindi UIs |
| `hi` | `priority.LOW` | कम | **निम्न** | The scale mixed registers: colloquial "कम" next to formal "उच्च". "निम्न / मध्यम / उच्च" is the one-register formal triplet ("निम्न प्राथमिकता / उच्च प्राथमिकता" is standard) and sits with "तत्काल". All four are invariant adjectives, so agreement with feminine "प्राथमिकता" holds |
| `zh` (Simplified) | `work-status.BLOCKED` | 已阻塞 | **受阻** | "已阻塞" is the engineering calque of *blocking* (threads, queues). "受阻" ("hindered by an obstacle") is plain business Chinese, keeps the "waiting on something else" sense and fits the 未开始 / 进行中 / 已完成 rhythm |
| `de` | `work-status` (list name) | Arbeitsstatus | **Bearbeitungsstatus** | "Arbeitsstatus" is used for *employment / work-permit status*. "Bearbeitungsstatus" is the standard word for the state of a processed item and pairs with the item "In Bearbeitung" |
| `es` | `work-status.DONE` | Hecho | **Completado** | "Hecho" is correct but informal; "Completado" is the formal-neutral participle and agrees in form with "No iniciado" / "Bloqueado" (all masculine, matching "Estado del trabajo") |
| `pt` | `work-status` (list name) | Estado do trabalho | **Situação do trabalho** | See "Portuguese: one variety" below |
| `fr` | `work-status` (list name) | État d’avancement (already changed from "Statut du travail" in the engineering pass) | kept | "Statut du travail" reads as employment status; "État d’avancement" ("progress state") is the project-management term and pairs with "En cours"/"Terminé". Typographic apostrophe is correct French |
| `es` | `work-status` (list name) | Estado del trabajo | kept | "work status" has no single idiom; "Estado del trabajo" is unambiguous for a work item and understood in all Spanish varieties |
| `ru` | `work-status` (list name) | Статус работы | kept | Considered "Статус выполнения"; "Статус работы" cannot be read as employment status (that is "статус занятости") and pairs with "В работе". Items are all neuter/impersonal (Не начато / В работе / Заблокировано / Готово), consistent |
| `ja` | `work-status.BLOCKED` | ブロック中 | kept (low confidence) | Standard in Japanese dev/PM tools and parallels 進行中. Alternatives (停滞中, 保留, 待機中) shift the meaning to *stalled / on hold / waiting*. The "-中" can read as "currently blocking" rather than "blocked"; accepted because context (a status list) disambiguates |
| `he` | all | — | no change | Feminine priority labels agree with "עדיפות"; masculine status labels are consistent; "סטטוס" is the normal business loanword |
| `fr` `de` `pt` `ru` `zh` `ja` `he` | `yes-no`, `priority` | — | no change | See the tables below |

##### Portuguese: one variety

Decision: **`pt` is written as pt-BR-neutral wording that also reads naturally in pt-PT** (the
locale code is the bare `pt`; there is no regional locale today). The earlier mix was "Estado do
trabalho" (leans pt-PT; in pt-BR the product word is "Status" and "estado" is easily read as a
geographic state) against "Em andamento" (pt-BR). Resolved as: list name **"Situação do trabalho"**
(common in Brazilian forms as "Situação: Em andamento / Concluído", and fully natural in Portugal),
**"Em andamento"** kept (the pt-BR standard; understood without effort in pt-PT, where "Em curso"
would be the local choice), "Não iniciado", "Bloqueado", "Concluído", "Baixa/Média/Alta/Urgente",
"Sim / Não" are identical in both varieties. "Status" was avoided as an anglicism in pt-PT. If a
product later needs a pt-PT variant it should be a separate locale, not an edit here.

##### Cross-cutting checks (all passed)

- Every string is Unicode **NFC**, trimmed, with **no** zero-width, LRM/RLM/ALM, embedding/isolate
  or BOM characters, no trailing punctuation, and ≤ 24 characters (longest: "Situação do trabalho",
  "Bearbeitungsstatus").
- **RTL (`ar`, `he`)**: the `/` in "نعم / لا" and "כן / לא" sits between two strongly right-to-left
  characters, so it takes the right-to-left embedding direction and renders in the correct order
  with no marks needed; no Latin letters or digits appear in any `ar`/`he` string. Arabic uses the
  standard Arabic letters (no Persian ی/ک), no presentation forms.
- `zh` is Simplified (assumed; Traditional would be a separate locale). `ja` uses the kanji/kana
  forms above. `hi` uses chandrabindu "हाँ" (standard) and Devanagari throughout.
- Priority labels agree with the gender of the list name where the language has gender
  (fr/es/pt/ar/he feminine; ru masculine; hi invariant adjectives; de predicative).

##### Pass 2: blind back-translations of the final strings

`yes-no`: in all 10 locales the list name, `YES` and `NO` back-translate to "Yes / No", "Yes", "No"
(es Sí / No, fr Oui / Non, de Ja / Nein, pt Sim / Não, ru Да / Нет, zh 是 / 否, ja はい / いいえ,
hi हाँ / नहीं, ar نعم / لا, he כן / לא). No drift.

`priority` (list name → `LOW` `MEDIUM` `HIGH` `URGENT`):

| Locale | Final strings | Back-translation | Drift |
|---|---|---|---|
| `es` | Prioridad → Baja, Media, Alta, Urgente | Priority → Low, Medium, High, Urgent | none |
| `fr` | Priorité → Basse, Moyenne, Haute, Urgente | Priority → Low, Average/Medium, High, Urgent | none |
| `de` | Priorität → Niedrig, Mittel, Hoch, Dringend | Priority → Low, Medium, High, Urgent/Pressing | none |
| `pt` | Prioridade → Baixa, Média, Alta, Urgente | Priority → Low, Medium, High, Urgent | none |
| `ru` | Приоритет → Низкий, Средний, Высокий, Срочный | Priority → Low, Medium, High, Urgent | none |
| `zh` | 优先级 → 低, 中, 高, 紧急 | Priority level → Low, Mid, High, Urgent/Emergency | none |
| `ja` | 優先度 → 低, 中, 高, 緊急 | Priority → Low, Mid, High, Emergency/Urgent | "緊急" is slightly stronger than "urgent"; conventional for the top tier |
| `hi` | प्राथमिकता → निम्न, मध्यम, उच्च, तत्काल | Priority → Low, Medium, High, Immediate | "Immediate" for Urgent (accepted, see above) |
| `ar` | الأولوية → منخفضة, متوسطة, عالية, عاجلة | Priority → Low, Medium, High, Urgent | none |
| `he` | עדיפות → נמוכה, בינונית, גבוהה, דחופה | Priority → Low, Medium, High, Urgent | none |

`work-status` (list name → `NOT_STARTED` `IN_PROGRESS` `BLOCKED` `DONE`):

| Locale | Final strings | Back-translation | Drift |
|---|---|---|---|
| `es` | Estado del trabajo → No iniciado, En curso, Bloqueado, Completado | Work status → Not started, In progress, Blocked, Completed | none |
| `fr` | État d’avancement → Non commencé, En cours, Bloqué, Terminé | Progress state → Not started, In progress, Blocked, Finished | list name is "progress status", not "work status" (accepted; avoids "employment") |
| `de` | Bearbeitungsstatus → Nicht begonnen, In Bearbeitung, Blockiert, Erledigt | Processing status → Not begun, Being processed, Blocked, Done/Dealt with | list name is "processing status" (accepted; avoids "employment status") |
| `pt` | Situação do trabalho → Não iniciado, Em andamento, Bloqueado, Concluído | Work situation/status → Not started, In progress, Blocked, Concluded/Completed | none |
| `ru` | Статус работы → Не начато, В работе, Заблокировано, Готово | Work status → Not started, In work/In progress, Blocked, Ready/Done | none |
| `zh` | 工作状态 → 未开始, 进行中, 受阻, 已完成 | Work status → Not started, In progress, Hindered/Obstructed, Completed | "Hindered" is slightly softer than "Blocked" (accepted) |
| `ja` | 作業ステータス → 未着手, 進行中, ブロック中, 完了 | Work status → Not yet begun, In progress, Blocking/Blocked, Complete | "ブロック中" ambiguity noted above |
| `hi` | कार्य स्थिति → शुरू नहीं हुआ, प्रगति में, अवरुद्ध, पूर्ण | Work status → Has not started, In progress, Obstructed/Blocked, Complete | none |
| `ar` | حالة العمل → لم يبدأ, قيد التنفيذ, متوقف, مكتمل | Work status → Has not started, Under execution/In progress, Stopped/Halted, Complete | "Stopped" is slightly weaker than "Blocked" (accepted over "forbidden") |
| `he` | סטטוס עבודה → לא התחיל, בתהליך, חסום, הושלם | Work status → Has not started, In process, Blocked, Completed | none |

##### Residual uncertainty (what an LLM review cannot settle)

- `ar` "متوقف", `ja` "ブロック中", `hi` "तत्काल"/"निम्न", `zh` "受阻" are choices between defensible
  alternatives; a native speaker or the product's own i18n bundle could still prefer another.
- Terminology was **not** checked against the product's own UI bundles for these words (the
  "Terminology match" checklist item above), because this pass reviewed the pack in isolation.
- No regional split is offered (`pt`, `es`, `ar`, `zh`); see "Portuguese: one variety".

##### If a human ever reviews the pack

When every locale has been signed off by a native speaker: add
`services/selection-list-service/seed-packs/platform/platform-defaults.v2.json` (same content with the
reviewers' corrections, **no** `translationProvenance` key), bump nothing else, update the
pack-catalogue test in `tests/seed.unit.test.ts` (it pins v1 to `machine`) and the acceptance test,
and replace this section's status line. Orgs seeded from v1 pick v2 up on the next reconciler pass
(`SEED_RECONCILER_ENABLED=true`, §6) or on their next pack upgrade. If instead v1 has been applied
anywhere **before** that, any further wording change is also a v2 (a changed applied v1 is
`PACK_CONTENT_MISMATCH`); keep `"machine"` in that v2 until a human has reviewed it.

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

1. **`prod-unleash-ops` knows only the `selection-lists` (master) set.** It has **no entry for
   `fuzefront.selection-lists.seed-defaults`**, and its strategy is a percentage `flexibleRollout`.
   Enabling `seed-defaults` therefore needs the raw procedure in the `unleash-flag-enable` skill,
   or a workflow extension (`feature-flags-engineer`).
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
| **`seed-defaults` cannot be flipped by `prod-unleash-ops`** | workflow `flags` options list has no such set; strategy is percentage-only | manual Unleash procedure or workflow extension; no per-org targeting in the workflow | `feature-flags-engineer` |
| ~~**Org-id format in flag context**~~ **FIXED (SL8)** | `buildFlagContext` in `src/flags.ts` canonicalises `orgId` / `userId` to the wire TypeID (`org_…` / `usr_…`; a bare UUID claim is converted with the identity codec) for EVERY evaluation; test `flags.canonical-context.test.ts` | Write Unleash `orgId` constraints in the **`org_…`** form: it now matches the seeding paths and the HTTP paths alike. A constraint written with a bare UUID will match neither | done |
| ~~**Request bodies looser than the spec; `limit=0` accepted; resolve accepted non-`front_sli_` ids**~~ **FIXED (SL8)** | `acceptOnlyBodyProps` / `parseLimitParam` in `src/middleware/validateInput.ts`; `POST /v1/resolve` validates `ids`; tests `routes.request-validation.db.test.ts` + the acceptance suite | Undeclared body properties, `limit<1`, cross-type/duplicate/empty resolve ids and an unsupported locale are `400 VALIDATION_ERROR`. **Behaviour change for callers:** `POST /v1/resolve` with `ids: []` is now `400` (spec `minItems: 1`), not an empty `200` | done |
| ~~**Port mismatch (service default 3011 vs chart 3008)**~~ **FIXED service-side (SL8)** | `src/index.ts` default, `Dockerfile` `ENV PORT`/`EXPOSE` and the docs now say `3008` (the chart already set `PORT` from `selectionListService.port`, so the deployed pod was never affected) | Local runs / the image default agree with the chart. **Still `3011`:** the OpenAPI `servers` example (frozen contract; its Helm copy `deploy/helm/fuzefront/files/selection-list-service-openapi.yaml` must stay byte-identical, so amend both in a contract PR), the `fuzefront-selection-list-client` Python README/docstring base URL, and CI's explicit `PORT: '3011'` (harmless) | `contract-designer` (spec), `docs-maintainer` (py README) |
| **Prod topic pre-creation is disabled** | `kafkaTopics.enabled: false` in `values-prod.yaml` | topics may be auto-created with broker defaults; token retention on `seed.requested`/`.dlq` not guaranteed to be 1 d; change-event DLQs undeclared | `devops-engineer` / FuzeInfra via `@fuze` |
| **Service not deployed; secrets not sealed** | `selectionListService.enabled: false`; no `selection-list-secrets.yaml` under `deploy/contabo/sealed/` | nothing above can run in prod yet | `devops-engineer` |
| **Allowlist has no app sources; no seed clients exist** | `seed-sources.json` lists only `platform`; seed-clients runbook is scaffolding | every app request is `SOURCE_NOT_ALLOWED` | per onboarding PR |
| **Platform pack translations are machine-translated, LLM-reviewed, not native-reviewed** | the pack says `"translationProvenance": "machine"`; the service writes `is_machine: true` for every non-English row; two-pass LLM review recorded 2026-10-05 (§2.5), owner-approved in place of native review | marked honestly (clients can badge them); if a human ever reviews them that ships as `platform-defaults.v2.json` — checklist in §2.5 | owner |
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
