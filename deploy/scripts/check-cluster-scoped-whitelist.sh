#!/usr/bin/env bash
# check-cluster-scoped-whitelist.sh — assert that every CLUSTER-SCOPED resource
# the FuzeFront chart renders is permitted by the `fuzefront` Argo AppProject's
# `clusterResourceWhitelist`, and that the whitelist grants nothing the chart
# does not actually render.
#
# WHY THIS EXISTS (FuzeFront live incident, 2026-09-28). Argo CD validates every
# resource in a sync against its Application's AppProject. A resource whose
# kind is cluster-scoped and absent from `clusterResourceWhitelist` is not
# merely skipped — the sync task is INVALID and Argo aborts the ENTIRE sync
# operation. One unpermitted kind therefore freezes every other resource in the
# Application, including unrelated image-tag bumps.
#
# That is exactly what happened. `workload-identity.yaml` (PR #1190) began
# rendering a `ClusterRole`/`ClusterRoleBinding` named
# `{{ .Release.Name }}-workload-authenticator`, while the `fuzefront` AppProject
# permitted only `{group: '', kind: Namespace}` as a cluster-scoped resource.
# Three successive GitOps image bumps produced zero movement in the cluster and
# nothing deployed for hours, because the whole Application was wedged on two
# RBAC objects. `helm lint` and `kubeconform` were green the entire time: they
# validate manifest SHAPE against the Kubernetes API schema, and an AppProject
# admission boundary is not in any manifest's schema. Nothing could have caught
# it before this check existed. Unblocked by PR #1198, which widened the
# whitelist; the layering analysis is in
# docs/planning/workload-identity-layering.md.
#
# This is the same class of gap as `check-authentik-public-paths.sh` (Traefik's
# PathPrefix semantics) and the NetworkPolicy port guard (FuzeInfra#501): a
# schema check confirmed the rendered manifest had the right SHAPE while the
# behaviour of the controller that consumes it was wrong.
#
# ── WHICH AppProject IS AUTHORITATIVE ───────────────────────────────────────
# TWO definitions of the `fuzefront` AppProject exist today and they DISAGREE:
#
#   deploy/argocd/project.yaml            (this repo)  — Namespace + ClusterRole
#                                                        + ClusterRoleBinding
#   argocd/projects/fuzefront.yaml  (izzywdev/FuzeInfra) — Namespace ONLY
#
# This check gates against THIS REPO's copy, deliberately, because that is the
# one the cluster holds and the one the owner ruled should be authoritative:
#
#   * FuzeInfra#625 originally centralised AppProject ownership in FuzeInfra and
#     made `argocd-register.yml` SKIP any `kind: AppProject` from a consumer
#     path. Under that policy an in-repo `project.yaml` was inert.
#   * FuzeInfra#639 REVERSED the ownership half of that decision by explicit
#     owner ruling: consumers own their own AppProject so they can manage their
#     destination/resource allow-lists without a FuzeInfra PR for every change.
#     The `kind: AppProject` skip was removed, and `argocd-register.yml` now
#     `kubectl apply`s every manifest under the consumer's `deploy/argocd/`,
#     AppProject included. (#625's other outcome — the fleet-wide permission
#     NARROWING delivered in #629 — stands and is not in question.)
#   * Measured 2026-10-04: `argocd-register` ran successfully at 2026-09-28
#     07:55:16Z, 18 seconds after #1198 merged (07:54:58Z), and again at
#     08:40:52Z. Each run applied this repo's `deploy/argocd/project.yaml`.
#     The `fuzefront` Application syncs today, which it could not do if the
#     live project were the Namespace-only copy.
#
# Gating against a FETCHED copy of FuzeInfra's file was rejected: it would make
# this check depend on network access and on another repo's HEAD, so a FuzeInfra
# push could turn FuzeFront PRs red with no FuzeFront change — and it would gate
# against a file the owner has ruled is NOT authoritative. A COMMITTED copy was
# rejected for the opposite reason: a hand-synced duplicate of a file in another
# repo drifts silently, which is the precise failure this incident is made of.
#
# FuzeInfra's copy is a stale duplicate pending deletion per #639's own step 4.
# While it exists it is a LATENT RE-FREEZE: FuzeInfra's `deploy-prod.yml`
# re-applies `argocd/projects/*.yaml` on any push touching that directory (last
# such push 2026-08-23), and the AppProject is NOT reconciled by any Argo
# Application — this repo's app-of-apps watches `deploy/argocd/applications`,
# not `deploy/argocd` — so whichever imperative `kubectl apply` ran last wins.
# The next FuzeInfra push touching `argocd/projects/**` re-freezes this
# Application. That deletion cannot be made from this repo (FuzeInfra is never
# edited from a consumer); it is delegated in the issue referenced by
# docs/planning/workload-identity-layering.md.
#
# Usage:
#   check-cluster-scoped-whitelist.sh <rendered-templates-dir> [<appproject.yaml>]
#   check-cluster-scoped-whitelist.sh --self-test
set -euo pipefail

DEFAULT_PROJECT_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/deploy/argocd/project.yaml"

# ── kind → scope classification ─────────────────────────────────────────────
# Kubernetes does not encode scope in a manifest, so it has to be known. There
# is no cluster to ask (this runs on a PR runner), so the table is explicit.
#
# FAIL-CLOSED: a rendered kind in NEITHER list is an ERROR, not a pass. That is
# the whole lesson of the /applications incident recorded in
# check-authentik-public-paths.sh — a denylist only ever objects to what someone
# remembered to enumerate. If this errors on a kind you just added, classify it
# here; do not route around it.
CLUSTER_SCOPED_KINDS=(
  APIService
  CSIDriver
  CSINode
  ClusterIssuer
  ClusterRole
  ClusterRoleBinding
  ClusterSecretStore
  CustomResourceDefinition
  FlowSchema
  IngressClass
  MutatingWebhookConfiguration
  Namespace
  Node
  PersistentVolume
  PriorityClass
  PriorityLevelConfiguration
  RuntimeClass
  StorageClass
  ValidatingAdmissionPolicy
  ValidatingAdmissionPolicyBinding
  ValidatingWebhookConfiguration
  VolumeAttachment
)

NAMESPACED_KINDS=(
  Application
  AppProject
  Certificate
  ConfigMap
  CronJob
  DaemonSet
  Deployment
  Endpoints
  EndpointSlice
  ExternalSecret
  HorizontalPodAutoscaler
  Ingress
  IngressRoute
  Issuer
  Job
  LimitRange
  Middleware
  NetworkPolicy
  PersistentVolumeClaim
  Pod
  PodDisruptionBudget
  PrometheusRule
  ReplicaSet
  ResourceQuota
  Role
  RoleBinding
  Rollout
  ScaledObject
  SealedSecret
  Secret
  SecretStore
  Service
  ServiceAccount
  ServiceMonitor
  StatefulSet
  TraefikService
  VerticalPodAutoscaler
)

# Whitelist entries that are legitimately NOT rendered by any chart template.
# Format: "group/Kind|justification". Layer 2 below would otherwise flag these.
# Keep this list as short as the evidence allows — every entry is a standing
# cluster-level grant held for a reason that is not visible in the chart.
WHITELIST_JUSTIFIED_UNRENDERED=(
  "/Namespace|Argo creates the destination namespace itself via the CreateNamespace=true sync option, so no chart template renders a Namespace. Removing this grant breaks first-install into an absent namespace."
)

contains() {
  local needle="$1"; shift
  local item
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

# ── extraction: which cluster-scoped resources does the chart render? ───────
# $1 = directory of rendered YAML templates (helm template --output-dir)
# Prints one "group/Kind" per line, sorted+deduped, where group is "" for core.
# Errors (exit 1) on any kind missing from the classification table.
extract_cluster_scoped() {
  local dir="$1"
  local all_pairs
  # Walk each YAML document and emit its top-level apiVersion + kind. Only
  # column-0 keys count, so apiVersion/kind nested inside a ConfigMap's `data`
  # (e.g. authentik-blueprints.yaml, which embeds whole manifests as strings)
  # are correctly ignored. No YAML parser dependency, mirroring the other
  # rendered-manifest guards in this directory.
  all_pairs="$(
    find "$dir" -type f \( -name '*.yaml' -o -name '*.yml' \) -print0 \
      | xargs -0 -r awk '
        function flush() {
          if (kind != "") {
            group = apiv
            if (index(group, "/") > 0) { sub(/\/.*$/, "", group) } else { group = "" }
            printf "%s/%s\n", group, kind
          }
          apiv = ""; kind = ""
        }
        FNR == 1 { flush() }
        /^---[ \t]*$/ { flush(); next }
        /^apiVersion:[ \t]*/ {
          if (apiv == "") { v = $0; sub(/^apiVersion:[ \t]*/, "", v); gsub(/[ \t"'"'"']/, "", v); apiv = v }
          next
        }
        /^kind:[ \t]*/ {
          if (kind == "") { k = $0; sub(/^kind:[ \t]*/, "", k); gsub(/[ \t"'"'"']/, "", k); kind = k }
          next
        }
        END { flush() }
      ' | sort -u
  )"

  if [ -z "$all_pairs" ]; then
    echo "::error::no Kubernetes documents found in $dir — the extraction itself may be" \
         "broken. This check must never silently pass on nothing to check." >&2
    return 1
  fi

  local pair kind unclassified=0 cluster_pairs=""
  while IFS= read -r pair; do
    [ -n "$pair" ] || continue
    kind="${pair#*/}"
    if contains "$kind" "${CLUSTER_SCOPED_KINDS[@]}"; then
      cluster_pairs="${cluster_pairs}${pair}"$'\n'
    elif contains "$kind" "${NAMESPACED_KINDS[@]}"; then
      : # namespaced — the AppProject's namespaceResourceWhitelist governs it
    else
      echo "::error::kind '$kind' (rendered as '$pair') is in neither CLUSTER_SCOPED_KINDS nor" \
           "NAMESPACED_KINDS in deploy/scripts/check-cluster-scoped-whitelist.sh. This check" \
           "fails closed on purpose: it cannot tell whether '$kind' needs an AppProject" \
           "clusterResourceWhitelist entry, and guessing is how a sync-freezing kind ships" \
           "green. Add it to the correct list." >&2
      unclassified=1
    fi
  done <<< "$all_pairs"

  [ "$unclassified" -eq 0 ] || return 1
  printf '%s' "$cluster_pairs" | sort -u
}

# ── extraction: what does the AppProject permit? ────────────────────────────
# $1 = path to an AppProject YAML. Prints one "group/Kind" per line, sorted.
extract_whitelist() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "::error::AppProject file '$file' not found — cannot establish what the cluster" \
         "permits, so this check cannot pass." >&2
    return 1
  fi
  local entries
  entries="$(
    awk '
      BEGIN { in_block = 0; group = ""; kind = ""; have_group = 0 }
      function flush() {
        if (kind != "") { printf "%s/%s\n", group, kind }
        group = ""; kind = ""; have_group = 0
      }
      # Enter on the key at any indentation; leave on the next key at the SAME
      # or shallower indentation (a sibling such as namespaceResourceWhitelist).
      /^[ \t]*clusterResourceWhitelist:[ \t]*$/ {
        match($0, /^[ \t]*/); key_indent = RLENGTH; in_block = 1; next
      }
      in_block && /^[ \t]*#/ { next }
      in_block && /^[ \t]*$/ { next }
      in_block {
        match($0, /^[ \t]*/); indent = RLENGTH
        line = $0; sub(/^[ \t]*/, "", line)
        if (indent <= key_indent && line !~ /^-/) { flush(); in_block = 0; next }
        if (line ~ /^-[ \t]*/) {
          flush()
          sub(/^-[ \t]*/, "", line)
        }
        if (line ~ /^group:[ \t]*/) {
          v = line; sub(/^group:[ \t]*/, "", v); gsub(/["'"'"']/, "", v); gsub(/[ \t]/, "", v)
          group = v; have_group = 1; next
        }
        if (line ~ /^kind:[ \t]*/) {
          v = line; sub(/^kind:[ \t]*/, "", v); gsub(/["'"'"']/, "", v); gsub(/[ \t]/, "", v)
          kind = v; next
        }
      }
      END { flush() }
    ' "$file" | sort -u
  )"

  if [ -z "$entries" ]; then
    echo "::error::no clusterResourceWhitelist entries parsed from '$file'. Either the project" \
         "grants nothing cluster-scoped (then the chart must render nothing cluster-scoped," \
         "and this check cannot verify that from an empty parse) or the parser is broken." \
         "Refusing to pass on an empty whitelist." >&2
    return 1
  fi
  printf '%s\n' "$entries"
}

# Does "$1" (group/Kind) match whitelist entry "$2", honouring Argo's '*' wildcard?
whitelist_entry_matches() {
  local rendered="$1" entry="$2"
  local r_group="${rendered%%/*}" r_kind="${rendered#*/}"
  local e_group="${entry%%/*}" e_kind="${entry#*/}"
  { [ "$e_group" = '*' ] || [ "$e_group" = "$r_group" ]; } &&
  { [ "$e_kind" = '*' ] || [ "$e_kind" = "$r_kind" ]; }
}

# ── the check ───────────────────────────────────────────────────────────────
# $1 = rendered templates dir, $2 = AppProject file
check_dir() {
  local dir="$1" project="$2"
  local fail=0 rendered whitelist pair entry matched

  rendered="$(extract_cluster_scoped "$dir")" || return 1
  whitelist="$(extract_whitelist "$project")" || return 1

  echo "AppProject clusterResourceWhitelist ($project):"
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    printf '  %s\n' "$entry"
  done <<< "$whitelist"

  if [ -z "$rendered" ]; then
    echo "Cluster-scoped resources rendered by the chart: (none)"
  else
    echo "Cluster-scoped resources rendered by the chart:"
    while IFS= read -r pair; do
      [ -n "$pair" ] || continue
      printf '  %s\n' "$pair"
    done <<< "$rendered"
  fi

  # ── Layer 1: rendered ⊆ whitelist. This is the regression itself. ─────────
  if [ -n "$rendered" ]; then
    while IFS= read -r pair; do
      [ -n "$pair" ] || continue
      matched=0
      while IFS= read -r entry; do
        [ -n "$entry" ] || continue
        if whitelist_entry_matches "$pair" "$entry"; then matched=1; break; fi
      done <<< "$whitelist"
      if [ "$matched" -eq 0 ]; then
        echo "::error::the chart renders cluster-scoped '$pair', which the fuzefront AppProject" \
             "($project) does NOT permit. Argo does not skip an unpermitted resource — it marks" \
             "the sync task invalid and ABORTS THE WHOLE SYNC, so this freezes every other" \
             "resource in the Application including image-tag bumps (the 2026-09-28 incident," \
             "docs/planning/workload-identity-layering.md). Either stop rendering it — a" \
             "cluster-scoped grant in a CONSUMER chart is almost always a platform concern" \
             "that belongs in FuzeInfra — or add it to clusterResourceWhitelist with a" \
             "justification, which is a deliberate widening of this product's blast radius." >&2
        fail=1
      fi
    done <<< "$rendered"
  fi

  # ── Layer 2: whitelist ⊆ rendered (closed set). ───────────────────────────
  # Layer 1 alone lets a grant outlive the template that needed it. Every
  # cluster-scoped grant a consumer holds is standing permission to modify
  # cluster-level security, so when the chart stops rendering a kind the grant
  # must go with it. This is what makes retiring the workload-authenticator
  # grant an ENFORCED step once FuzeInfra's identity broker takes the function
  # over, rather than a line in a document nobody re-reads.
  local justified_entry justified_pair justified_why
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in *'*'*) continue ;; esac   # a wildcard grant cannot be "unused"
    matched=0
    if [ -n "$rendered" ]; then
      while IFS= read -r pair; do
        [ -n "$pair" ] || continue
        if whitelist_entry_matches "$pair" "$entry"; then matched=1; break; fi
      done <<< "$rendered"
    fi
    [ "$matched" -eq 1 ] && continue

    justified_why=""
    for justified_entry in "${WHITELIST_JUSTIFIED_UNRENDERED[@]}"; do
      justified_pair="${justified_entry%%|*}"
      if [ "$justified_pair" = "$entry" ]; then
        justified_why="${justified_entry#*|}"
        break
      fi
    done

    if [ -n "$justified_why" ]; then
      echo "  (whitelist entry '$entry' is granted but not rendered — justified: $justified_why)"
      continue
    fi

    echo "::error::the fuzefront AppProject ($project) grants cluster-scoped '$entry', but the" \
         "chart renders no such resource. An unused cluster-scoped grant is standing permission" \
         "to modify cluster-level security that nothing in this repo needs — remove it from" \
         "clusterResourceWhitelist. If it is genuinely required for something the chart does not" \
         "render, add it to WHITELIST_JUSTIFIED_UNRENDERED in" \
         "deploy/scripts/check-cluster-scoped-whitelist.sh with the reason." >&2
    fail=1
  done <<< "$whitelist"

  if [ "$fail" -eq 0 ]; then
    echo "OK: the chart's cluster-scoped kinds and the AppProject whitelist agree exactly."
  fi
  return $fail
}

# ── self-test ───────────────────────────────────────────────────────────────
# Proves the probe FAILS on the real 2026-09-28 regression BEFORE it is trusted
# to pass on current state. A check only ever observed passing is evidence of
# nothing (governance/vacuous-check-policy.json).
write_project_fixture() {
  local file="$1"; shift
  {
    printf 'apiVersion: argoproj.io/v1alpha1\nkind: AppProject\nmetadata:\n  name: fuzefront\n  namespace: argocd\nspec:\n  clusterResourceWhitelist:\n'
    local entry group kind
    for entry in "$@"; do
      group="${entry%%/*}"; kind="${entry#*/}"
      printf "    - group: '%s'\n      kind: %s\n" "$group" "$kind"
    done
    printf '  namespaceResourceWhitelist:\n    - group: %s\n      kind: %s\n' "'*'" "'*'"
  } > "$file"
}

self_test() {
  echo "Self-test: proving the probe FAILS on the real 2026-09-28 regression first" \
       "(a check only ever observed passing is not evidence of anything)."
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/rendered"

  # The exact regression: workload-identity.yaml's ClusterRole/ClusterRoleBinding
  # against the Namespace-only whitelist that froze the sync.
  cat > "$tmp/rendered/workload-identity.yaml" <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fuzefront-security
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: fuzefront-workload-authenticator
rules:
  - apiGroups: ["authentication.k8s.io"]
    resources: ["tokenreviews"]
    verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: fuzefront-workload-authenticator
subjects:
  - kind: ServiceAccount
    name: fuzefront-security
    namespace: fuzefront
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: fuzefront-workload-authenticator
EOF
  write_project_fixture "$tmp/project.yaml" "/Namespace"

  if check_dir "$tmp/rendered" "$tmp/project.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe PASSED on the exact regression (a chart" \
         "rendering ClusterRole/ClusterRoleBinding against a Namespace-only" \
         "clusterResourceWhitelist). That is the condition that froze every FuzeFront deploy" \
         "on 2026-09-28. The check is not doing its job; fix it before trusting it." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly FAILED on ClusterRole vs a Namespace-only whitelist."

  # GREEN: the same render against a whitelist that permits those kinds.
  write_project_fixture "$tmp/project.yaml" \
    "/Namespace" "rbac.authorization.k8s.io/ClusterRole" "rbac.authorization.k8s.io/ClusterRoleBinding"
  if ! check_dir "$tmp/rendered" "$tmp/project.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe rejected a render whose cluster-scoped kinds" \
         "ARE whitelisted. It must pass on the permitted shape." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly PASSED when ClusterRole/ClusterRoleBinding are whitelisted."

  # RED: group mismatch. Same kind name, wrong API group — Argo matches on both.
  write_project_fixture "$tmp/project.yaml" \
    "/Namespace" "/ClusterRole" "/ClusterRoleBinding"
  if check_dir "$tmp/rendered" "$tmp/project.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe passed while the whitelist named ClusterRole in" \
         "the CORE group ('') and the chart renders it in rbac.authorization.k8s.io. Argo" \
         "matches group AND kind, so this would not have been permitted in the cluster." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly FAILED on a group mismatch."

  # GREEN: namespaced-only render against a Namespace-only whitelist.
  rm -f "$tmp/rendered/workload-identity.yaml"
  cat > "$tmp/rendered/backend.yaml" <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fuzefront-backend
---
apiVersion: v1
kind: Service
metadata:
  name: fuzefront-backend
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: fuzefront-backend
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: fuzefront-backend
EOF
  write_project_fixture "$tmp/project.yaml" "/Namespace"
  if ! check_dir "$tmp/rendered" "$tmp/project.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe rejected a render containing only NAMESPACED" \
         "kinds (including namespaced Role/RoleBinding, which must NOT be confused with their" \
         "cluster-scoped namesakes) against a Namespace-only whitelist. That is the shape a" \
         "correctly layered consumer chart has, and it must pass." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly PASSED on a namespaced-only render (Role != ClusterRole)."

  # RED (layer 2): a whitelist grant nothing renders.
  write_project_fixture "$tmp/project.yaml" "/Namespace" "apiextensions.k8s.io/CustomResourceDefinition"
  if check_dir "$tmp/rendered" "$tmp/project.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe passed while the AppProject granted" \
         "CustomResourceDefinition that no template renders. An unused cluster-scoped grant" \
         "must be flagged, or a grant outlives the template that justified it and the" \
         "retirement step never happens." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly FAILED on an unused (unrendered) cluster-scoped grant."

  # RED (fail-closed): an unclassified kind must error, not pass.
  cat > "$tmp/rendered/novel.yaml" <<'EOF'
apiVersion: example.fuze.dev/v1
kind: SomeKindNobodyClassified
metadata:
  name: novel
EOF
  write_project_fixture "$tmp/project.yaml" "/Namespace"
  if check_dir "$tmp/rendered" "$tmp/project.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe passed on a kind in neither classification" \
         "list. It must fail closed: it cannot know whether an unknown kind is cluster-scoped," \
         "and guessing is how a sync-freezing kind ships green." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly FAILED closed on an unclassified kind."
  rm -f "$tmp/rendered/novel.yaml"

  # RED: an empty/unparseable whitelist must not read as "nothing to check".
  printf 'apiVersion: argoproj.io/v1alpha1\nkind: AppProject\nmetadata:\n  name: fuzefront\nspec:\n  destinations: []\n' \
    > "$tmp/project-empty.yaml"
  if check_dir "$tmp/rendered" "$tmp/project-empty.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe passed against an AppProject with no parseable" \
         "clusterResourceWhitelist. An empty parse must never read as a pass." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly FAILED on an unparseable/empty whitelist."

  # GREEN: the wildcard shape FuzeInfra's projects carried before #629, so the
  # matcher is proven to honour '*' rather than treating it as a literal.
  rm -rf "$tmp/rendered"; mkdir -p "$tmp/rendered"
  cat > "$tmp/rendered/workload-identity.yaml" <<'EOF'
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: fuzefront-workload-authenticator
EOF
  write_project_fixture "$tmp/project.yaml" "*/*"
  if ! check_dir "$tmp/rendered" "$tmp/project.yaml" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the probe rejected a '*/*' whitelist, which Argo treats" \
         "as permitting everything. The matcher is not honouring the wildcard." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly PASSED on a '*/*' wildcard whitelist."

  rm -rf "$tmp"
  trap - EXIT
  echo "Self-test: all cases passed."
}

case "${1:-}" in
  --self-test)
    self_test
    ;;
  "")
    echo "usage: check-cluster-scoped-whitelist.sh <rendered-templates-dir> [<appproject.yaml>]" >&2
    echo "       check-cluster-scoped-whitelist.sh --self-test" >&2
    exit 2
    ;;
  *)
    check_dir "$1" "${2:-$DEFAULT_PROJECT_FILE}"
    ;;
esac
