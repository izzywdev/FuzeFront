#!/usr/bin/env bash
# check-selection-list-s2s.sh — render-time assertions for selection-list-service's
# in-cluster S2S (client_credentials) identity wiring.
#
# WHY A SCRIPT. helm lint + kubeconform check SHAPE. They cannot tell that the
# register Job leaked out of its gate, that the Role is wider than the one Secret
# it should manage, or that the Deployment reads credentials from the SEALED
# Secret the Job must never write to. Those are exactly the properties this wiring
# exists to guarantee, so assert them on the rendered manifests.
#
# Usage: check-selection-list-s2s.sh <chart-dir> [values-file ...]
#
# Cases (each is a separate `helm template`):
#   1. enabled=false, register=true  -> NO Job / SA / Role / RoleBinding (the gate)
#   2. enabled=true,  register=false -> no Job; Deployment keys are optional:true
#   3. enabled=true,  register=true  -> Job + SA + Role + RoleBinding; Role is
#                                       Secret-name-scoped; Deployment keys are
#                                       optional:false and read s2s.secretName
#   4. secretName override propagates to Job, Role and Deployment together
#
# A check observed only passing proves nothing, so the script ends with a
# negative control: it feeds the case-3 assertions a deliberately wrong
# expectation and requires them to FAIL.
set -euo pipefail

CHART="${1:?usage: check-selection-list-s2s.sh <chart-dir> [values-file ...]}"
shift || true
VALUES_ARGS=()
for f in "$@"; do VALUES_ARGS+=(-f "$f"); done

COMMON=(--set secret.existingSecret="" --set secret.authentikClientSecret=ci-placeholder)

render() { # render <extra helm args...>  -> YAML on stdout
  helm template fuzefront "$CHART" "${VALUES_ARGS[@]}" "${COMMON[@]}" "$@"
}

# check <expect-secret-name> <expect-optional true|false> <expect-job true|false>
# reads rendered manifests on stdin; exits non-zero with ::error:: lines on failure.
check() {
  python3 -c "$CHECK_PY" "$@"
}

# Kept in a variable (not a heredoc) so stdin stays free for the piped manifests.
read -r -d '' CHECK_PY <<'PY' || true
import sys, yaml
want_secret, want_optional, want_job = sys.argv[1], sys.argv[2] == "true", sys.argv[3] == "true"
docs = [d for d in yaml.safe_load_all(sys.stdin) if d]
def find(kind, name):
    return [d for d in docs if d.get("kind") == kind and d["metadata"]["name"] == name]
errs = []
JOB = "selection-list-s2s-register"

for kind in ("Job", "ServiceAccount", "Role", "RoleBinding"):
    got = bool(find(kind, JOB))
    if got != want_job:
        errs.append(f"{kind}/{JOB} rendered={got}, expected {want_job}")

dep = find("Deployment", "fuzefront-selection-list-service")
if not dep:
    errs.append("Deployment/fuzefront-selection-list-service not rendered")
else:
    env = {e["name"]: e for e in dep[0]["spec"]["template"]["spec"]["containers"][0]["env"]}
    for var, key in (("SELECTION_LIST_SERVICE_CLIENT_ID", "AUTHENTIK_CLIENT_ID"),
                     ("SELECTION_LIST_SERVICE_CLIENT_SECRET", "AUTHENTIK_CLIENT_SECRET")):
        ref = env.get(var, {}).get("valueFrom", {}).get("secretKeyRef")
        if not ref:
            errs.append(f"{var} has no secretKeyRef"); continue
        if ref["name"] != want_secret:
            errs.append(f"{var} reads Secret/{ref['name']}, expected {want_secret}")
        if ref["key"] != key:
            errs.append(f"{var} reads key {ref['key']}, expected {key}")
        if bool(ref.get("optional")) != want_optional:
            errs.append(f"{var} optional={ref.get('optional')}, expected {want_optional}")

if want_job:
    role = find("Role", JOB)[0]
    scoped = [r for r in role["rules"] if r.get("resourceNames")]
    if len(scoped) != 1 or scoped[0]["resourceNames"] != [want_secret]:
        errs.append(f"Role resourceNames must be exactly [{want_secret}], got {[r.get('resourceNames') for r in role['rules']]}")
    for r in role["rules"]:
        if r["resources"] != ["secrets"] or r["apiGroups"] != [""]:
            errs.append(f"Role rule touches more than core secrets: {r}")
        if not r.get("resourceNames") and r["verbs"] != ["create"]:
            errs.append(f"unscoped rule must be create-only, got {r['verbs']}")
    job = find("Job", JOB)[0]
    ann = job["metadata"]["annotations"]
    if ann.get("helm.sh/hook") != "pre-install,pre-upgrade":
        errs.append(f"Job must be a PreSync hook (pre-install,pre-upgrade), got {ann.get('helm.sh/hook')}")
    def strings(o):
        if isinstance(o, str): yield o
        elif isinstance(o, dict):
            for v in o.values(): yield from strings(v)
        elif isinstance(o, list):
            for v in o: yield from strings(v)
    text = "\n".join(strings(job))
    if "selection-list-secrets" in text:
        errs.append("Job references the SEALED selection-list-secrets; it must only write Secret/" + want_secret)
    if f'SECRET_NAME="{want_secret}"' not in text:
        errs.append(f"Job does not publish Secret/{want_secret}")
    if "authz:admin" not in text:
        errs.append("Job does not request the authz:admin scope")
    if "--write-env-file" not in text:
        errs.append("Job does not use --write-env-file")

if errs:
    for e in errs: print("::error::" + e)
    sys.exit(1)
PY

echo "case 1: enabled=false + register=true must render nothing"
render --set selectionListService.enabled=false --set selectionListService.s2s.register.enabled=true \
  | python3 -c '
import sys, yaml
bad=[d["kind"]+"/"+d["metadata"]["name"] for d in yaml.safe_load_all(sys.stdin) if d and "selection-list" in d["metadata"].get("name","")]
if bad: print("::error::selection-list resources rendered while enabled=false: "+", ".join(bad)); sys.exit(1)'

echo "case 2: enabled=true, register=false"
render --set selectionListService.enabled=true --set selectionListService.s2s.register.enabled=false \
  | check selection-list-s2s true false

echo "case 3: enabled=true, register=true"
render --set selectionListService.enabled=true --set selectionListService.s2s.register.enabled=true \
  | check selection-list-s2s false true

echo "case 4: secretName override propagates"
render --set selectionListService.enabled=true --set selectionListService.s2s.register.enabled=true \
       --set selectionListService.s2s.secretName=custom-s2s \
  | check custom-s2s false true

echo "negative control: a wrong expectation must FAIL"
if render --set selectionListService.enabled=true --set selectionListService.s2s.register.enabled=true \
  | check selection-list-secrets false true >/dev/null 2>&1; then
  echo "::error::negative control passed — the assertions are vacuous" >&2
  exit 1
fi

echo "OK: selection-list-service S2S wiring assertions hold"
