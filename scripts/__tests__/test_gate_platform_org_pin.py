"""Tests for scripts/gate_platform_org_pin.py (CI job `gate-platform-org-pin`).

Every rule has a positive and a negative fixture. The fixtures are tiny real Helm
charts rendered by the real `helm` binary: this gate's whole point is the RENDERED
output, so a mock renderer would test nothing. A missing `helm` is an ERROR here,
never a skip (a gate whose proof-of-failure silently vanishes is the vacuous-pass
failure this repo keeps hitting).

Run:  python3 -m unittest discover -s scripts/__tests__ -p 'test_gate_platform_org_pin.py' -v
"""
from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gate_platform_org_pin as gate

REPO = Path(__file__).resolve().parents[2]
PIN = "org_0000000000000000000000000g"
PIN_UUID = "00000000-0000-0000-0000-000000000010"
OTHER = "org_01h455vb4pex5vsknk084sn02q"

PIN_FILE = {
    "pinnedPlatformOrgId": PIN,
    "pinnedPlatformOrgUuid": PIN_UUID,
    "owner": "izzywdev",
    "rationale": "test",
}

DEPLOYMENT = """\
{{- if .Values.selectionListService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fuzefront-selection-list-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: x
          env:
            # SELECTION_LIST_PLATFORM_ORG_ID is mentioned in a comment on purpose.
            - name: SELECTION_LIST_PLATFORM_ORG_ID
              value: {{ %s | quote }}
{{- end }}
"""


def _values(enabled="false", org='""', extra=""):
    return textwrap.dedent(
        f"""\
        selectionListService:
          enabled: {enabled}
          platformOrgId: {org}
        {extra}"""
    )


class Fixture:
    """A throw-away chart + pin file on disk."""

    def __init__(self, test: unittest.TestCase):
        self.dir = Path(tempfile.mkdtemp(prefix="pinfix-"))
        test.addCleanup(shutil.rmtree, self.dir, True)
        self.chart = self.dir / "chart"
        (self.chart / "templates").mkdir(parents=True)
        (self.chart / "Chart.yaml").write_text("apiVersion: v2\nname: fx\nversion: 0.1.0\n")
        (self.chart / "templates" / "base.yaml").write_text(
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: base\ndata:\n  k: v\n"
        )
        self.pin = self.dir / "pin.json"
        self.pin.write_text(json.dumps(PIN_FILE))
        self.template(DEPLOYMENT % ".Values.selectionListService.platformOrgId")
        self.defaults(_values())
        self.prod(_values())

    def template(self, text):
        (self.chart / "templates" / "dep.yaml").write_text(text)

    def defaults(self, text):
        (self.chart / "values.yaml").write_text(text)

    def prod(self, text):
        (self.chart / "values-prod.yaml").write_text(text)

    def run(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = gate.main(["--chart", str(self.chart), "--pin", str(self.pin)])
        return code, out.getvalue()


class GateCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(shutil.which("helm"), "helm is required to run these tests (no skip)")
        self.fx = Fixture(self)

    def assertPasses(self, text_in=None):
        code, out = self.fx.run()
        self.assertEqual(code, 0, out)
        return out

    def assertFails(self, needle):
        code, out = self.fx.run()
        self.assertEqual(code, 1, out)
        self.assertIn(needle, out)
        return out


class TestPositive(GateCase):
    def test_disabled_and_empty_passes_and_names_the_rule(self):
        out = self.assertPasses()
        self.assertIn("RULE APPLIED disabled-empty-or-pinned", out)
        self.assertIn("allowed", out)

    def test_disabled_with_pinned_id_passes(self):
        self.fx.prod(_values("false", f'"{PIN}"'))
        out = self.assertPasses()
        self.assertIn("RULE APPLIED disabled-empty-or-pinned", out)

    def test_enabled_with_pinned_id_passes_and_names_the_rule(self):
        self.fx.prod(_values("true", f'"{PIN}"'))
        out = self.assertPasses()
        self.assertIn("RULE APPLIED enabled-requires-pinned", out)
        self.assertIn("1 SELECTION_LIST_PLATFORM_ORG_ID occurrence", out)

    def test_pinned_id_inherited_from_defaults_when_overlay_is_silent(self):
        self.fx.defaults(_values("false", f'"{PIN}"'))
        self.fx.prod("replicaCount: 1\n")
        self.assertPasses()

    def test_yaml_merge_keys_in_the_overlay_are_understood(self):
        self.fx.prod(
            "anchors: &a\n  k: v\nother:\n  <<: *a\n" + _values("true", f'"{PIN}"')
        )
        self.assertPasses()

    def test_real_chart_passes_in_its_current_state(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = gate.main(
                [
                    "--chart", str(REPO / "deploy/helm/fuzefront"),
                    "--pin", str(REPO / "governance/platform-org-pin.json"),
                ]
            )
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("RULE APPLIED", out.getvalue())

    def test_real_pin_file_is_self_consistent(self):
        data = gate.load_pin(REPO / "governance/platform-org-pin.json")
        self.assertEqual(data["pinnedPlatformOrgId"], PIN)
        self.assertEqual(data["pinnedPlatformOrgUuid"], PIN_UUID)


class TestOverlayAndEffectiveRules(GateCase):
    def test_non_pinned_id_fails(self):
        self.fx.prod(_values("false", f'"{OTHER}"'))
        self.assertFails("[overlay-literal]")

    def test_non_pinned_id_fails_even_when_inherited_from_defaults(self):
        self.fx.defaults(_values("false", f'"{OTHER}"'))
        self.fx.prod("replicaCount: 1\n")
        self.assertFails("[effective-values]")

    def test_bare_uuid_fails_and_is_named(self):
        self.fx.prod(_values("false", f'"{PIN_UUID}"'))
        out = self.assertFails("bare UUID")
        self.assertIn("[overlay-literal]", out)

    def test_whitespace_variant_fails_in_every_layer(self):
        self.fx.prod(_values("false", f'" {PIN}"'))
        out = self.assertFails("leading/trailing whitespace")
        for layer in ("[overlay-literal]", "[effective-values]", "[rendered-forced]"):
            self.assertIn(layer, out)

    def test_case_variant_fails_in_every_layer(self):
        self.fx.prod(_values("false", f'"{PIN.upper()}"'))
        out = self.assertFails("letter case")
        for layer in ("[overlay-literal]", "[effective-values]", "[rendered-forced]"):
            self.assertIn(layer, out)

    def test_enabled_with_variant_of_the_pin_fails_the_enabled_rule(self):
        for variant in (PIN_UUID, PIN.upper(), f" {PIN}", f"{PIN} "):
            with self.subTest(variant=variant):
                self.fx.prod(_values("true", f'"{variant}"'))
                out = self.assertFails("enabled-requires-pinned")
                self.assertIn("[rendered]", out)

    def test_rendered_layer_rejects_hardcoded_variants_of_the_pin(self):
        # Clean values, but the template emits a variant: only the render can see it.
        for variant in (PIN.upper(), PIN_UUID, f" {PIN}"):
            with self.subTest(variant=variant):
                self.fx.template(DEPLOYMENT % f'"{variant}"')
                self.assertFails("[rendered-forced]")

    def test_enabled_with_empty_fails(self):
        self.fx.prod(_values("true", '""'))
        out = self.assertFails("enabled-requires-pinned")
        self.assertIn("[effective-values]", out)

    def test_enabled_with_empty_inherited_fails(self):
        self.fx.prod("selectionListService:\n  enabled: true\n")
        self.assertFails("enabled-requires-pinned")

    def test_enabled_with_non_pinned_id_fails(self):
        self.fx.prod(_values("true", f'"{OTHER}"'))
        self.assertFails("production may only be")

    def test_platform_org_id_must_be_a_string(self):
        self.fx.prod(_values("false", "123"))
        self.assertFails("must be a string")

    def test_enabled_must_be_a_boolean(self):
        self.fx.prod(_values('"false"', '""'))
        self.assertFails("must be a boolean")

    def test_missing_key_is_not_defaulted(self):
        self.fx.defaults("selectionListService:\n  enabled: false\n")
        self.fx.prod("replicaCount: 1\n")
        code, out = self.fx.run()
        self.assertEqual(code, 1, out)
        self.assertIn("is not declared", out)

    def test_null_deletes_the_key_and_is_not_silently_empty(self):
        self.fx.prod("selectionListService:\n  platformOrgId: null\n")
        code, out = self.fx.run()
        self.assertEqual(code, 1, out)
        self.assertIn("is not declared", out)


class TestRenderedRules(GateCase):
    def test_template_hardcoding_another_org_fails_at_enablement(self):
        # Values are all clean, but the template ignores them: only the forced-on
        # render can see this.
        self.fx.template(DEPLOYMENT % f'"{OTHER}"')
        self.assertFails("[rendered-forced]")

    def test_enabled_render_with_diverging_env_fails(self):
        self.fx.template(DEPLOYMENT % f'"{OTHER}"')
        self.fx.prod(_values("true", f'"{PIN}"'))
        self.assertFails("[rendered]")

    def test_enabled_render_with_empty_env_fails(self):
        # values say pinned, template drops it: the deployed env would be empty.
        self.fx.template(DEPLOYMENT % '""')
        self.fx.prod(_values("true", f'"{PIN}"'))
        self.assertFails("[rendered]")

    def test_valuefrom_env_is_rejected(self):
        self.fx.template(
            DEPLOYMENT.replace(
                "value: {{ %s | quote }}",
                "valueFrom: {secretKeyRef: {name: s, key: k}}",
            )
        )
        self.fx.prod(_values("true", f'"{PIN}"'))
        self.assertFails("uses valueFrom")

    def test_env_in_a_configmap_key_form_is_checked_too(self):
        self.fx.template(
            DEPLOYMENT % ".Values.selectionListService.platformOrgId"
            + "---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\ndata:\n"
            + f"  SELECTION_LIST_PLATFORM_ORG_ID: {OTHER}\n"
        )
        self.assertFails("[rendered-forced]")

    def test_unreadable_wiring_is_fail_closed(self):
        # The name appears in a non-structured spot (a multi-line string).
        self.fx.template(
            DEPLOYMENT % ".Values.selectionListService.platformOrgId"
            + "---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\ndata:\n"
            + "  script: |\n    export SELECTION_LIST_PLATFORM_ORG_ID=whatever\n"
        )
        self.assertFails("cannot read")

    def test_deployment_present_while_values_say_disabled_fails(self):
        self.fx.template(DEPLOYMENT.replace("{{- if .Values.selectionListService.enabled }}", "{{- if true }}")
                         % ".Values.selectionListService.platformOrgId")
        code, out = self.fx.run()
        self.assertEqual(code, 1, out)
        self.assertIn("disagrees with the values", out)


class TestFailClosed(GateCase):
    def test_unparsable_values_fail(self):
        self.fx.prod("selectionListService: [unclosed\n")
        self.assertFails("not parseable YAML")

    def test_duplicate_key_in_overlay_fails(self):
        self.fx.prod(
            "selectionListService:\n  enabled: false\n  platformOrgId: \"\"\n"
            f"  platformOrgId: \"{PIN}\"\n"
        )
        self.assertFails("duplicate YAML key")

    def test_missing_overlay_file_fails(self):
        (self.fx.chart / "values-prod.yaml").unlink()
        self.assertFails("does not exist")

    def test_missing_defaults_file_fails(self):
        (self.fx.chart / "values.yaml").unlink()
        self.assertFails("does not exist")

    def test_missing_pin_file_fails(self):
        self.fx.pin.unlink()
        self.assertFails("pin file")

    def test_unparsable_pin_file_fails(self):
        self.fx.pin.write_text("{not json")
        self.assertFails("not valid JSON")

    def test_pin_with_missing_field_fails(self):
        bad = dict(PIN_FILE)
        del bad["owner"]
        self.fx.pin.write_text(json.dumps(bad))
        self.assertFails("'owner' is missing")

    def test_pin_whose_uuid_disagrees_with_typeid_fails(self):
        bad = dict(PIN_FILE, pinnedPlatformOrgUuid="00000000-0000-0000-0000-000000000011")
        self.fx.pin.write_text(json.dumps(bad))
        self.assertFails("inconsistent")

    def test_pin_that_is_not_a_canonical_typeid_fails(self):
        bad = dict(PIN_FILE, pinnedPlatformOrgId=PIN_UUID)
        self.fx.pin.write_text(json.dumps(bad))
        self.assertFails("not a canonical lowercase org_ TypeID")

    def test_chart_that_fails_to_render_fails(self):
        self.fx.template("{{ fail \"boom\" }}\n")
        self.assertFails("`helm template` failed")

    def test_missing_helm_binary_fails_not_skips(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = gate.main(
                ["--chart", str(self.fx.chart), "--pin", str(self.fx.pin), "--helm", "helm-does-not-exist"]
            )
        self.assertEqual(code, 1, out.getvalue())
        self.assertIn("not found", out.getvalue())


class TestTypeId(unittest.TestCase):
    def test_pin_typeid_decodes_to_the_root_org_uuid(self):
        self.assertEqual(str(gate.decode_org_typeid(PIN)), PIN_UUID)

    def test_rejects_uppercase_and_wrong_length_and_overflow(self):
        for bad in (PIN.upper(), "org_0", PIN_UUID, "org_" + "z" * 26, "usr_" + "0" * 25 + "g"):
            with self.assertRaises(gate.GateError):
                gate.decode_org_typeid(bad)


if __name__ == "__main__":
    unittest.main()
