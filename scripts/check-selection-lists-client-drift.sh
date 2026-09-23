#!/usr/bin/env bash
# =============================================================================
# Verify that @fuzeone/selection-list-client covers every operation in
# services/selection-list-service/openapi.yaml.
#
# WHY THIS EXISTS: The client package is hand-authored rather than generated.
# Nothing else in CI verifies it stays in sync with the spec — a new endpoint
# added to openapi.yaml can go unimplemented in the client for weeks with
# no signal. This script is the signal.
#
# HOW IT WORKS
# 1. Parse every operationId from the spec.
# 2. Look up the expected client method name in the mapping table below.
# 3. Verify the method exists in selection-list-client/src/client.ts.
# 4. Report any operation that is in the spec but has no client method, any
#    mapping whose expected method is absent from the client source, and any
#    operationId in the spec that the mapping table does not know about.
#
# KEEPING THE MAPPING TABLE CURRENT
# When you add an endpoint to openapi.yaml, add the corresponding row to
# OP_TO_METHOD below (operationId=expectedMethodName). If the client method
# does not exist yet, the check will fail — which is the correct behaviour;
# add the mapping AND implement the method in the same PR.
#
# Run:
#   ./scripts/check-selection-lists-client-drift.sh          # verify
#
# Exit codes:
#   0  -- all spec operations have a client method
#   1  -- one or more operations are missing or the mapping table is stale
#   2  -- a required file is missing
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

SPEC="services/selection-list-service/openapi.yaml"
CLIENT_SRC="selection-list-client/src/client.ts"

for f in "$SPEC" "$CLIENT_SRC"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: missing required file: $f" >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# Mapping table: spec operationId -> expected method name in client.ts
#
# Derived from the naming convention the package already uses. The mapping
# is the canonical record; update it in the same PR that adds or renames an
# operation in openapi.yaml.
# ---------------------------------------------------------------------------
#
# Each line: "operationId=expectedMethodName"
# operationIds come from the frozen spec (services/selection-list-service/openapi.yaml).
# Method names are what the implementer chose in selection-list-client/src/client.ts.
#
MAPPING=(
  # Lists
  "listSelectionLists=getLists"
  "createSelectionList=createList"
  "getSelectionList=getList"
  "updateSelectionList=updateList"
  "deleteSelectionList=deleteList"
  "archiveSelectionList=archiveList"

  # Items
  "listSelectionListItems=getItems"
  "createSelectionListItem=createItem"
  "reorderSelectionListItems=reorderItems"
  "updateSelectionListItem=updateItem"
  "deleteSelectionListItem=deleteItem"
  "archiveSelectionListItem=archiveItem"

  # Translations — lists
  "listSelectionListTranslations=listTranslations"
  "upsertSelectionListTranslation=upsertListTranslation"
  "deleteSelectionListTranslation=deleteListTranslation"
  "autofillSelectionListTranslations=autofillTranslations"

  # Translations — items
  "listSelectionListItemTranslations=listItemTranslations"
  "upsertSelectionListItemTranslation=upsertItemTranslation"
  "deleteSelectionListItemTranslation=deleteItemTranslation"

  # Access
  "listSelectionListAccess=getAccess"
  "setSelectionListAccess=setAccess"
  "revokeSelectionListAccess=revokeAccess"

  # Quota
  "getSelectionListQuota=getQuota"

  # Resolve (hot path)
  "resolveSelectionListItems=resolveIds"
)

# ---------------------------------------------------------------------------
# Step 1: extract every operationId from the spec
# ---------------------------------------------------------------------------
# Grep for "operationId:" lines; strip whitespace and the key prefix.
SPEC_OPS=()
while IFS= read -r line; do
  op="${line#*operationId:}"        # drop everything up to and including "operationId:"
  op="${op//[[:space:]]/}"          # strip all whitespace (leading/trailing/inline)
  [[ -n "$op" ]] && SPEC_OPS+=("$op")
done < <(grep 'operationId:' "$SPEC")

# ---------------------------------------------------------------------------
# Step 2: build a lookup set from the mapping table
# ---------------------------------------------------------------------------
declare -A TABLE_OP_TO_METHOD=()
for entry in "${MAPPING[@]}"; do
  op="${entry%%=*}"
  method="${entry##*=}"
  TABLE_OP_TO_METHOD["$op"]="$method"
done

# ---------------------------------------------------------------------------
# Step 3: compare
# ---------------------------------------------------------------------------
missing_from_table=()   # operationIds in spec but absent from the mapping table
missing_from_client=()  # operationIds whose mapped method is absent in client.ts
extra_in_table=()       # operationIds in the table but not in the spec

# Build a quick-lookup set for spec ops
declare -A SPEC_OP_SET=()
for op in "${SPEC_OPS[@]}"; do
  SPEC_OP_SET["$op"]=1
done

# Check every spec operation
for op in "${SPEC_OPS[@]}"; do
  if [[ -z "${TABLE_OP_TO_METHOD[$op]+set}" ]]; then
    missing_from_table+=("$op")
  else
    method="${TABLE_OP_TO_METHOD[$op]}"
    # Check whether the method appears in the client source.
    # We look for "async <method>(" or "<method>(" to avoid false positives on
    # type names or comments.
    if ! grep -qE "(async )?${method}\s*\(" "$CLIENT_SRC"; then
      missing_from_client+=("$op => ${method}()")
    fi
  fi
done

# Check for stale entries in the table (operations removed from the spec)
for op in "${!TABLE_OP_TO_METHOD[@]}"; do
  if [[ -z "${SPEC_OP_SET[$op]+set}" ]]; then
    extra_in_table+=("$op => ${TABLE_OP_TO_METHOD[$op]}()")
  fi
done

# ---------------------------------------------------------------------------
# Step 4: report
# ---------------------------------------------------------------------------
overall=0

if [[ ${#missing_from_table[@]} -gt 0 ]]; then
  overall=1
  cat >&2 <<'EOF'

STALE MAPPING TABLE — operationIds present in the spec but absent from the
mapping table in this script. Add a row for each to OP_TO_METHOD.
EOF
  for op in "${missing_from_table[@]}"; do
    echo "  UNMAPPED: $op" >&2
  done
fi

if [[ ${#missing_from_client[@]} -gt 0 ]]; then
  overall=1
  cat >&2 <<'EOF'

MISSING CLIENT METHODS — spec operations whose expected client method was not
found in selection-list-client/src/client.ts. The method must be implemented
and the mapping table must reflect the chosen name.

  operationId => expected method()
EOF
  for pair in "${missing_from_client[@]}"; do
    echo "  MISSING: $pair" >&2
  done
  cat >&2 <<EOF

Spec:   $SPEC
Client: $CLIENT_SRC

Each missing entry is a gap between the frozen contract and the SDK client.
Implement the missing methods, or update the mapping table if the client
already covers the operation under a different name.
EOF
fi

if [[ ${#extra_in_table[@]} -gt 0 ]]; then
  overall=1
  cat >&2 <<'EOF'

STALE MAPPING TABLE — operationIds in the mapping table that no longer exist
in the spec. Remove the stale rows from OP_TO_METHOD.
EOF
  for pair in "${extra_in_table[@]}"; do
    echo "  STALE: $pair" >&2
  done
fi

# ---------------------------------------------------------------------------
# Step 5: summary
# ---------------------------------------------------------------------------
total="${#SPEC_OPS[@]}"
covered=$(( total - ${#missing_from_table[@]} - ${#missing_from_client[@]} ))

if [[ "$overall" -eq 0 ]]; then
  echo "OK: all ${total} spec operations are covered by the client ($(sha256sum "$SPEC" | cut -c1-12))"
else
  echo "" >&2
  echo "DRIFT: ${covered}/${total} operations covered — $(( total - covered )) gap(s) detected." >&2
  echo "See above for details." >&2
fi

exit "$overall"
