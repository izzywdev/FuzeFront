"""Mirror of shared/tests/identity/*.test.ts.

The vectors and the rejection cases are deliberately identical to the
TypeScript suite: that is what makes "the two implementations agree" a tested
claim rather than an assumption.
"""

import pytest

from fuzefront_identity import (
    ENTITY_PREFIXES,
    ENTITY_TYPES,
    GraphCreateError,
    IdentityError,
    assert_ref,
    bytes_to_uuid,
    configure_identity,
    decode_suffix,
    encode_suffix,
    entity_type_of,
    from_uuid,
    is_id,
    mint_id,
    parse_id,
    resolve_graph,
    to_uuid,
    try_parse_id,
    uuid_to_bytes,
    uuidv7_bytes,
)

# Vectors from the TypeID spec's valid.yml — identical to the TS suite.
VECTORS = [
    ("00000000-0000-0000-0000-000000000000", "00000000000000000000000000"),
    ("01890a5d-ac96-774b-bcce-b302099a8057", "01h455vb4pex5vsknk084sn02q"),
    ("0110c853-1d09-52d8-d73e-1194e95b5f19", "0123456789abcdefghjkmnpqrs"),
    ("ffffffff-ffff-ffff-ffff-ffffffffffff", "7zzzzzzzzzzzzzzzzzzzzzzzzz"),
]

AGGREGATE = {"customer", "invoice", "payment", "subscription"}


@pytest.fixture(autouse=True)
def _strict_by_default():
    configure_identity([])
    yield
    configure_identity([])


class TestCodec:
    @pytest.mark.parametrize("uuid_str,suffix", VECTORS)
    def test_encodes(self, uuid_str, suffix):
        assert encode_suffix(uuid_to_bytes(uuid_str)) == suffix

    @pytest.mark.parametrize("uuid_str,suffix", VECTORS)
    def test_decodes(self, uuid_str, suffix):
        assert bytes_to_uuid(decode_suffix(suffix)) == uuid_str

    def test_round_trips(self):
        for _ in range(2000):
            entity_id = mint_id("customer")
            assert from_uuid("customer", to_uuid(entity_id)) == entity_id

    def test_rejects_characters_outside_alphabet(self):
        # i, l, o and u are excluded to avoid transcription ambiguity.
        with pytest.raises(ValueError, match="invalid base32"):
            decode_suffix("0li00000000000000000000000")

    def test_rejects_overflow(self):
        with pytest.raises(ValueError, match="overflows"):
            decode_suffix("8zzzzzzzzzzzzzzzzzzzzzzzzz")

    def test_rejects_wrong_length(self):
        with pytest.raises(ValueError, match="26 characters"):
            decode_suffix("0123")


class TestUuidV7:
    def test_version_and_variant(self):
        data = uuidv7_bytes()
        assert data[6] & 0xF0 == 0x70
        assert data[8] & 0xC0 == 0x80

    def test_timestamp_is_big_endian_leading_48_bits(self):
        data = uuidv7_bytes(0x0123456789AB)
        assert list(data[:6]) == [0x01, 0x23, 0x45, 0x67, 0x89, 0xAB]

    def test_k_sortable(self):
        early = f"cus_{encode_suffix(uuidv7_bytes(1_000_000))}"
        late = f"cus_{encode_suffix(uuidv7_bytes(2_000_000))}"
        assert early < late


class TestMintAndParse:
    def test_prefix_matches_registry(self):
        assert mint_id("customer").startswith("cus_")
        assert mint_id("invoice").startswith("inv_")

    def test_every_registered_type_round_trips(self):
        for entity_type in ENTITY_TYPES:
            assert parse_id(entity_type, mint_id(entity_type))

    def test_unique(self):
        assert len({mint_id("payment") for _ in range(1000)}) == 1000

    def test_rejects_id_of_a_different_type(self):
        customer = mint_id("customer")
        with pytest.raises(IdentityError) as excinfo:
            parse_id("invoice", customer)
        assert excinfo.value.code == "PREFIX_MISMATCH"
        assert "received a customer id" in str(excinfo.value)

    def test_rejects_unregistered_prefix(self):
        with pytest.raises(IdentityError, match="unregistered prefix"):
            parse_id("customer", "zzz_01h455vb4pex5vsknk084sn02q")

    def test_rejects_malformed_suffix(self):
        with pytest.raises(IdentityError, match="malformed suffix"):
            parse_id("customer", "cus_notavalidsuffix")

    @pytest.mark.parametrize("bad", [None, 42, {}, [], ""])
    def test_rejects_non_strings(self, bad):
        with pytest.raises(IdentityError):
            parse_id("customer", bad)

    def test_bare_uuid_rejected_by_default(self):
        with pytest.raises(IdentityError, match="prefixed ids are required"):
            parse_id("customer", "01890a5d-ac96-774b-bcce-b302099a8057")

    def test_bare_uuid_accepted_only_inside_dual_accept_window(self):
        configure_identity(["customer"])
        legacy = "01890a5d-ac96-774b-bcce-b302099a8057"
        assert parse_id("customer", legacy) == legacy
        with pytest.raises(IdentityError):
            parse_id("invoice", legacy)

    def test_assert_ref_is_the_l0_check(self):
        assert assert_ref("customer", mint_id("customer"))
        with pytest.raises(IdentityError):
            assert_ref("customer", mint_id("invoice"))

    def test_try_parse_and_is_id_report_instead_of_raising(self):
        assert try_parse_id("customer", mint_id("invoice")) is None
        assert is_id("customer", mint_id("customer")) is True
        assert is_id("customer", "nonsense") is False

    def test_entity_type_of(self):
        assert entity_type_of(mint_id("invoice")) == "invoice"
        assert entity_type_of("zzz_01h455vb4pex5vsknk084sn02q") is None
        assert entity_type_of("not-an-id") is None

    def test_to_uuid_yields_a_v7_uuid_for_a_uuid_column(self):
        value = to_uuid(mint_id("customer"))
        assert value[14] == "7"
        assert value[19] in "89ab"


class TestResolveGraph:
    def test_mints_per_lid_node_and_resolves_references(self):
        body, id_map = resolve_graph(
            {
                "type": "customer",
                "lid": "1",
                "name": "Acme",
                "invoices": [
                    {"type": "invoice", "lid": "2", "customerId": "lid:1"},
                    {"type": "invoice", "lid": "3", "customerId": "lid:1"},
                ],
            },
            AGGREGATE,
        )
        assert sorted(id_map) == ["1", "2", "3"]
        assert entity_type_of(id_map["1"]) == "customer"
        assert body["id"] == id_map["1"]
        assert body["invoices"][0]["customerId"] == id_map["1"]
        assert body["invoices"][0]["id"] == id_map["2"]
        assert "lid" not in body

    def test_resolves_cycles(self):
        body, id_map = resolve_graph(
            {
                "type": "customer",
                "lid": "a",
                "primaryInvoiceId": "lid:b",
                "invoices": [{"type": "invoice", "lid": "b", "customerId": "lid:a"}],
            },
            AGGREGATE,
        )
        assert body["primaryInvoiceId"] == id_map["b"]
        assert body["invoices"][0]["customerId"] == id_map["a"]

    def test_leaves_a_graph_without_lids_untouched(self):
        payload = {"name": "Acme", "tags": ["a", "b"], "nested": {"n": 1}}
        body, id_map = resolve_graph(payload, AGGREGATE)
        assert body == payload
        assert id_map == {}

    @pytest.mark.parametrize(
        "payload,code",
        [
            ({"type": "customer", "lid": "1", "id": "cus_x"}, "CLIENT_SUPPLIED_ID"),
            ({"type": "customer", "lid": "1", "nested": {"id": "x"}}, "CLIENT_SUPPLIED_ID"),
            ({"type": "customer", "lid": "1", "ref": "lid:missing"}, "UNKNOWN_LID"),
            (
                {"type": "customer", "lid": "1", "c": {"type": "invoice", "lid": "1"}},
                "DUPLICATE_LID",
            ),
            ({"lid": "1", "name": "x"}, "MISSING_TYPE"),
            ({"type": "dragon", "lid": "1"}, "UNKNOWN_TYPE"),
            ({"type": "portal", "lid": "1"}, "CROSS_AGGREGATE_LID"),
            ({"type": "customer", "lid": ""}, "MALFORMED_LID"),
            ({"type": "customer", "lid": 7}, "MALFORMED_LID"),
        ],
    )
    def test_rejections(self, payload, code):
        with pytest.raises(GraphCreateError) as excinfo:
            resolve_graph(payload, AGGREGATE)
        assert excinfo.value.code == code

    def test_bounds_size_and_depth(self):
        nodes = [{"type": "invoice", "lid": f"n{i}"} for i in range(6)]
        with pytest.raises(GraphCreateError) as excinfo:
            resolve_graph({"nodes": nodes}, AGGREGATE, max_nodes=5)
        assert excinfo.value.code == "GRAPH_TOO_LARGE"

        deep = {"type": "invoice", "lid": "x"}
        for _ in range(10):
            deep = {"child": deep}
        with pytest.raises(GraphCreateError) as excinfo:
            resolve_graph(deep, AGGREGATE, max_depth=4)
        assert excinfo.value.code == "GRAPH_TOO_DEEP"

    @pytest.mark.parametrize("lid", ["x" * 65, "<script>alert(1)</script>", "a b", ""])
    def test_bounds_lid_to_the_published_localid_shape(self, lid):
        # lid values come back as idMap KEYS — the one place client-controlled
        # text reaches a response — and the published LocalId schema declares
        # 1-64 chars. Must match the TypeScript LID_FORMAT exactly.
        with pytest.raises(GraphCreateError) as excinfo:
            resolve_graph({"type": "customer", "lid": lid}, AGGREGATE)
        assert excinfo.value.code == "MALFORMED_LID"

    @pytest.mark.parametrize("lid", ["1", "x" * 64, "new-customer", "order.2", "ns:item_3"])
    def test_accepts_useful_lid_shapes(self, lid):
        _, id_map = resolve_graph({"type": "customer", "lid": lid}, AGGREGATE)
        assert id_map[lid].startswith("cus_")

    def test_reports_the_path(self):
        with pytest.raises(GraphCreateError) as excinfo:
            resolve_graph(
                {"type": "customer", "lid": "1", "invoices": [{"id": "nope"}]}, AGGREGATE
            )
        assert excinfo.value.path == "/invoices/0"

    def test_error_response_shape_matches_the_node_middleware(self):
        try:
            resolve_graph({"type": "customer", "lid": "1", "id": "x"}, AGGREGATE)
        except GraphCreateError as err:
            assert err.as_response() == {
                "error": "unprocessable_entity",
                "code": "CLIENT_SUPPLIED_ID",
                "message": err.args[0],
                "path": "",
            }


class TestCrossLanguageParity:
    def test_registry_matches_the_typescript_source(self):
        """The registries must not drift — a mismatch is a cross-language outage."""
        import pathlib
        import re

        ts = (
            pathlib.Path(__file__).resolve().parents[3]
            / "shared"
            / "src"
            / "identity"
            / "registry.ts"
        ).read_text()
        block = re.search(r"ENTITY_PREFIXES = \{(.*?)\n\} as const", ts, re.S)
        assert block, "could not locate ENTITY_PREFIXES in registry.ts"
        ts_pairs = dict(re.findall(r"^\s*(\w+):\s*'([a-z_]+)',", block.group(1), re.M))
        assert ts_pairs == dict(ENTITY_PREFIXES)
