---
name: unleash-flag-enable
description: Use to ENABLE, ramp, or roll back a named feature flag in the family's self-hosted Unleash — turning an already-shipped, dark (default-OFF) release flag ON in an environment, ramping a flexibleRollout percentage, GA-ing to 100%, or breaking-glass an ops-kill-switch. Covers the idempotent Unleash Admin API procedure (create-if-absent, enable the environment, add/patch the flexibleRollout strategy), the credential + reachability reality (CF-Access-gated prod host / in-cluster port-forward, the admin token, the browser WEB_EXPOSED_FLAGS catalog gotcha), a dispatchable GitHub Actions workflow that performs the flip from CI, verification of BOTH states, and rollback. Owned by feature-flags-engineer. Pairs with the `feature-flags` skill (which covers authoring/coding a flag); this one covers operating the toggle.
---

# Enable a feature flag in Unleash

The `feature-flags` skill covers **authoring** a flag (type, naming, default, reading it in code, testing both states). This skill covers the other half: **operating the toggle** — turning a shipped, dark flag ON, ramping it, GA-ing to 100%, or rolling it back — against the family's self-hosted Unleash, as a repeatable procedure instead of a hand-copied runbook that drifts.

**Scope boundary (do not blur these — `feature-flags` skill has the full split):**
- `feature-flags-engineer` **owns Unleash config, the flag taxonomy, and flag administration** — this skill.
- `devops-engineer` owns the Unleash **deployment** (Helm/Argo/CI) and the **secrets** (`UNLEASH_ADMIN_TOKEN`, CF-Access service token) this skill consumes.
- `backend-engineer` owns the `@fuzefront/feature-flags` **client package build**, including the browser-exposed catalog (`WEB_EXPOSED_FLAGS`) — see the catalog gotcha below.

**Enabling a flag is not a substitute for authorization.** A `permission` flag is rollout convenience; real entitlement stays in Permit (`permit.check`). Never flip a flag ON believing it gates access — it gates *visibility/rollout*, not security.

## Before you flip: three preconditions

1. **The flag is default-OFF in code and both states are tested.** If it isn't shipped dark and proven in both directions, you are releasing untested code with a toggle, not operating a flag. Stop and finish the `feature-flags` authoring checklist first.
2. **An owner decision authorizes the target state.** Record who decided and the target (e.g. "GA 100%, no segment, prod") — in the flag's Unleash description and the PR/issue that requested it. An enable with no named owner is an unaudited production change.
3. **For a browser-visible flag: it is in `WEB_EXPOSED_FLAGS`.** See the catalog gotcha — this is the single most common "I flipped it and nothing happened" cause.

## The browser catalog gotcha — read this before enabling any UI-facing flag

The browser does **not** read Unleash directly. It reads `GET /api/flags`, which returns **only** the keys listed in `packages/feature-flags/src/catalog.ts`'s `WEB_EXPOSED_FLAGS`. The frontend `useFlag(key, default)` hook returns the caller's **hardcoded default** whenever the key is absent from that response — so a UI flag that is not in `WEB_EXPOSED_FLAGS` reads as permanently its default **no matter what Unleash says.**

- **Server-only flags** (consumed via `getClient().getBooleanValue(...)` on the backend) take effect on the Unleash flip alone — they are deliberately NOT web-exposed.
- **Browser-visible flags** need their key in both `FLAG_KEYS` and `WEB_EXPOSED_FLAGS` (owned by `backend-engineer`), merged and deployed, **before or alongside** the Unleash flip — otherwise the toggle is green and the UI stays dark, which reads as "the flag is broken" when it is working server-side. Confirm this first; if the key is missing, file/confirm the `backend-engineer` catalog change as a blocking predecessor.

## Reachability + credentials — the wall, and how CI gets past it

Unleash is FuzeFront-hosted. The admin API is reachable two ways, and an ad-hoc interactive session usually has **neither**:

- **Prod host** `https://unleash.prod.fuzefront.com` — **Cloudflare-Access-gated.** An unauthenticated request gets a `302` to the CF-Access login page (or a `403`), never the API. A browser session with CF-Access SSO can drive the Unleash UI by hand; a *programmatic* caller needs a **CF-Access service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers).
- **In-cluster** `http://fuzefront-unleash:4242` — reachable only with cluster access: `kubectl -n fuzefront port-forward svc/fuzefront-unleash 4242:4242`. Not resolvable from outside the cluster.

The **admin API token** is in the `unleash-secrets` Secret (`INIT_ADMIN_API_TOKENS`) — never in an app repo, never printed. A **frontend/proxy** token (for verification via `/api/frontend`) is a separate, lower-privilege token; use it for read-back and revoke it after.

**Because an interactive/agent session generally cannot reach the admin API, the durable answer is the dispatchable workflow below** — it runs in CI, where the token lives as a secret, so the flip happens through `workflow_dispatch` instead of hunting for an operator with a CF-Access session. This is the recommended path; the raw `curl` procedure is the fallback and the thing the workflow itself runs.

## The procedure (Unleash Admin API)

Three distinct switches — a flag evaluates ON only when **all three** line up: it exists, its environment is enabled, and it has an enabling strategy. A flag with a strategy but a disabled environment still evaluates OFF.

```bash
UNLEASH="${UNLEASH_ADMIN_URL:-http://localhost:4242}"   # in-cluster port-forward, or the CF-Access host
TOKEN="$UNLEASH_ADMIN_TOKEN"                             # from unleash-secrets INIT_ADMIN_API_TOKENS — never echo it
PROJECT="${UNLEASH_PROJECT:-default}"
ENVIRONMENT="${UNLEASH_ENVIRONMENT:-production}"

# One idempotent-as-noted function; call it per flag rather than hand-copying blocks that drift.
enable_flag() {
  local FLAG="$1" ROLLOUT="${2:-100}" TYPE="${3:-release}" DESCRIPTION="${4:-}"
  echo "=== $FLAG -> ${ROLLOUT}% ($ENVIRONMENT) ==="

  # 1. Create if absent. Idempotent: Unleash returns 409 for an existing name, which we tolerate.
  #    Build the JSON with python3 — a name/description containing a double-quote would
  #    break a hand-spliced JSON body (and abort mid-flight, after the env is enabled).
  local create_body
  create_body=$(FLAG="$FLAG" TYPE="$TYPE" DESCRIPTION="$DESCRIPTION" python3 -c \
    'import json,os;print(json.dumps({"name":os.environ["FLAG"],"type":os.environ["TYPE"],"description":os.environ["DESCRIPTION"]}))')
  code=$(curl -sS -o /tmp/uf_create.json -w '%{http_code}' -X POST \
    "$UNLEASH/api/admin/projects/$PROJECT/features" \
    -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d "$create_body")
  case "$code" in
    201) echo "  create: created" ;;
    409) echo "  create: already exists" ;;
    *)   echo "  create: FAILED ($code)"; cat /tmp/uf_create.json; return 1 ;;
  esac

  # 2. Enable the environment (a distinct switch from strategies).
  curl -sfX POST \
    "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/on" \
    -H "Authorization: $TOKEN" && echo "  environment on: ok" || { echo "  environment on: FAILED"; return 1; }

  # 3. Strategy: flexibleRollout at ROLLOUT%, no segment.
  #    IDEMPOTENCY CAVEAT: POST /strategies is NOT idempotent — re-running it creates a
  #    DUPLICATE strategy. If a flexibleRollout strategy already exists (e.g. a prior
  #    staged ramp), PATCH it instead of POSTing a new one. Discover first:
  existing=$(curl -sf "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
    -H "Authorization: $TOKEN")
  sid=$(printf '%s' "$existing" | python3 -c "import sys,json; xs=[s for s in json.load(sys.stdin) if s.get('name')=='flexibleRollout']; print(xs[0]['id'] if xs else '')" 2>/dev/null)

  # Build strategy bodies with python3 too — never splice $FLAG/$ROLLOUT into JSON by hand.
  local patch_body post_body
  patch_body=$(FLAG="$FLAG" ROLLOUT="$ROLLOUT" python3 -c \
    'import json,os;print(json.dumps({"parameters":{"rollout":os.environ["ROLLOUT"],"stickiness":"default","groupId":os.environ["FLAG"]}}))')
  post_body=$(FLAG="$FLAG" ROLLOUT="$ROLLOUT" python3 -c \
    'import json,os;print(json.dumps({"name":"flexibleRollout","parameters":{"rollout":os.environ["ROLLOUT"],"stickiness":"default","groupId":os.environ["FLAG"]}}))')

  if [ -n "$sid" ]; then
    curl -sfX PUT \
      "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies/$sid" \
      -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
      -d "$patch_body" \
      && echo "  strategy patched -> ${ROLLOUT}%" || { echo "  strategy patch: FAILED"; return 1; }
  else
    curl -sfX POST \
      "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
      -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
      -d "$post_body" \
      && echo "  strategy added -> ${ROLLOUT}%" || { echo "  strategy add: FAILED"; return 1; }
  fi
}

# Example — GA a release flag to 100%, no segment:
enable_flag "fuzefront.identity.member-directory" 100 release \
  "GA per owner decision <date/link>. Owner: feature-flags-engineer. Removal: delete once stable at 100% and the OFF path is unused."
```

- **Staged ramp** (safer default for a risky change): call `enable_flag <flag> 10`, soak, then `25`, `50`, `100`. The PATCH branch makes each step idempotent.
- **Segment targeting** (e.g. a `developers` cohort before a percentage ramp) is a separate strategy shape — add the `constraints`/`segments` on the strategy body. Once a flag is 100% for everyone, a segment overlay is redundant; drop it to keep the strategy list legible.
- **`stickiness: default` + a stable `groupId`** make a user's bucket stable across evaluations — a user at 25% stays in the same 25% as you ramp, rather than being re-diced each step.

## Dispatchable GitHub Actions workflow (the CI path past the CF-Access wall)

Drop this in the **Unleash-hosting repo** (FuzeFront) as `.github/workflows/unleash-enable-flag.yml`. It performs the flip from CI, where the token lives, so no operator needs a CF-Access session. `workflow_dispatch` only — it never runs on push. Provision the secrets (`devops-engineer`): `UNLEASH_ADMIN_URL`, `UNLEASH_ADMIN_TOKEN`, and — if the runner reaches Unleash through Cloudflare Access rather than in-cluster — `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` (a CF-Access **service token**). It fails closed with a clear message if a required secret is absent.

```yaml
name: unleash-enable-flag

# Enable / ramp / roll back a single Unleash flag from CI. workflow_dispatch only —
# the credential lives here as a secret, so the flip does not need an operator with a
# live Cloudflare-Access session. Owned by feature-flags-engineer; secrets by devops.
on:
  workflow_dispatch:
    inputs:
      flag:
        description: 'Flag key, e.g. fuzefront.identity.member-directory'
        required: true
      rollout:
        description: 'flexibleRollout percentage (0-100). 0 = present-but-off.'
        required: true
        default: '100'
      environment:
        description: 'Unleash environment'
        required: true
        default: 'production'
      type:
        description: 'Flag type if it must be created (release|ops-kill-switch|experiment|permission)'
        required: true
        default: 'release'
      description:
        description: 'Owner + decision + removal criterion (stored on the flag)'
        required: false
        default: ''
      action:
        description: 'enable (env on + strategy) or disable (env off — fast rollback)'
        required: true
        default: 'enable'

permissions:
  contents: read

concurrency:
  group: unleash-flag-${{ github.event.inputs.flag }}-${{ github.event.inputs.environment }}
  cancel-in-progress: false

jobs:
  toggle:
    runs-on: ubuntu-latest
    steps:
      - name: Preconditions
        env:
          UNLEASH_ADMIN_URL: ${{ secrets.UNLEASH_ADMIN_URL }}
          UNLEASH_ADMIN_TOKEN: ${{ secrets.UNLEASH_ADMIN_TOKEN }}
          # Pass inputs through env, NEVER inline ${{ github.event.inputs.* }} into a run
          # script — a workflow_dispatch caller could otherwise inject shell commands
          # (GitHub Actions script injection). Same safe pattern as the Toggle flag step.
          ROLLOUT: ${{ github.event.inputs.rollout }}
        run: |
          set -euo pipefail
          : "${UNLEASH_ADMIN_URL:?UNLEASH_ADMIN_URL secret is not set — devops must provision it}"
          : "${UNLEASH_ADMIN_TOKEN:?UNLEASH_ADMIN_TOKEN secret is not set — devops must provision it}"
          case "$ROLLOUT" in ''|*[!0-9]*) echo "rollout must be an integer 0-100"; exit 1;; esac
          [ "$ROLLOUT" -le 100 ] || { echo "rollout must be <= 100"; exit 1; }

      - name: Toggle flag
        env:
          UNLEASH_ADMIN_URL: ${{ secrets.UNLEASH_ADMIN_URL }}
          UNLEASH_ADMIN_TOKEN: ${{ secrets.UNLEASH_ADMIN_TOKEN }}
          CF_ACCESS_CLIENT_ID: ${{ secrets.CF_ACCESS_CLIENT_ID }}
          CF_ACCESS_CLIENT_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
          FLAG: ${{ github.event.inputs.flag }}
          ROLLOUT: ${{ github.event.inputs.rollout }}
          ENVIRONMENT: ${{ github.event.inputs.environment }}
          FTYPE: ${{ github.event.inputs.type }}
          DESCRIPTION: ${{ github.event.inputs.description }}
          ACTION: ${{ github.event.inputs.action }}
          PROJECT: default
        run: |
          set -euo pipefail
          AUTH=(-H "Authorization: $UNLEASH_ADMIN_TOKEN")
          # Attach a CF-Access service token only if provided (in-cluster runners don't need it).
          if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
            AUTH+=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
          fi
          base="$UNLEASH_ADMIN_URL/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT"

          if [ "$ACTION" = "disable" ]; then
            curl -sf "${AUTH[@]}" -X POST "$base/off"
            echo "::notice::disabled $FLAG in $ENVIRONMENT (strategy left intact for clean re-enable)"
            exit 0
          fi

          # create-if-absent (tolerate 409). Build every JSON body with python3 — the
          # free-form $DESCRIPTION (and $FLAG) must never be spliced into JSON by hand,
          # or a quote character produces malformed JSON and a half-enabled flag.
          create_body=$(python3 -c 'import json,os;print(json.dumps({"name":os.environ["FLAG"],"type":os.environ["FTYPE"],"description":os.environ["DESCRIPTION"]}))')
          code=$(curl -sS -o /tmp/c.json -w '%{http_code}' -X POST \
            "$UNLEASH_ADMIN_URL/api/admin/projects/$PROJECT/features" \
            "${AUTH[@]}" -H 'Content-Type: application/json' -d "$create_body")
          case "$code" in 201|409) : ;; *) echo "create failed ($code)"; cat /tmp/c.json; exit 1;; esac

          curl -sf "${AUTH[@]}" -X POST "$base/on"

          existing=$(curl -sf "${AUTH[@]}" "$base/strategies")
          sid=$(printf '%s' "$existing" | python3 -c "import sys,json;xs=[s for s in json.load(sys.stdin) if s.get('name')=='flexibleRollout'];print(xs[0]['id'] if xs else '')")
          patch_body=$(python3 -c 'import json,os;print(json.dumps({"parameters":{"rollout":os.environ["ROLLOUT"],"stickiness":"default","groupId":os.environ["FLAG"]}}))')
          post_body=$(python3 -c 'import json,os;print(json.dumps({"name":"flexibleRollout","parameters":{"rollout":os.environ["ROLLOUT"],"stickiness":"default","groupId":os.environ["FLAG"]}}))')
          if [ -n "$sid" ]; then
            curl -sf "${AUTH[@]}" -H 'Content-Type: application/json' -X PUT "$base/strategies/$sid" -d "$patch_body"
          else
            curl -sf "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "$base/strategies" -d "$post_body"
          fi
          echo "::notice::$FLAG set to ${ROLLOUT}% in $ENVIRONMENT"
```

## Verify — both states, per the `feature-flags` done checklist

Read back with a **temporary frontend-type token** (revoke immediately after), or the host's `GET /api/flags` for web-exposed keys once the catalog change has shipped:

```bash
curl -sf "$UNLEASH/api/frontend" -H "Authorization: $FRONTEND_TOKEN" -H 'Content-Type: application/json' \
  | python3 -c "import sys,json;print([t for t in json.load(sys.stdin)['toggles'] if t['name']=='$FLAG'])"
# revoke $FRONTEND_TOKEN now
```

| State | Expected |
|---|---|
| Enabled at 100%, no segment | `enabled: true` for every real evaluation context |
| Partial rollout | `enabled` varies by the sticky bucket; a fixed `userId` stays stable across evaluations |
| Unleash unreachable | in-code fail-safe (**OFF** for release, **ON** for kill-switch) — never the enabled state |

Application-level "both states" coverage is the merged unit/integration tests that pin the flag via the in-memory provider — those are independent of the live toggle and must already exist (that is the `feature-flags` authoring gate, not this one).

## Rollback — disable the environment, don't delete the strategy

Fastest, cleanest rollback: turn the **environment** off. It leaves the strategy intact, so a re-enable returns to the same state without reconfiguring.

```bash
curl -sfX POST "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/off" -H "Authorization: $TOKEN"
```

**Release-flag rollback is forward-only for data.** Disabling stops *new* executions from taking the flagged path; it does **not** retroactively undo rows/side-effects already written while it was ON. A genuine data rollback is a separate migration, never a flag toggle. Say this explicitly when a flag gated a state-mutating path.

## Done checklist
- [ ] Owner decision + target state recorded (on the flag description and the requesting PR/issue)
- [ ] For a UI flag: key is in `WEB_EXPOSED_FLAGS` (`packages/feature-flags/src/catalog.ts`), merged + deployed
- [ ] Environment enabled AND a `flexibleRollout` strategy at the intended % (all three switches aligned)
- [ ] Strategy step was idempotent (PATCHed an existing strategy, did not POST a duplicate)
- [ ] Verified enabled-state read-back with a temporary frontend token (then revoked)
- [ ] Fail-safe confirmed: an Unleash outage yields the in-code default, not the enabled state
- [ ] Rollback path known (environment-off); for a state-mutating flag, the forward-only caveat stated
- [ ] The flip did not become the authorization boundary — Permit still gates any real entitlement
