#!/usr/bin/env bash
# Verifies that THIS repo's A2A card-projection inputs — .fuze/manifest.json +
# agent-templates/roles/*/role.json — actually project into a schema-valid Agent
# Card, using the REAL, authoritative generator from izzywdev/FuzeAgent
# (agent-templates/a2a/card_generator.py). It does not reimplement the
# projection: the projection algorithm has exactly one owner (FuzeAgent), and
# this script proves FuzeFront's data satisfies it rather than guessing.
#
# Why this exists: FuzeFront does NOT run its own A2A server. The shared
# server/adapter (Python, Claude-driven via the Managed-Agents provider seam)
# already exists generically in izzywdev/FuzeAgent and is documented for the
# per-product-pod topology at docs/a2a/per-product-pod.md there. Building a
# second implementation in this repo would be exactly the "second parallel A2A
# chart or image" CLAUDE.md forbids. This script is the FuzeFront-side check
# that belongs here instead: does OUR manifest/role data hold up.
#
# Pinned against izzywdev/FuzeAgent @ c2f74c838ca3c8034566b4268d0bfa76434dec7b
# (contract v1.2.0, VERSION file at agent-templates/contracts/a2a/v1/VERSION).
# Bump FUZEAGENT_REF when that repo's a2a package changes in a way that could
# affect projection — re-run this script to catch drift immediately.
#
# Usage:
#   scripts/verify-a2a-card.sh                 # verify this repo's real data
#   scripts/verify-a2a-card.sh --test-rejection # also prove a broken fixture is REJECTED
#
# Requires: python3, git, network access to github.com (raw content only).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUZEAGENT_REF="${FUZEAGENT_REF:-c2f74c838ca3c8034566b4268d0bfa76434dec7b}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Fetching pinned A2A generator from izzywdev/FuzeAgent @ ${FUZEAGENT_REF:0:12}"
mkdir -p "$WORK_DIR/agent-templates/a2a" "$WORK_DIR/agent-templates/contracts/a2a/v1/schema" \
         "$WORK_DIR/agent-templates/contracts/a2a/v1/client/fuze_a2a_client"

RAW="https://raw.githubusercontent.com/izzywdev/FuzeAgent/${FUZEAGENT_REF}"

for f in card_generator.py loader.py validation.py _contract.py __init__.py wire_errors.py identity.py environments.py; do
  curl -fsS "$RAW/agent-templates/a2a/$f" -o "$WORK_DIR/agent-templates/a2a/$f"
done
for f in agent-card.schema.json fuze-profile.schema.json manifest-a2a-extension.schema.json role-a2a-extension.schema.json a2a-wire.schema.json values-interface.schema.json; do
  curl -fsS "$RAW/agent-templates/contracts/a2a/v1/schema/$f" -o "$WORK_DIR/agent-templates/contracts/a2a/v1/schema/$f"
done
for f in __init__.py card_models.py client.py errors.py wire_models.py; do
  curl -fsS "$RAW/agent-templates/contracts/a2a/v1/client/fuze_a2a_client/$f" -o "$WORK_DIR/agent-templates/contracts/a2a/v1/client/fuze_a2a_client/$f"
done
curl -fsS "$RAW/agent-templates/contracts/a2a/v1/client/pyproject.toml" -o "$WORK_DIR/agent-templates/contracts/a2a/v1/client/pyproject.toml"
curl -fsS "$RAW/agent-templates/contracts/a2a/v1/VERSION" -o "$WORK_DIR/agent-templates/contracts/a2a/v1/VERSION"

echo "==> Installing (pydantic, jsonschema, the pinned contract client)"
python3 -m venv "$WORK_DIR/venv"
"$WORK_DIR/venv/bin/pip" install --quiet --disable-pip-version-check pydantic jsonschema
"$WORK_DIR/venv/bin/pip" install --quiet --disable-pip-version-check -e "$WORK_DIR/agent-templates/contracts/a2a/v1/client"

echo "==> Projecting FuzeFront's real card"
PYTHONPATH="$WORK_DIR/agent-templates" "$WORK_DIR/venv/bin/python3" - "$REPO_ROOT" <<'PYEOF'
import sys
from a2a import card_generator as cg
from a2a.loader import load_repo
from a2a.validation import card_errors

repo_root = sys.argv[1]
manifest, roles = load_repo(repo_root)

if not manifest.get("providesTo"):
    # authz.md §3: absent/empty are both fail-closed DENY, but ABSENT means
    # "never configured" — that is worth failing loudly on here rather than
    # only at runtime.
    print("FAIL: manifest.providesTo is absent — A2A would deny every caller "
          "(this is a valid but almost certainly unintended state; set it "
          "explicitly, even to [], to record the decision).", file=sys.stderr)
    sys.exit(1)

card = cg.project_product_card(
    manifest, roles,
    in_cluster_url="http://a2a-fuzefront.fuzefront.svc.cluster.local:8080/rpc",
)
errors = card_errors(card)
if errors:
    print(f"FAIL: projected card violates the frozen contract: {errors}", file=sys.stderr)
    sys.exit(1)

print(f"OK: projected '{card['name']}' with skills: "
      f"{[s['id'] for s in card['skills']]}")
print(f"OK: interface: {card['supportedInterfaces'][0]['url']} "
      f"(tenant={card['supportedInterfaces'][0]['tenant']})")
PYEOF

if [[ "${1:-}" == "--test-rejection" ]]; then
  echo "==> Proving a contract violation IS rejected (undescribed role)"
  BROKEN_DIR="$WORK_DIR/broken-repo"
  mkdir -p "$BROKEN_DIR/.fuze" "$BROKEN_DIR/agent-templates/roles/broken-role"
  cat > "$BROKEN_DIR/.fuze/manifest.json" <<'JSON'
{ "repo": "izzywdev/FuzeFront", "tier": "product", "providesTo": ["FuzePlan"] }
JSON
  # Deliberately missing "description" — card-projection.md §3: an undescribed
  # skill MUST fail projection rather than emit a placeholder.
  cat > "$BROKEN_DIR/agent-templates/roles/broken-role/role.json" <<'JSON'
{ "role": "broken-role", "name": "Broken role" }
JSON

  set +e
  PYTHONPATH="$WORK_DIR/agent-templates" "$WORK_DIR/venv/bin/python3" - "$BROKEN_DIR" <<'PYEOF'
import sys
from a2a import card_generator as cg
from a2a.loader import load_repo

manifest, roles = load_repo(sys.argv[1])
try:
    cg.project_product_card(manifest, roles, in_cluster_url="http://x/rpc")
    print("UNEXPECTED: projection succeeded on a contract-violating fixture", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"OK: correctly REJECTED ({type(e).__name__}: {e})")
PYEOF
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "FAIL: rejection test did not behave as expected" >&2
    exit 1
  fi
fi

echo "==> All A2A card-projection checks passed."
