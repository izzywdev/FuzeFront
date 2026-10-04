# EPIC-21 — Tag Management: capability tagging, matching and earned-tag career tracks

> **Status: PLAN ONLY — nothing is implemented.** This document is the design of record for the
> tag-management slice. The "Work, in order" section below describes PRs that later sessions will
> open; merging this document authorizes that work, it does not perform it.
>
> Owner: @izzywdev · Tier: product · Design-first, contract-first per `CLAUDE.md`.


## Context

FuzeFront has no tagging capability today. Verified: the design system ships `Badge`, `StatusPill`,
`RoleBadge`, `IntegrationBadge` — all read-only status pills — and there is **no** `Chip`, no
`TagInput`, no token-field combobox, and no tags table, tags API, or taggings join anywhere in the repo.

The need has two layers. The base: **objects can be annotated with tags; a user creates sets of tags
that are either private to them or shared at org level; objects can then be found by their tags.**
Today there is no way to group a selection list, an app, a portal, or a document across the
boundaries the platform's own entity types impose — each owning service can only be browsed on its
own terms.

The driving application on top of that base is **capability matching in a call centre**: agents are
tagged with the capabilities they have, incoming business lines are tagged with the capabilities they
require or prefer, and the projection between the two sets produces the matching agents. Capability
tags form a ladder — reaching the next one takes *≥3 months tenure and ≥500 calls rated 4★* — so
some tags are **earned against criteria**, not assigned.

That application is what makes the generic parts non-negotiable: a capability taxonomy is only useful
if a specific skill satisfies a general requirement (hence the hierarchy), and an earned tag is only
meaningful if nobody can hand it out (hence criteria enforced in the service).

Outcome: a `tag-service` microservice + `@fuzeone/tags-ui` package that let any FuzeFront entity be
tagged by its TypeID, organised into a capability DAG, matched against requirement sets, and awarded
against criteria — with per-tag-set ReBAC so an org taxonomy has a gatekeeper.

Decisions confirmed with the owner:
1. **Taggable objects are generic, by TypeID** — a tagging stores an opaque `{objectType, objectId}`
   pair validated against the identity registry prefix. Any Fuze entity is taggable with zero change
   in the owning service. Search returns object refs; the caller resolves display data.
2. **A tag set is a namespace/vocabulary** — a named container owning its tags, carrying the scope
   (private/org) and a mode (free-form vs controlled). A tag belongs to exactly one set. This mirrors
   `selection_lists → selection_list_items`, so the proven structure is reused rather than re-derived.
3. **ReBAC per tag set**, exactly like selection-lists: creator gets an instance-scoped
   `tagset-owner` grant via the Security API, can grant editor/viewer, last-owner 409 guard.
4. **Full slice**: contract → service → client → frames → UI → deploy wiring.
5. **Tag dependencies are a multi-parent DAG** — a tag may have several parents, so cycle
   detection is required on every edge write. Tagging with a child implies its ancestors for search.
6. **Hierarchy may cross tag-set boundaries**, with the security model in *Hierarchy across scopes*
   below. This is the single hardest part of the design and the place a private tag can leak.
7. **Taggings carry an intent** (`has` / `requires` / `desires`) and tag-service exposes a
   first-class **match** endpoint — the agent↔line projection lives here, not in each consumer.
8. **Tags may be earned rather than assigned.** tag-service owns the criteria grammar and the
   evaluation; products push metric values and never learn how the award was computed. Earned tags
   cannot be applied by hand, are revoked when criteria lapse, keep an append-only award audit with
   the justifying metric snapshot, and expose progress toward the next tag.

## Library & Architecture Review (feature-tech-planning)

**Capability:** multi-tenant, polymorphic object tagging with private/org-scoped vocabularies, a
cross-scope capability DAG, tag-based object search, a requirements↔capabilities matching projection,
and tags earned against declarative criteria over externally-supplied metrics. Hard requirements: multi-tenant (org + private scope), authorization
through FuzeFront's own Security API seam (never a vendor SDK in the service), TypeID identifiers
minted by the owning service, Postgres, Node 24 / React 19, cursor-paginated collections, deployed
by Helm/Argo.

| Option | Fit | Maturity | License | Lock-in | Verdict |
|---|---|---|---|---|---|
| **Build in-repo** (recommended) | 100% — the whole value is the coupling to Permit-via-Security-API, the TypeID registry, and org scoping | n/a | n/a | none | **Adopt** |
| Django/DRF multi-tenant taxonomy services (the closest OSS category) | ~50% — wrong runtime (Python/DRF), own auth model, own tenancy model; the authz seam would have to be rebuilt anyway | varies, small projects | mixed | new runtime in the fleet | Reject |
| Postgres array column + GIN instead of a join table | Storage detail, not a service. Fast for reads, but tag rename/merge/delete become rewrites of every row and there is no place to hang per-tag metadata | n/a | n/a | n/a | Reject for v1 |
| Elasticsearch/OpenSearch-backed tag search | Overkill at this scale; adds an index to keep consistent with no query it answers that Postgres cannot | mature | Apache/SSPL | operational | Reject; revisit only if tag search outgrows Postgres |

The multi-parent DAG hardens this verdict rather than softening it. A cross-scope DAG whose closure
must be filtered per caller is not a feature any general tagging library exposes — the visibility
rule is the product — and it removes the Postgres-array option outright, since an array column has
nowhere to put an edge.

The matching and earned-tag layers move it further still. A `requires`/`desires` projection over a
caller-filtered DAG closure, and criteria evaluated in the same transaction as the metric write that
triggers them, are not configuration of an existing tool — they are the service. The relevant
build-vs-adopt question at that point is not "which tagging library", it is "should matching be a
**rules engine**?" Answer: no for v1. The criteria grammar is deliberately closed (`all`/`any`/`not`
over metric comparisons and tag prerequisites), which is small enough to own outright and, more
importantly, small enough to reason about for safety — an embedded rules engine that can evaluate
arbitrary expressions against subject data is a much larger surface than this feature justifies.
Revisit only if real criteria outgrow the grammar, and prefer widening the grammar first.

**Recommendation: build.** No credible off-the-shelf option covers the parts that actually matter —
the Security API authz seam, the TypeID prefix registry, org/private scoping, the caller-filtered
graph closure, and the family's pagination and event contracts. The genuinely reusable prior art is *in this repo*:
`selection-list-service` is the same shape (org-scoped parent + ordered children + per-instance
ReBAC + quota + i18n) and is the template. Runner-up is the Postgres-array storage model — switch to
it only if benchmarks show the join table is the bottleneck, which at expected volume it will not be.

Honest downsides of building: it is a new deployable surface (image, DB role, NetworkPolicy, port,
Argo wiring, four CI gates) and the search endpoint returns bare object refs, so every consumer must
resolve display data itself. The resolver-registry option that would fix that was deliberately
deferred — it multiplies failure modes for a v1.

**One integration dependency, stated rather than assumed.** The call-centre product that pushes
`tenure_days` and `calls_rated_4plus`, and that calls `/v1/match` to route a line, is **not in this
repo** — FuzeFront's app registry knows a `call` product, and CLAUDE.md's slug rules confirm it
self-registers and owns its own slug. This plan delivers the tag side of that contract: the metric
keys, the ingestion endpoint, the match endpoint, and the service credential the pusher authenticates
with. Wiring the call-centre product to actually push and consume is **that repo's work**, delegated
via `@fuze` with the metric-key list and endpoint shapes spelled out, once this contract is frozen.
The tag side is independently testable without it, which is why it can proceed first.

**Componentization:**
- `services/tag-service/` — standalone microservice, its own lifecycle, own Postgres role + schema.
- `tag-client/` → `@fuzeone/tag-client` — typed HTTP client, private GitHub Packages, `access: restricted`.
- `packages/tags-ui/` → `@fuzeone/tags-ui` — the management UI, private, `access: restricted`.
- **`design-system/components/forms/TagInput` + `.../core/Chip`** — new DS *base* primitives, not
  package-local. A removable tag chip and a token-field combobox are generic; anything needing to
  pick tags (and the picker will be embedded elsewhere, like `<SelectionListPicker>` was) needs them.
- `packages/identity` + `packages/identity-py` — two new prefixes, edited in lockstep.

## Architecture

**Scope model.** One table, two scopes, no second code path:

```
tag_sets     (id, scope 'private'|'org', organization_id, owner_user_id, key, name,
              mode 'free'|'controlled', status, created_by, …)
tags         (id, tag_set_id FK ON DELETE RESTRICT, key, label, color, status, …)
taggings     (id, tag_id FK ON DELETE CASCADE, object_type, object_id,
              intent 'has'|'requires'|'desires' DEFAULT 'has',
              organization_id, created_by, created_at)
tag_edges    (child_tag_id FK, parent_tag_id FK,
              kind 'specializes'|'requires_first',      -- TWO relationships, see below
              created_by, created_at,
              PRIMARY KEY (child_tag_id, parent_tag_id, kind),
              CHECK (child_tag_id <> parent_tag_id))   -- the DAG
tracks       (id, tag_set_id FK, key, name, created_by, …)        -- a career ladder
track_rungs  (track_id FK, tag_id FK, position INT,
              PRIMARY KEY (track_id, tag_id), UNIQUE (track_id, position))
tag_set_access  (tag_set_id, user_id, role, granted_by, org_id, granted_at,
                 updated_at, revoked_at)   -- read-model MIRROR, never consulted for authz
```

- `scope='private'` ⇒ `owner_user_id` NOT NULL, visible only to that user.
  `scope='org'` ⇒ `organization_id` NOT NULL, ReBAC-governed. Enforced by a CHECK constraint,
  not by application code.
- `UNIQUE (organization_id, owner_user_id, key)` on `tag_sets`; `UNIQUE (tag_set_id, key)` on `tags`;
  `UNIQUE (tag_id, object_type, object_id, intent)` on `taggings` — re-tagging is idempotent, and one
  object may carry the same tag under two intents where that is meaningful.
- `object_type` is an **identity-registry entity type name**, `object_id` its TypeID string. A
  tagging is rejected unless `object_id`'s prefix equals `prefixFor(object_type)` — the offline
  cross-type check from `governance/identifier-standard.md` §2. This is the one place the generic
  model could leak, so it is validated on write, in a shared helper, with a unit test per rejection case.
- Indexes: `taggings (object_type, object_id)` for "tags of this object",
  `taggings (tag_id, intent)` for "objects with this tag under this intent",
  `taggings (organization_id, tag_id, intent)` for scoped search and the match query.

**Two edge kinds, and conflating them is the mistake to avoid.** `tag_edges.kind` distinguishes:

- **`specializes`** — *"Spanish — Mexico" specializes "Spanish".* A taxonomy edge. **Matching follows
  it**: a specific capability satisfies a requirement for the general one.
- **`requires_first`** — *"Senior Agent" requires "Agent L2" first.* A progression edge. **Matching
  must NOT follow it.** Holding Senior does not make you match everything L2 satisfies, and being
  eligible for a rung is not the same as being able to do the job below it.

They are different relations that happen to share a table. Traversing `requires_first` during
matching silently widens who qualifies for a line — it is the kind of bug that produces plausible
results and is only caught by a test that asserts the *absence* of a match. Both kinds live in one
DAG so cycle detection covers both, but **every traversal names the kind it walks**; there is no
"walk all edges" helper, deliberately.

**Career tracks.** `requires_first` alone gives a partial order, which is not enough to answer
"what's my next rung?" when a tag has several dependents. A `track` is an explicitly ordered ladder
through tags in one set — Agent L1 → L2 → Senior → Team Lead — so the UI can show *you are here, this
is next, here is what it takes*. Tracks are the unit a person progresses along; `requires_first` is
the constraint the service enforces. A tag may appear in more than one track.

**Hierarchy — a multi-parent DAG.** `tag_edges` is a child→parent edge set; a tag may have
several parents of either kind, so the graph is a DAG, not a tree.

- **Cycle detection on every edge write.** Before inserting `(child, parent)`, walk `parent`'s
  ancestors with a recursive CTE and reject with 409 if `child` appears. Do it **inside the same
  transaction as the insert, with the two tags' rows locked** — two concurrent edge writes that each
  pass the check independently will otherwise close a cycle between them.
- **Bounded depth.** `MAX_DEPTH` (start at 8) enforced on write, and every recursive CTE also
  carries a depth guard so a corrupt graph degrades into a truncated answer rather than a hung query.
- **Deleting a tag that has children is a 409**, consistent with the `ON DELETE RESTRICT` rules
  elsewhere — reparent or delete the children first. Deleting an *edge* is always allowed.
- **Implied tags.** Tagging an object with a child implies its ancestors **for search only**. The
  `taggings` row stores exactly the tag the user applied — ancestors are never materialised into
  rows, so a later reparent does not require rewriting history, and "what did this person actually
  tag?" stays answerable.

**Hierarchy across scopes — the security model.** Cross-set parents are the requested capability and
the one real leak surface in this design. Four rules, all enforced server-side:

1. **Edge writes need write on the child and read on the parent.** You may hang *your* tag under a
   parent you can see; you may never attach someone else's tag to yours.
2. **Scope direction: an edge may only point from a narrower scope to an equal-or-wider one.**
   private child → org parent is allowed; **org child → private parent is rejected (422)**. Otherwise
   an org tag's ancestry would be invisible to most of the org, and deleting one person's private
   set would silently restructure the org taxonomy. Cross-**organization** edges are rejected outright.
3. **Ancestor/descendant closure is computed per caller, filtered to sets the caller can read.**
   A search for an org parent expands only to descendants in readable sets — the owner sees their own
   private child, nobody else does. This is what stops a private tag leaking through a shared parent.
4. **A tag the caller cannot read never appears in any response** — not in `parents[]`, not in a
   breadcrumb, not in an error message, **and not as a count**. A redacted count is an existence
   oracle ("this org tag has 3 hidden children") and is the failure mode this rule exists to prevent.
   Omit silently.

**Search.** `GET /v1/tags/search?tags=…&match=all|any&objectType=…&includeDescendants=true` — a join
over `taggings`. With `includeDescendants` (default `true`), each requested tag first expands to its
caller-visible descendant set via rule 3, then `match=all` is
`GROUP BY object_id HAVING count(distinct <expanded group>) = N` — matching *per requested tag*, so an
object tagged `Bipedal` satisfies a request for `Robotics`. Returns object refs plus their full
caller-visible tag list. Cursor-paginated per `governance/pagination-standard.md`: `limit` with a
declared default and server-clamped max, opaque `cursor`, and the `{ items, page: { nextCursor,
hasMore, total? } }` envelope. Never "all of X".

Start with recursive CTEs over `tag_edges`. If closure traversal becomes the bottleneck, the
escalation is a materialised `tag_closure (ancestor_id, descendant_id, depth)` table maintained
transactionally on edge writes — noted here so it is a planned step, not a rewrite.

## Capability matching — the projection

The driving use case: **call-centre agents are tagged with the capabilities they have; incoming
business lines are tagged with the capabilities they require or prefer; the projection between the
two sets is the set of matching agents.** This is the feature, not a nice-to-have on top of search,
and it is why the hierarchy exists — a capability taxonomy only pays for itself when a specific
skill satisfies a general requirement.

**A tagging carries an intent.** `taggings` gains `intent TEXT NOT NULL CHECK (intent IN
('has','requires','desires')) DEFAULT 'has'`:

- `has` — the subject possesses this capability (an agent).
- `requires` — a hard filter. A candidate missing it is excluded.
- `desires` — a soft preference. Does not exclude; it ranks.

`GET /v1/match?against={objectId}&candidateType={type}` returns candidates whose `has` set covers
every `requires` tag of the target, ranked by how many `desires` tags they also cover, with the
matched and missing tags named per candidate so a routing decision is explainable rather than a bare
ordering. Cursor-paginated like every other collection.

**Descendants satisfy ancestors, never the reverse.** An agent tagged `Spanish — Mexico` satisfies a
line requiring `Spanish`; an agent tagged only `Spanish` does **not** satisfy a line requiring
`Spanish — Mexico`. This direction is the whole point of the DAG here and is the single easiest thing
to invert by accident — it gets a named test, not just coverage.

The closure used for matching is the **caller-filtered** one from *Hierarchy across scopes*: a
capability a caller cannot read cannot silently satisfy a requirement for them.

**A capability tag is not an authorization grant.** Matching is routing. Whether an agent may
actually handle a line is a Permit decision, exactly as `governance/identifier-standard.md`'s
corollary holds that knowing an id is never a capability. Nothing in the match path may be read as
permission, and the match endpoint's own docs must say so.

## Earned tags — criteria, metrics and awards

A tag may be **assignable** (applied by a person) or **earned** (awarded only when criteria are met).
This is the gamification: *to reach the next capability tag you need ≥3 months since the previous
rung, ≥1000 calls answered averaging ≥4★, and the Tier-2 escalation course passed.*

This model is drawn from a system the owner previously built and ran in production for exactly this
purpose, so the criterion shapes below are the ones real ladders turned out to need — not a guess.

**tag-service evaluates; products push metrics. It never learns what a call is.** A criterion is a
declarative expression over **named metric keys** plus tag prerequisites. The owning product
(the call-centre app) pushes values; tag-service stores, evaluates, awards and revokes. That keeps
the family tag service generic while making the criteria actually enforced rather than documentation.

```
tag_criteria    (tag_id PK/FK, expression JSONB, version, updated_by, updated_at)
subject_metrics (subject_type, subject_id, metric_key, value NUMERIC,
                 observed_at, source, PRIMARY KEY (subject_type, subject_id, metric_key))
tag_awards      (id, tag_id, subject_type, subject_id, state 'awarded'|'revoked',
                 evidence JSONB, evaluated_at, created_at)      -- APPEND-ONLY
```

`expression` is a small, **closed** grammar — `all` / `any` / `not` over a fixed leaf set. Closed on
purpose: no user-supplied code, no arbitrary SQL, nothing that can reach outside the subject it is
evaluating. The leaves:

| Leaf | Example | Notes |
|---|---|---|
| `{ metric, op, value }` | `avg_rating >= 4.0` | a pushed metric |
| `{ holdsTag }` | holds `Agent L2` | a prerequisite rung |
| `{ daysSinceTag, days }` | ≥90 days since `Agent L2` **was awarded** | reads `tag_awards.evaluated_at` — **not** absolute tenure |
| `{ course }` / `{ exam }` | `course_completed:tier2-escalation` | boolean metric from whatever owns training |
| `{ endorsements, from }` | 3 endorsements from a `team-lead` | see open decision 5 |

Three of these are easy to get subtly wrong, so they are called out:

- **`daysSinceTag` is veterancy, not tenure.** "Three months at the previous rung" is the real
  progression measure; absolute time at the company is not, and a new hire promoted quickly would
  otherwise clear it on day one. It is derivable from `tag_awards` with no new storage.
- **Average-over-volume is not a count.** *"1000 calls averaging ≥4★"* is
  `all: [calls_answered >= 1000, avg_rating >= 4.0]` — two joined leaves. It is **not**
  `calls_rated_4plus >= 1000`, which is a different and weaker statistic: a count only ever rises,
  while an average can fall, which is precisely what makes revocation meaningful.
- **Courses and exams are metric sources, not a subsystem.** A completed course arrives as a boolean
  metric on the normal `/v1/metrics` path. **tag-service does not become an LMS** — it never stores
  course content, attempts, or scores beyond the pass/fail value it was handed.

Owner-confirmed rules, all four:

1. **An earned tag cannot be applied by hand.** A manual tagging with a tag that has criteria
   returns **409**. Without this the criteria are decorative — this is the rule the whole subsystem
   rests on.
2. **Revoke when criteria stop being met.** Re-evaluation on every metric push for that subject, plus
   a periodic sweep for time-based criteria that no push will trigger (tenure crossing 90 days
   arrives from the calendar, not from an event). Revocation writes an award row with
   `state: 'revoked'`; it never deletes one.
3. **Append-only audit.** Every award and revoke stores the **metric snapshot that justified it** in
   `evidence`, so "why does this agent hold Senior?" is answerable months later, after the metrics
   have moved. `tag_awards` has no UPDATE and no DELETE path in the service — enforced by a
   trigger, not by convention.
4. **Progress toward unearned tags is exposed** — `GET /v1/tags/{tagId}/progress?subject=…` →
   `412 of 500 calls rated 4★, 94 of 90 days tenure`.

**Rule 4 is a metrics-disclosure surface and needs its own authorization.** The progress response
*is* the metric values. Default: readable by the **subject themselves**, and by a holder of an
explicit manager/owner grant on the tag's set — **never org-wide by default**, because "how is
everyone tracking against Senior Agent" is a performance-management dataset, not a tag lookup. The
check is a Security API `check` on `{ type: 'TagProgress', key: subjectId }`, fail-closed like every
other. A subject the caller may not read returns **404, not 403** — 403 confirms the subject exists.

**Metric ingestion is a write endpoint on a hot path**, so: `POST /v1/metrics` accepts a batch,
requires a service credential rather than an end-user token, is idempotent per
`(subject, metric_key, observed_at)`, and rejects an `observed_at` in the future. Re-evaluation of
the affected subject's candidate tags happens in the same transaction as the metric write, so a
subject's metrics and awards can never be read in a mutually contradictory state.

**Out of scope for v1, named so it is a decision and not an oversight:** no leaderboards, no points,
no cross-org comparison. The earned-tag ladder is the mechanic; ranking people against each other is
a separate product question with its own privacy weight.

## Sensitive-attribute tags — a separate class, decided up front

Real capability sets for this use case include **language, specialty, expertise — and gender and
religion**. The last two are lawfully useful for routing in specific cases (a caller asking for a
same-gender agent on a sensitive health line; a faith-based advisory service) but they are
**special-category personal data** under GDPR Art. 9 and protected characteristics under employment
law. They cannot ride the same code path as "speaks Spanish".

This is cheap to design in now — a `sensitivity` marker, one authz rule and an audit row — and a
retrofit across the entire match path later. So it is in the plan, not in the open-decisions list:

- **`tag_sets.sensitivity`** (`normal` | `special_category`) with the **lawful basis and purpose
  recorded on the set**, required before a tag in it can be applied to anyone.
- **Self-declaration only.** A special-category tag may be applied **by the subject and nobody else**
  — never manager-assigned, never inferred from another attribute, never earned by criteria.
- **Per-subject opt-in to being matched on it**, separate from declaring it. Declaring a
  characteristic and agreeing to be routed by it are two different consents.
- **Off by default per org.** Special-category matching requires an explicit org-admin enablement;
  a fresh tenant cannot route on these accidentally.
- **Every match that used one is logged** with the requirement that justified it — the audit answers
  "why was this allocation made" for a regulator or a grievance, which no ordinary access log does.
- **Withdrawal is immediate.** Removing the tag or the consent drops the subject from matching on it
  at once; `tag_awards`' append-only rule does not apply here, because an erasure request must
  actually erase.
- **Never a `requires_first` prerequisite and never an earned tag.** A characteristic is not a rung
  and cannot be a gate on progression — allowing it would build a discriminatory career ladder out
  of otherwise-correct primitives.

Anything the org cannot state a lawful basis for does not belong in the system at all; the tag set
is the place that decision gets recorded, so it is made once and visibly rather than per tag.

## Where this belongs in the Fuze family

**tag-service is FuzeFront platform infrastructure, not a call-centre feature.** What this design
describes is a *competency and progression* platform — declare capabilities, define how they are
earned, allocate work by fit. The call centre is its first consumer, not its scope: field-service
dispatch, clinical rostering, support tiering and professional-services staffing are the same shape.
That generality is the argument for it sitting beside config-service and selection-list-service.

Three boundaries, and they are the load-bearing part of this plan:

| Concern | Owner | Why |
|---|---|---|
| Tags, DAG, criteria, awards, tracks, match projection | **`tag-service`** (FuzeFront) | Generic; reusable; where the authz and identity seams already are |
| Telephony, call records, star ratings, ACD routing | **the `call` product** | Domain-specific. tag-service knows "a number called `avg_rating`", never what a call is |
| Courses, exams, training content | **whatever owns training** | Pushes `course_completed:<id>` as a boolean metric. **tag-service does not become an LMS** |

**One naming concern to settle before the contract freezes.** "tag-service" undersells this: tags are
the substrate, but the product is competency management. The slug is **immutable once registered**
(see `CLAUDE.md`, *slug is free at creation, immutable thereafter*), so this is the only moment the
question is cheap. Open for the owner.

## Career path — open decisions

These are real gaps in the model above. Each has a recommendation; none is settled. They are here
rather than silently omitted because every one of them changes what "earned" means to the person
it is applied to, and that is an HR-grade decision, not an implementation detail.

1. **Manual override / grandfathering.** Rule 1 says an earned tag can never be applied by hand.
   That is correct for integrity and wrong for a new hire with ten years of prior experience whose
   metrics start at zero. *Recommendation:* allow an **attested award** — a distinct award kind,
   requiring an explicit manager grant, a mandatory reason string, and its own row in `tag_awards`
   so it is visibly an override and not an earned award. Never a silent manual apply.
2. **Criteria versioning — what happens to existing holders when a bar moves.** If Senior goes from
   500 to 750 calls, are current holders re-evaluated or grandfathered? *Recommendation:* grandfather
   by default, pinning each award to the `criteria_version` it was earned under, with an explicit
   opt-in re-evaluation. Silently demoting people because an admin edited a threshold is the worst
   available default.
3. **Revocation hysteresis.** A rolling metric dipping below the bar for one day should not strip a
   tag. *Recommendation:* a per-criterion grace window, and revoke only on sustained failure.
4. **Expiry / recertification.** A certification valid 12 months is a different mechanic from
   criteria lapsing. *Recommendation:* optional `valid_for` on a tag, with re-evaluation at expiry.
5. **Endorsement as a criterion type.** "Three peer endorsements" is a common rung and the closed
   grammar has no leaf for it. *Recommendation:* add an `{ endorsements: N, from: role }` leaf —
   it stays inside the closed grammar, so it does not reopen the rules-engine question.
6. **Notification on award and revoke.** A progression loop that never tells the person is not a
   loop. There is a `notification-service` in this repo to publish to. Currently unwired.
7. **"What should I work on next."** The inverse of progress: given a subject, which tags are
   closest to being earned. Cheap once tracks exist, and it is most of the felt value of the ladder.
8. **Proficiency on a `has` tagging.** An agent "has Spanish" — fluent or conversational? Matching is
   binary today. *Recommendation:* defer; add a `level` to the tagging only once a real routing rule
   needs it, since it complicates every match query.
9. **Negative requirements** — a line requiring an agent *not* hold a tag. Deferred; no known need.
10. **Agent availability and capacity.** `/v1/match` answers *who is qualified*, never *who is free*.
    That is the ACD's job in the call-centre product and must stay there — the plan is explicit about
    it so nobody later adds presence tracking to the tag service.

**Authorization.** Copy `services/selection-list-service/src/middleware/authz.ts` verbatim in shape,
substituting `TagSet` for `SelectionList`:
- `requireAuthzCheck('TagSet', action)` → `createAuthzClient({ baseUrl: SECURITY_SERVICE_URL })`,
  **fail closed** (any transport error → 403), no vendor SDK in this service.
- Instance-scoped: every call site with a `tagSetId` passes
  `resource: { type: 'TagSet', key: tagSetId }`. Omitting it silently widens a set-scoped grant to
  tenant-wide — the documented escalation surface.
- `grantTagSetOwner()` writes the **Security API first**, then the `tag_set_access` mirror, so a
  thrown grant never leaves the mirror claiming a change that did not happen.
- `countActiveOwners()` reads the mirror **only**, only for the last-owner 409 guard.
- Private sets short-circuit: `owner_user_id === req.userId` is ownership; no Security API call.
- `NODE_ENV=test` no-op proxy + `_setAuthzClientForTesting()` seam, as in the template.

**Identity.** Add to `packages/identity/src/registry.ts` **and**
`packages/identity-py/fuzefront_identity/registry.py` in the same PR — `gate_identifier.py
--registry-parity` fails CI if they drift:

```ts
  // tag-service — product-local types, namespaced front_ per the namespace gate.
  tagSet:  'front_tgs',
  tag:     'front_tag',
  tagging: 'front_tgg',
```

`front_`-namespaced (product-local), not bare spine prefixes — tag-service is a FuzeFront product
feature, not a family-hosted platform service like config-service. All ids minted via `mintId()`;
no create body accepts an `id`, and every request schema sets `additionalProperties: false`.

**Lifecycle events — this will fail CI if skipped.** `scripts/gate_microservice_events.py` requires
a **new** service to subscribe to all four of `identity.user.created`, `identity.user.deleted`,
`identity.org.created`, `identity.org.deleted` *and* to perform a real DB write in the handler —
`knownUnhandled` in `governance/microservice-events-policy.json` is a shrink-only ratchet that a new
service cannot be added to. `src/events/` gets four handlers that actually write: seed a starter org
tag set on `org.created`, purge private sets + taggings on `user.deleted`, purge org sets + taggings
on `org.deleted`. Model on `services/selection-list-service/src/events/{consumer,user-deleted.handler,org-deleted.handler}.ts`.

**Feature flag.** `fuzefront.tags.service`, release type, **default OFF**, gating the Helm values
`enabled`, the host shell route, and the sidebar nav entry — the exact pattern
`fuzefront.selection-lists.service` uses at `frontend/src/App.tsx:518` and
`frontend/src/components/SidePanel.tsx:62`. Both states tested.

## Work, in order

The repo's gates force the sequence: contract before implementation, approved frames before feature UI.

### PR 1 — Contract (`api-contract-first`)
- `services/tag-service/openapi.yaml` — `info.version: 1.0.0`, `.spectral.yaml` copied from
  selection-list-service. Endpoints: tag-sets CRUD, tags CRUD within a set, taggings
  create/delete/list-by-object, `GET /v1/tags/search`, `/v1/tag-sets/{id}/access` (PUT/DELETE),
  `/health`, `/docs`, plus the hierarchy surface:
  `PUT|DELETE /v1/tags/{tagId}/parents/{parentTagId}` (edge write/delete),
  `GET /v1/tags/{tagId}/ancestors` and `/descendants` (caller-filtered, paginated, depth-capped);
  and the matching + earned-tag surface:
  `GET /v1/match`, `PUT /v1/tags/{tagId}/criteria`, `POST /v1/metrics` (batch, service credential),
  `GET /v1/tags/{tagId}/progress`, `GET /v1/tags/{tagId}/awards` (append-only, paginated),
and the track surface: `/v1/tracks` CRUD, `GET /v1/tracks/{id}/position?subject=…` (which rung a
subject is on and what the next one takes). Edge writes carry `kind`; `/v1/match` walks
**`specializes` only**.
  Documented failures are part of the contract: 409 cycle, 409 delete-tag-with-children,
  409 manual-apply of an earned tag, 422 scope-direction violation, 422 malformed criteria
  expression, and 404 (never 403) for a parent, subject or progress record the caller cannot read.
- Every collection GET cursor-paginated with the canonical envelope. Every create body
  `additionalProperties: false` and **no** client-supplied `id`.
- `tag-client/` → `@fuzeone/tag-client`: `tsup` build, dual CJS/ESM exports,
  `publishConfig: { registry: "https://npm.pkg.github.com", access: "restricted" }`,
  `lint:contract` spectral script. Copy `selection-list-client/package.json` as the base.
- Identity registry entries (TS + Py together).
- Register the spec for `gate-devportal-spec-registration`.

### PR 2 — Frames only (`product-designer`, owner-approved per flow)
`design/frames/tags/` — `index.html`, `tokens.css`, `frame.css`, ordered `01-*.html`, `manifest.json`
with `implementation.paths: ["packages/tags-ui/src/**"]` and `build.flows[]` (`id`, `orchestrator`,
`route`, `frames[]`, `approved`). Copy the shape of `design/frames/selection-lists/manifest.json` —
top-level keys `name, description, designSystem, implementation, plan, jira, epic, entry, contract,
frames, build, stamp`.

Flows: **tag-set management**, **tag-picker / annotate an object**, **hierarchy editor**,
**search by tags**, **capability matching** (a line's requirements, the ranked agents, and *why*
each matched), **earned-tag criteria + progress** (the criteria builder, a subject's ladder, the
award history with its evidence), and **access control**. `build.designSystemAdditions` must declare
`Chip`, `TagInput`, `TagGraph` and `CriteriaProgress` — approving the frames approves adding them to
the DS base.

The hierarchy editor is the flow that needs the most design attention: a **DAG is not a tree**, so a
tag appears under every parent it has and the UI must not imply one canonical path. Frame the
multi-parent case explicitly (the same tag shown in two branches, with its other parents named), and
frame a cross-set edge so the scope of each end is visible at a glance.

**Frames must show loading, empty, error, and the fail-closed cases** — not just the happy path:
delete a tag still applied to N objects (409 + "applied to N objects, remove first"), delete a tag
that has children (409 + "reparent its N children first"), a cycle rejection (409, naming the path
that would close), an org-child→private-parent attempt (422, explaining the scope-direction rule),
demote the last tag-set owner (409), a controlled set rejecting an unknown tag, a private set that
cannot be shared until converted to org scope, a search returning an object the caller cannot
resolve, an attempt to hand-apply an earned tag (409, pointing at its criteria), a match with **zero**
qualifying agents (the operationally important empty state — a line nobody can serve), and —
critically — **a tag whose parents are partly unreadable, rendering with no placeholder and no
count**, so the frame itself documents rule 4.

This PR is frames and nothing else. `gate-frames-first` fails any `packages/*-ui/**` PR whose covering
flow is not approved, so PR 5 is blocked until this merges approved.

### PR 3 — Service (`backend-engineer` + `database-engineer`)
`services/tag-service/` mirroring `services/selection-list-service/` file for file:

| File | Copied from |
|---|---|
| `src/app.ts`, `src/index.ts` | selection-list-service (route mount order: `/docs`, `/health` unauth; `authMiddleware` once at `/v1`) |
| `src/middleware/{auth,authz,authz.flags}.ts` | ditto, `TagSet` for `SelectionList` |
| `src/db/{index,knexfile,migrate}.ts` + `src/db/migrations/*` | ditto — `knex`, `CREATE TABLE IF NOT EXISTS`, ordered `YYYYMMDD_NNNNNN_*.ts` |
| `src/routes/{health,docs,tag-sets,tags,taggings,search,hierarchy,match,criteria,metrics,progress,awards,access}.ts` | ditto |
| `src/services/graph.ts` — edge write w/ transactional cycle check, caller-filtered closure | new; no template |
| `src/services/match.ts` — requires/desires projection over the filtered closure | new |
| `src/services/criteria.ts` — the closed expression grammar, evaluator, award/revoke writer | new |
| `src/events/{consumer,*.handler}.ts` | ditto, **extended to all four required topics with real writes** |
| `Dockerfile` (`node:24-alpine`), `jest.config.ts`, `tsconfig.json`, `.npmrc` | ditto |

`package.json`: `engines.node >=24.0.0`, `npm >=10.0.0`, `@types/node ^24.13.3`, `file:` deps on
`@fuzefront/auth`, `@fuzefront/shared`, `@izzywdev/fuzefront-identity`. Structured logging via the
`logging` skill (pino, `reqId` child logger, redaction) — not raw `console.*` on the request path.

Tests under `tests/`: route tests per resource, `authz.middleware.test.ts` (**deny path and
fail-closed path**), `auth.middleware.test.ts`, `flags.force-on.test.ts`, TypeID prefix-mismatch
rejection, last-owner 409, `match=all` vs `match=any` search correctness, cursor walk with no gaps or
duplicates, and each of the four event handlers.

`tests/graph.test.ts` carries the hierarchy cases, and they are the ones most likely to be got
wrong: direct and transitive cycle rejection; **two concurrent edge writes that would close a cycle
between them** (the lock is the whole point — assert it, don't assume it); multi-parent fan-in and
diamond ancestry counted once; depth cap on write and on traversal; delete-with-children 409;
org-child→private-parent 422; cross-org edge rejection; a private child under an org parent
**invisible to a second org member's search but visible to its owner**; and a parent the caller
cannot read absent from `parents[]` **with no count and no placeholder** — assert the exact response
body, since a well-meaning `hiddenCount` is precisely the oracle rule 4 forbids.

`tests/match.test.ts`: a candidate missing one `requires` tag is excluded; `desires` ranks but never
excludes; **a descendant satisfies an ancestor requirement and an ancestor does NOT satisfy a
descendant requirement** (the inversion that will otherwise ship silently); **a `requires_first`
edge does NOT widen a match** — assert the absence, since walking the wrong edge kind produces
plausible-looking results no positive test will catch; a capability in a set the
caller cannot read does not satisfy a requirement for them; matched/missing tags reported per candidate.

`tests/criteria.test.ts`: manual apply of an earned tag → 409; award fires exactly at the threshold
and not below; revoke fires when a metric drops; a time-based criterion awards on the periodic sweep
with no metric push; `tag_awards` rejects UPDATE and DELETE at the database level, not just in the
service; `evidence` holds the snapshot that justified the decision and stays correct after metrics
move; a malformed or non-closed criteria expression → 422; metric ingestion is idempotent per
`(subject, metric_key, observed_at)` and rejects a future `observed_at`; progress is visible to the
subject, visible to a manager grant, and **404 — not 403 — to an ordinary org member**.

### PR 4 — Design system primitives (`frontend-engineer`, sole editor of `design-system/`)
`design-system/components/core/Chip.jsx`, `design-system/components/forms/TagInput.jsx` and
`design-system/components/data/TagGraph.jsx` and
`design-system/components/feedback/CriteriaProgress.jsx` — each with its `.d.ts`, `.prompt.md` and
`.test.jsx`, the DS's per-component file convention. `TagGraph` renders a **DAG**, so it must handle
a node reachable by several paths without duplicating its identity or implying a canonical parent.
`CriteriaProgress` composes the existing `ProgressMeter` rather than reinventing a bar. Both are
presentational only and take already-filtered data — **neither decides visibility**, which stays
server-side where rule 4 and the progress-authorization rule are enforced. Tokens only, no raw hex/px/type; RTL/LTR; keyboard a11y (backspace removes last chip,
arrow-key option navigation, `aria-multiselectable`, announced removals). Exported from
`design-system/index.js`, registered in `_ds_manifest.json`, `npm run build` in `design-system/`.
Follow the `design-system-conformance` skill; `gate-ds-conformance` enforces it.

### PR 5 — UI package + host wiring (`frontend-engineer`, blocked on PR 2 approval + PR 4)
`packages/tags-ui/` → `@fuzeone/tags-ui`, copying `packages/selection-lists-ui/package.json`:
`type: module`, dual exports, `peerDependencies` `@fuzefront/design-system ^1.0.0`, `react ^19.0.0`,
`react-dom ^19.0.0`, `react-router-dom ^7.0.0`; `publishConfig` restricted; vite + `vite-plugin-dts`;
vitest. Components consume **only** the DS and `@fuzeone/tag-client` — no `fetch` in components, no
one-off styling.

Flow orchestrators, one per approved flow, with the `data-*` hooks the frames declare so the RED
Playwright specs bind. Host wiring in `frontend/src/App.tsx` (routes under `/settings/tags`, each
wrapped in a `useFlag('fuzefront.tags.service', false)` guard exactly as
`SelectionListsRoute` does at `frontend/src/App.tsx:518`) and a nav entry in
`frontend/src/components/SidePanel.tsx` behind the same flag.

Also export an embeddable `<TagPicker>` — the reason `Chip`/`TagInput` go in the DS base rather than here.

### PR 6 — Deploy wiring (`devops-engineer`)
- `deploy/helm/fuzefront/values.yaml`: a `tagService` block copying `selectionListService`
  (values.yaml:762). **Port 3014** — verified free (3007 is payment-service, 3012/3013 devportal).
  `enabled: false`. `networkPolicy.port: 3014` **declared explicitly as a literal** — no `| int`,
  `| default` or `| toString`, per the FuzeInfra#501 outage note in CLAUDE.md and the warning comment
  already at values.yaml:752.
- `deploy/helm/fuzefront/templates/tag-service-{deployment,service,networkpolicy}.yaml` +
  `tag-service-db-bootstrap-job.yaml` copying `config-service-db-bootstrap-job.yaml`: idempotent
  least-privilege `tag_svc` role + `tags` schema in the **shared** database, `pre-install,pre-upgrade`
  hook, weight `-4`. **Ordering trap, from that file's own comment:** the hook runs before the
  SealedSecret's sync wave, so `TAG_DB_PASSWORD` must land in the Secret in an *earlier* sync —
  seal it and merge that first, then enable the service. Enabling both at once fails the hook and
  therefore the whole Argo sync.
- `.github/workflows/release.yml`: a `services/tag-service/**` path filter (~line 60), a
  "Build & push tag-service" step with **root build context** (~line 307), and the prod values
  tag-bump awk rule (~line 579). There is no matrix — these are three explicit edits.
- Argo: the umbrella `fuzefront` chart, not a separate Application — tag-service has no independent
  release cadence.
- SemVer bumps per `governance/versioning.md`; `gate-version` enforces.

### PR 7 — Independent verification (`test-engineer` + `frontend-test-engineer`)
`test-engineer`: acceptance suite against the frozen contract — scope isolation (a private set is
invisible to another user; an org set is invisible to another org), prefix-mismatch rejection,
`match=all`/`match=any`, `includeDescendants` on and off, cursor exhaustiveness, fail-closed authz,
flag OFF and ON. Plus an **adversarial hierarchy-leak pass**, treated as a security test and not a
functional one: with a private tag hung under an org parent, prove a second org member cannot learn
it exists through search results, result counts, `parents[]`/`descendants`, pagination `total`,
error messages, or response-time differences.
`frontend-test-engineer`: Playwright per approved flow (**ALL RED first**, written on PR 2's merge),
plus the **mandatory console-clean gate** via the Chrome DevTools MCP — 0 errors, 0 CSP/mixed-content
violations, 0 failed app requests, or every remaining message explained. A runtime console error is
REPORTED, never patched by QA.

## Files to create or modify

**New:** `services/tag-service/**`, `tag-client/**`, `packages/tags-ui/**`,
`design/frames/tags/**`, `design-system/components/core/Chip.*`,
`design-system/components/forms/TagInput.*`, `design-system/components/data/TagGraph.*`,
`design-system/components/feedback/CriteriaProgress.*`,
`deploy/helm/fuzefront/templates/tag-service-*.yaml`,
`docs/planning/epics/EPIC-tags.md`.

**Modified:** `packages/identity/src/registry.ts`,
`packages/identity-py/fuzefront_identity/registry.py`, `design-system/index.js`,
`design-system/_ds_manifest.json`, `frontend/src/App.tsx`,
`frontend/src/components/SidePanel.tsx`, `deploy/helm/fuzefront/values.yaml`,
`.github/workflows/release.yml`, `package.json` / `lerna.json` workspaces.

**Reused, not rewritten:** `mintId()` / `prefixFor()` (`packages/identity/src/{id,registry}.ts`),
`createAuthzClient` / `AuthzClient` (`packages/auth`), `authMiddleware`
(`services/selection-list-service/src/middleware/auth.ts` as template), `getBooleanFlag` / `FLAGS`
(`packages/feature-flags`), `shared/src/kafka` topics + consumer, `fuzefront.labels` /
`fuzefront.scheduling` / `fuzefront.secretName` helpers (`deploy/helm/fuzefront/templates/_helpers.tpl`),
and the whole `@fuzefront/design-system` primitive set.

## Verification (for the implementation sessions)

**Service, locally:**
```
cd services/tag-service && npm ci && npm run build && npm test
npm run migrate                      # against the local Postgres
docker compose -f docker-compose.consumer-test.yml up   # bounded local stack, per the local-environment skill
curl -s localhost:3014/health
```
Then exercise the real flow against a running instance with a real JWT: create an org tag set → add
tags → tag two objects of *different* TypeIDs → `GET /v1/tags/search?tags=a,b&match=all` returns only
the object carrying both → `match=any` returns both → delete a tag still applied returns 409 →
a tagging whose `objectId` prefix contradicts `objectType` returns 400 → a second user in another org
cannot see either set. Then the hierarchy: build a diamond (two parents converging), confirm a cycle
attempt returns 409, confirm a search for the root finds an object tagged only with a leaf, hang a
private tag under an org parent and confirm a second org member's search for that parent does **not**
surface it, and confirm the org-child→private-parent direction returns 422.

Then the projection and the ladder: tag two agents `has: [Spanish, Billing]` and
`has: [Spanish — Mexico, Billing, Retention]`, tag a line `requires: [Spanish, Billing]`,
`desires: [Retention]`, and confirm `GET /v1/match` returns both with the second ranked first and the
**specific** `Spanish — Mexico` satisfying the general `Spanish` requirement. Give a tag criteria of
`tenure_days >= 90 AND calls_rated_4plus >= 500`, confirm a hand-apply returns 409, push metrics at
`499` and confirm no award, push `500` and confirm the award plus its `evidence` snapshot, push `400`
and confirm the revoke row, then confirm an ordinary org member gets **404** from
`/v1/tags/{id}/progress` for that subject while the subject themselves gets the numbers.

**Gates, before pushing each PR:**
```
python3 scripts/gate_identifier.py --registry-parity
python3 scripts/gate_microservice_events.py --report     # tag-service must show no missing events
python3 scripts/gate_pagination.py
node scripts/check-frames-first.mjs --report-uncovered
npx spectral lint services/tag-service/openapi.yaml --ruleset services/tag-service/.spectral.yaml --fail-severity=hint
helm lint deploy/helm/fuzefront && helm template deploy/helm/fuzefront --set tagService.enabled=true | kubeconform -ignore-missing-schemas
```
For PR 6 specifically, per the CLAUDE.md Helm-hygiene rule: **diff `helm template` output before vs.
after for `values.yaml`, `values-local.yaml` and `values-prod.yaml`** — not just the YAML line diff —
and grep the new templates for `| int`, `| default`, `| toString` on any `.Values.` port lookup.

**UI:** `npm test` in `packages/tags-ui` and `design-system`; `npx playwright test` for the flow
specs; then render the real shell in Chromium via the Chrome DevTools MCP (`ui-runtime-validation`
skill) with the flag ON **and** OFF and confirm the console is clean in both.

**Done** (for each implementation PR) = squash-merged with the `auto-merge` label, CI green, Claude
Approvals passing. The flag stays OFF until the owner asks for the ramp (`unleash-flag-enable`).

## Explicitly out of scope

- **Leaderboards, points and cross-org ranking** — the earned-tag ladder is the mechanic; ranking
  people against each other is a separate product question with its own privacy weight.
- **The call-centre product itself** — telephony, call records, star ratings and the ACD routing that
  consumes `/v1/match` all live in the owning product. tag-service receives metric values and never
  learns what a call is; it must stay the family tag service, not a call-centre backend.
- **The resolver registry** — search returns bare `{objectType, objectId}` refs; consumers resolve
  display data. Deferred by your choice; revisit if every consumer ends up writing the same resolver.
- **A materialised `tag_closure` table** — recursive CTEs first; the closure table is the named
  escalation if traversal becomes the bottleneck, not a v1 build.
- **Tag merge / rename / bulk re-tag** — real operations, but each needs its own UX and an audit
  trail. Not in v1.
- **Tag suggestion / auto-tagging.**
- **Tagging from inside other products' UIs** — this pass ships the service, the API, the standalone
  management UI, and an embeddable `<TagPicker>`; wiring that picker into each consuming product is
  that product's work.
- **FuzeInfra changes** — Kafka topics or shared-Postgres capacity, if either is needed, are
  delegated via `@fuze` with the concrete change spelled out. Never edited from here.
