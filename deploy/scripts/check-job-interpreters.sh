#!/usr/bin/env bash
# check-job-interpreters.sh — assert that every rendered container which is
# launched through a shell can ACTUALLY EXECUTE that shell.
#
# WHY THIS EXISTS. The seed Job was pinned to `bitnami/kubectl:1.29`; Broadcom
# removed the free bitnami/* images from Docker Hub in Aug 2025, the pod
# ImagePullBackOff'd, and Secret/fuzefront-registration was silently never
# published (FuzeFront#688, FuzeInfra#552). The fix repinned it to
# `registry.k8s.io/kubectl`, and a CI guard was added asserting the tag RESOLVES.
#
# That guard was green on 2026-08-20 while the Job could not start at all:
#
#   Error: failed to create containerd task: ... OCI runtime create failed:
#   runc create failed: unable to start container process: error during
#   container init: exec: "/bin/sh": stat /bin/sh: no such file or directory
#
# `registry.k8s.io/kubectl` is DISTROLESS — it ships the kubectl binary and no
# shell — but the Job invokes `command: ["/bin/sh","-c", …]`. The image pulled
# fine, so the pullability guard passed; the container never ran a single line,
# so not one of the script's carefully-worded FATAL diagnostics was ever
# printed and `kubectl logs` came back empty.
#
# The lesson, and the reason this check is shaped the way it is: the previous
# guard asserted the PREVIOUS failure mode. Resolving a manifest is not evidence
# the image can run the command it is given. So this one does the only thing
# that actually proves it — it runs the interpreter.
#
# Usage: check-job-interpreters.sh <rendered-templates-dir>
#        check-job-interpreters.sh --self-test
set -euo pipefail

# The image that caused the outage. Used as the self-test's negative control --
# it is genuinely distroless, so the probe MUST fail against it.
SELF_TEST_DISTROLESS="registry.k8s.io/kubectl:v1.29.10"

MODE="check"
case "${1:-}" in
  --self-test) MODE="self-test" ;;
  "") echo "usage: check-job-interpreters.sh <rendered-templates-dir> | --self-test" >&2; exit 2 ;;
  *) DIR="$1" ;;
esac

# Probe the DAEMON, not the CLI. `command -v docker` succeeds in plenty of
# environments that cannot run a container (the CLI is installed but no daemon is
# reachable), which produces a confusing per-image "could not be pulled" for every
# entry instead of one clear message about the real problem.
#
# Deliberately a hard error, not a skip. A check that quietly stops checking is
# exactly how the distroless bug above survived; if this cannot run, say so.
if ! docker info >/dev/null 2>&1; then
  echo "::error::a working Docker daemon is required to verify container interpreters." \
       "The CLI alone is not enough — this check runs each image. If you are running" \
       "this locally without a daemon, run it in CI instead." >&2
  exit 1
fi

# SELF-TEST. A gate that has only ever been observed passing is not evidence of
# anything -- the guard this replaces was green for the entire life of the bug.
# So prove the probe can still FAIL, using the exact image that caused the
# outage as a negative control. If this ever starts passing, the probe has been
# broken (or upstream added a shell) and the whole check is worthless.
#
# Only the negative case needs a dedicated control: every real run exercises the
# positive case against the chart's own images and would fail loudly if the probe
# stopped succeeding on a shell-bearing image.
if [ "$MODE" = "self-test" ]; then
  echo "SELF-TEST: $SELF_TEST_DISTROLESS must NOT be able to exec /bin/sh"
  if ! docker pull --quiet "$SELF_TEST_DISTROLESS" >/dev/null 2>&1; then
    echo "::error::self-test could not pull $SELF_TEST_DISTROLESS — cannot prove the probe still detects a shell-less image." >&2
    exit 1
  fi
  if docker run --rm --entrypoint /bin/sh "$SELF_TEST_DISTROLESS" -c '' >/dev/null 2>&1; then
    echo "::error::SELF-TEST FAILED: $SELF_TEST_DISTROLESS executed /bin/sh." \
         "This image is distroless and must not have a shell, so the probe is no" \
         "longer detecting the failure it exists to catch. Do not trust a green" \
         "run of this gate until this is understood." >&2
    exit 1
  fi
  echo "SELF-TEST OK: the probe correctly rejects a distroless image."
  exit 0
fi

# Emit "image<TAB>interpreter" for every container/initContainer whose command[0]
# is an absolute shell path. Images we build ourselves are reported and skipped:
# pulling them needs ghcr.io auth, and their bases are pinned by our Dockerfiles.
mapfile -t PAIRS < <(python3 - "$DIR" <<'PY'
import os, sys, glob
try:
    import yaml
except ImportError:
    sys.stderr.write("::error::PyYAML is required to parse the rendered chart.\n")
    sys.exit(1)

SHELLS = {"/bin/sh", "/bin/bash", "/bin/ash", "/bin/dash",
          "/usr/bin/sh", "/usr/bin/bash", "/usr/bin/env"}
seen, scanned = set(), 0

for path in glob.glob(os.path.join(sys.argv[1], "**", "*.yaml"), recursive=True):
    with open(path) as fh:
        try:
            docs = list(yaml.safe_load_all(fh))
        except yaml.YAMLError as exc:
            sys.stderr.write(f"::error::could not parse {path}: {exc}\n")
            sys.exit(1)
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        scanned += 1
        # Find every PodSpec regardless of the enclosing kind (Job, CronJob,
        # Deployment, …) rather than enumerating kinds and missing one.
        stack, specs = [doc], []
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                if "containers" in node and isinstance(node.get("containers"), list):
                    specs.append(node)
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
        for spec in specs:
            for c in (spec.get("containers") or []) + (spec.get("initContainers") or []):
                cmd, image = c.get("command"), c.get("image")
                if not cmd or not image:
                    continue
                if cmd[0] in SHELLS:
                    seen.add((image, cmd[0]))

# A scan that matched nothing must not pass silently — that is the same
# vacuous-green failure this whole file exists to prevent.
if scanned == 0:
    sys.stderr.write("::error::no Kubernetes manifests found to scan.\n")
    sys.exit(1)

for image, interp in sorted(seen):
    print(f"{image}\t{interp}")
PY
)

if [ "${#PAIRS[@]}" -eq 0 ]; then
  echo "No shell-launched containers in the rendered chart — nothing to verify."
  exit 0
fi

rc=0
for pair in "${PAIRS[@]}"; do
  image="${pair%%$'\t'*}"
  interp="${pair##*$'\t'}"

  case "$image" in
    ghcr.io/izzywdev/*)
      echo "SKIP  $image ($interp) — first-party image, pulling it needs ghcr.io auth"
      continue
      ;;
  esac

  echo "CHECK $image needs $interp"
  # Retry the pull. Docker Hub rate-limits anonymous pulls per source IP, and
  # GitHub-hosted runners share IPs with a lot of other traffic, so an occasional
  # 429 is expected and is NOT a defect in the chart. Retrying a few times keeps
  # this gate honest without making it flaky-red on unrelated PRs. A persistent
  # failure still fails -- it is never downgraded to a skip.
  pull_ok=0
  for attempt in 1 2 3; do
    if pull_err=$(docker pull --quiet "$image" 2>&1); then pull_ok=1; break; fi
    [ "$attempt" -lt 3 ] && sleep $(( attempt * 10 ))
  done
  if [ "$pull_ok" -ne 1 ]; then
    # Report what docker actually said. A blocked egress proxy and a deleted tag
    # both surface as "pull failed", and calling both ImagePullBackOff sends the
    # reader after the wrong bug — the precise mistake this file is about.
    echo "::error::$image could not be pulled. If the tag is gone this would" \
         "ImagePullBackOff in the cluster; if this runner has no registry egress" \
         "the check itself is unable to run. docker said: ${pull_err}"
    rc=1
    continue
  fi
  # `-c ''` is the same invocation shape the manifest uses, so a shell that
  # exists but cannot be exec'd as an entrypoint still fails here.
  if ! docker run --rm --entrypoint "$interp" "$image" -c '' >/dev/null 2>&1; then
    echo "::error::$image cannot execute '$interp'. The manifest launches it via" \
         "\`command: [\"$interp\", \"-c\", …]\`, so the container will fail at" \
         "runc init with 'no such file or directory' and the pod will never run a" \
         "single line of its script. Distroless images (registry.k8s.io/kubectl," \
         "gcr.io/distroless/*) ship no shell — use an image that does, e.g." \
         "alpine/k8s, which FuzeInfra already runs in this cluster."
    rc=1
    continue
  fi
  echo "OK    $image can execute $interp"
done

exit "$rc"
