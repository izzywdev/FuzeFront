"""
Self-check against the frozen contract and the Node sibling client.

``services/config-service/openapi.yaml`` is the single source of truth
(FFRNT-153). This suite parses it directly -- and the Node client's
``types.ts`` -- and fails if this Python package's error-code surface has
drifted from either, the same shape of guarantee
``identity-py``'s ``TestCrossLanguageParity`` gives the identity packages.

This is a *self*-check: it proves THIS client agrees with the contract it
claims to implement. It is deliberately narrow (error codes + the pagination
envelope's required fields) -- it is not the independent, full operation-by-
operation cross-client parity suite the epic assigns to QA
(FF-EPIC-17-S10's "Cross-client parity test" sub-task). A backend engineer's
own unit tests verify against the contract; grading the feature end-to-end
is out of scope here.
"""

from __future__ import annotations

import pathlib
import re

from fuzefront_config_client import ConfigErrorCode

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_OPENAPI_PATH = _REPO_ROOT / "services" / "config-service" / "openapi.yaml"
_NODE_TYPES_PATH = _REPO_ROOT / "config-client" / "src" / "types.ts"
_NODE_ERRORS_PATH = _REPO_ROOT / "config-client" / "src" / "errors.ts"

# UNKNOWN is client-only (never emitted by the service) in both clients --
# excluded from every contract/cross-client comparison below.
_CLIENT_ONLY_CODES = {"UNKNOWN"}


class TestOpenApiContractParity:
    def test_error_codes_match_the_frozen_contract(self) -> None:
        spec = _OPENAPI_PATH.read_text()
        block = re.search(r"ErrorCode:\n(?:.*\n)*?      enum:\n((?:\s+- \w+\n)+)", spec)
        assert block, "could not locate components.schemas.ErrorCode.enum in openapi.yaml"
        contract_codes = set(re.findall(r"-\s+(\w+)", block.group(1)))

        python_codes = {c.value for c in ConfigErrorCode} - _CLIENT_ONLY_CODES

        assert python_codes == contract_codes, (
            "fuzefront_config_client.ConfigErrorCode has drifted from "
            "services/config-service/openapi.yaml#/components/schemas/ErrorCode -- "
            "the spec is frozen and authoritative; update this package's "
            "ConfigErrorCode to match it, never the other way around."
        )

    def test_page_info_required_fields_match_the_contract(self) -> None:
        """
        `has_next_page`/`next_cursor` (no `total`) is THIS contract's
        envelope -- distinct from sibling services like selection-list,
        which uses `has_more`/`total`. Assert against this spec, not a
        pattern borrowed from a different service.
        """
        spec = _OPENAPI_PATH.read_text()
        block = re.search(r"PageInfo:\n(?:.*\n)*?      required: \[(.+?)\]", spec)
        assert block, "could not locate components.schemas.PageInfo.required in openapi.yaml"
        required = {f.strip() for f in block.group(1).split(",")}
        assert required == {"hasNextPage"}


class TestNodeClientParity:
    def test_error_codes_match_the_node_client(self) -> None:
        ts = _NODE_TYPES_PATH.read_text()
        block = re.search(r"export type ConfigErrorCode =\n((?:\s+\| '[A-Z_]+'\n)+)", ts)
        assert block, "could not locate ConfigErrorCode union in config-client/src/types.ts"
        node_codes = set(re.findall(r"'([A-Z_]+)'", block.group(1)))

        python_codes = {c.value for c in ConfigErrorCode} - _CLIENT_ONLY_CODES

        assert python_codes == node_codes, (
            "fuzefront_config_client.ConfigErrorCode has drifted from the Node "
            "client's ConfigErrorCode (config-client/src/types.ts). Both clients "
            "are projections of the same contract and must agree -- a mismatch "
            "here means a caller migrating between languages sees different "
            "error codes for the identical server response."
        )

    def test_client_only_unknown_code_present_in_both(self) -> None:
        """
        Both clients add exactly one client-only code, `UNKNOWN`, for a
        response that is not a contract response at all. Node keeps it out
        of the contract-derived `ConfigErrorCode` type and adds it only at
        the error-class boundary (`ConfigApiErrorCode = ConfigErrorCode |
        'UNKNOWN'` in errors.ts); this package folds it into the same
        `ConfigErrorCode` enum for convenience. Either shape is fine -- what
        must not drift is that BOTH clients expose exactly this one
        client-only value, asserted here so a future refactor can't quietly
        drop it from either side.
        """
        errors_ts = _NODE_ERRORS_PATH.read_text()
        assert "'UNKNOWN'" in errors_ts
        assert ConfigErrorCode.UNKNOWN.value == "UNKNOWN"
