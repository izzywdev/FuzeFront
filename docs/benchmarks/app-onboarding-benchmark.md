# Benchmark: cost of onboarding an application onto FuzeFront

**Status:** specification v1. No results have been published yet — see
[`results/`](results/).

**Goal:** give the "compounding organizational leverage" thesis a measurable,
reproducible, falsifiable test, instead of an architecture claim. Closes
#1028.

## What this measures

The benchmark runs the documented, public local-evaluation path twice —
once for a first application ("App 1") and once for a second, independent
application ("App 2") — and records seven numbers/observations per run,
taken directly from the dimensions proposed in #1028:

| # | Dimension | How it is recorded |
|---|---|---|
| D1 | Time from `git clone` to a running environment | Wall-clock time from the `git clone` command to the moment `docker compose -f docker-compose.e2e.yml ps` first reports `postgres`, `redis`, `backend`, `security` and `authentik-worker` as `(healthy)`. |
| D2 | Time from a standalone app to a registered, mounted app | Wall-clock time from "the app's `remoteEntry.js` is being served" to "the app is visible and mounts inside the shell" (`http://localhost:4173`, sidebar → **APPS**). |
| D3 | Number of manual configuration steps | Count of distinct commands or file edits a human types/runs by hand to go from D1's start to D2's end. A step that an init container, script, or CI job performs on its own does **not** count; a step the runner has to type, paste, or hand-edit does. |
| D4 | Number of platform (FuzeFront repo) files that must change | Count of edits made inside the FuzeFront checkout itself (outside the app's own directory) to register the app. A compliant self-registering app should score 0 here; see "A known asymmetry" below. |
| D5 | Deployment steps | Count of distinct deploy actions for the Kubernetes path in `docs/ADOPTION_QUICKSTART.md` §2 (`kind-up`, each `docker build`, `kind load docker-image`, each `helm upgrade --install`). Record separately from D1–D4, which use the Docker Compose path. |
| D6 | Failure/recovery clarity | For every failure hit while running the procedure, record: the exact error text, whether `docs/ADOPTION_QUICKSTART.md`'s Troubleshooting section (or this benchmark's own notes) named it, and how long it took to resolve using only the documented fix. A failure with no documented fix is a finding, not a disqualifier — record it and open an issue. |
| D7 | Repeated effort: App 2 vs App 1 | D1–D6 computed for App 2, plus the delta (App1 − App2) for each of D1–D5. A negative delta (App 2 slower/costlier) is a valid, reportable result — the benchmark does not assume the thesis is true. |

## What this explicitly does NOT measure

Scoping this out is as important as the table above — a benchmark that
silently expands its own scope stops being comparable across runs.

- **Cloud/production deployment.** Only the local Docker Compose path (D1–D4,
  D6–D7) and the local `kind` Kubernetes path (D5) are in scope. EKS, Contabo
  k3s, GitOps sync time, and Cloudflare Tunnel/Access are **out** — they need
  non-public credentials and infrastructure this benchmark's "public
  repository components only" constraint cannot assume a runner has.
- **CI runtime.** GitHub Actions job duration is a different, already-measured
  thing (`.github/workflows/e2e.yml`'s own timing); this benchmark measures a
  human/agent running the documented path on their own machine.
- **Build/compile performance** of the app being onboarded, independent of
  platform integration (e.g. `npm run build` time for a large app). Only the
  *platform-integration* steps count toward D1–D5; note app build time
  separately in the results file if you want it on record, but it is not
  part of the scored dimensions.
- **Security/authorization correctness.** Whether the registered app's
  authz policy is correct is `gate-authz` / `endpoint-authorization`'s job,
  not this benchmark's.
- **Comparison against other platforms** (Backstage, generic IDPs, a
  from-scratch Module Federation setup). That comparison is explicitly in
  scope for the [Architecture Review](https://github.com/izzywdev/FuzeFront/issues/1015),
  not here. This benchmark only measures FuzeFront against itself, over time
  and across runners.
- **Subjective "would I use this" sentiment.** D6 records clarity of
  documented failure recovery, not a satisfaction score.

## A known asymmetry worth recording honestly

`docs/ADOPTION_QUICKSTART.md`'s documented local path registers `clock-app` by
running `docker compose exec postgres psql ... INSERT INTO apps ...` directly
against the platform database. That is a D4 cost of at least 1 (a
platform-side manual step reaching into the FuzeFront database) that the
platform's own production-grade mechanism — self-registration via
`@fuzefront/onboarding-kit` (`POST /apps` + `POST /apps/{slug}/activate`,
normally run by an init container, see `packages/onboarding-kit/README.md`)
— is designed not to have, because the app registers itself with no
FuzeFront-side edit at all.

**This benchmark's primary, scored path is the quickstart `psql` path**,
because it is the only one that actually runs against
`docker-compose.e2e.yml` as shipped: `register.sh`'s writes
(`POST /apps`, `POST /apps/{slug}/activate`) are served by the separate
`applications` service (`backend/src/routes/appRegistry.ts`'s own comment:
write routes "fall through to the applications-service proxy", which
defaults to `http://fuzefront-applications:3003`), and that service is **not**
one of the containers `docker-compose.e2e.yml` starts — only
`APP_REGISTRY_LOCAL_ADAPTER=1`'s local-DB read fallback is. A runner who
tries the onboarding-kit path against the public e2e stack as documented
will hit a connection failure, not a successful registration.

Do not silently skip this — it is itself a D6 finding worth recording
verbatim ("the production onboarding path is not reachable from the public
local evaluation stack") rather than papering over it by quietly falling
back to the `psql` path without saying so. If a future run stands up the
`applications` service separately (outside the scope this benchmark can
assume — see "What this explicitly does NOT measure") to exercise the
onboarding-kit path for real, record it as a clearly-labelled separate
result, not folded into the D1–D7 numbers above.

## Procedure

### Phase 0 — record the environment

Before starting the clock, record (the results template has fields for all
of these):

- Commit SHA of the FuzeFront checkout (`git rev-parse HEAD`).
- OS and version, CPU core count, RAM.
- `docker --version`, `docker compose version`, `node --version`, `npm --version`.
- Whether this is a cold run (first time running this stack on this machine —
  Docker image pulls/builds are not cached) or a warm run. Cold vs. warm
  changes D1 by minutes, so the two are not comparable without this label.

### Phase 1 — App 1 (`clock-app`)

Follow `docs/ADOPTION_QUICKSTART.md` §1 "Developer: run the platform locally"
exactly as written, start to finish, timing as you go:

1. Start the timer, then `git clone` + `docker compose -f docker-compose.e2e.yml up -d --build`.
2. Poll `docker compose -f docker-compose.e2e.yml ps` until `postgres`,
   `redis`, `backend`, `security`, and `authentik-worker` show `(healthy)`.
   Stop the timer → **D1**.
3. Create an account at `http://localhost:4173` (not timed; this is identity
   setup, not app onboarding).
4. Start the timer again at `cd clock-app && npm install`. Build, preview,
   and register `clock-app` using the quickstart `psql` insert path (see "A
   known asymmetry" above for why that is the scored default rather than
   onboarding-kit). Stop the timer the moment Clock mounts inside the shell
   and shows "Mounted inside FuzeFront: yes" → **D2 (App 1)**.
5. While doing steps 1–4, tally every command typed/file edited by hand →
   **D3 (App 1)**, and every edit made inside the FuzeFront checkout itself
   (outside `clock-app/`) → **D4 (App 1)**.
6. Record every error message hit and how it was resolved → **D6 (App 1)**.

### Phase 2 — App 2 (a second, independent app)

To isolate *platform* learning effect from *app* complexity, App 2 must be
**comparably trivial to clock-app**, not a larger real product — otherwise a
slower App 2 run tells you the second app was bigger, not that the platform
failed to compound. Build a second minimal Module Federation app the same
way `clock-app` is built (a Vite app exposing one component via
`@originjs/vite-plugin-federation`), under a different name/port/slug, and
repeat Phase 1 steps 4–6 for it only (the environment from Phase 1 is still
running — D1 is not repeated for App 2, since "time to a running environment"
is a one-time platform cost, not a per-app one).

If you additionally want a real-world data point, a second pass using
`FuzeQuality` (already vendored in this repository, with its own
`registration/manifest.json`) is a reasonable advanced/optional addition —
but record it as a separate, labelled run, since `FuzeQuality` is not
comparably trivial to `clock-app` and mixing the two breaks the D7
comparison.

Compute **D7**: App1 − App2 for D2–D4 (D1 is shared/not repeated), plus a
side-by-side of D6.

### Phase 3 — Kubernetes path (optional, D5 only)

Follow `docs/ADOPTION_QUICKSTART.md` §2 "Platform engineer: run the
Kubernetes path" and count the distinct deploy actions listed there → **D5**.
This phase does not require Phase 1/2 to have been run first.

### Phase 4 — tear down and publish

`docker compose -f docker-compose.e2e.yml down -v`. Copy
[`results-template.md`](results-template.md) to `results/<YYYY-MM-DD>-<runner>.md`,
fill it in with the numbers and notes gathered above, and open a PR. See
[`results/README.md`](results/README.md).

## Reproducibility constraints

Every command referenced above is already documented and public:
`docs/ADOPTION_QUICKSTART.md`, `packages/onboarding-kit/README.md`, and the
`clock-app/` directory, all in this repository, with no non-public
credentials, cloud account, or proprietary tooling required. A runner needs
only Git, Docker Desktop, and Node.js 24+/npm 10+ — the same prerequisites
`ADOPTION_QUICKSTART.md` already states.
