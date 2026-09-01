"""Tests for scripts/gate_federation_contract.py.

These assert that the gate **FAILS**, and fails NAMING THE RIGHT LAYER, on a violation
planted in exactly one layer at a time. A gate is only worth its runtime if it is known
to fire; this repo has been bitten by checks that were green solely because they had
nothing to say (`claude-auto-pr.yml` -- every green run was its early-exit path, and the
one time it had real work it failed; a `.gitleaks.toml` with no rules; `gate-authz`'s
trailing `|| true`). Passing is not evidence.

Two fixtures are named after real repos and are the reason this file exists:

  the FuzeService shape  correct manifest, correct vite base, correct Ingress, nginx with
                         no `/apps/<slug>/` location, Dockerfile copying the build FLAT.
                         MUST FAIL, and must fail on [L4b image-layout] specifically --
                         its nginx conf is FINE (root + catch-all resolves the path
                         correctly), so a layer-4 check that read only the nginx conf
                         would have passed the exact defect that shipped.

  the FuzeKeys shape     `location ^~ /apps/<x>/ { alias ...; }` with the build baked
                         there. MUST PASS.

Run: python -m unittest discover -s scripts/__tests__ -p 'test_*.py'
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(REPO_ROOT, "scripts", "gate_federation_contract.py")


def run_gate(root: str, *flags: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, GATE, root, *flags],
        capture_output=True, text=True, timeout=180,
        # The ratchet keys off the repo name; a stray GITHUB_REPOSITORY in the ambient
        # environment (every GitHub Actions runner has one) would otherwise silently
        # decide which fixture is "known failing" and make these tests report on the
        # wrong repo.
        env={k: v for k, v in os.environ.items() if k != "GITHUB_REPOSITORY"},
    )


def layers(result) -> set:
    """The layer tokens the gate actually printed as ERRORS."""
    out = set()
    for line in result.stdout.splitlines():
        if "::error" not in line:
            continue
        for tok in ("L1 manifest", "L2 build-base", "L3 ingress",
                    "L4a webserver", "L4b image-layout"):
            if f"[{tok}]" in line:
                out.add(tok)
    return out


def warn_layers(result) -> set:
    out = set()
    for line in result.stdout.splitlines():
        if "::warning" not in line:
            continue
        for tok in ("L1 manifest", "L2 build-base", "L3 ingress",
                    "L4a webserver", "L4b image-layout"):
            if f"[{tok}]" in line:
                out.add(tok)
    return out


class Repo:
    """A synthetic repo on disk. The gate walks the tree; no git needed."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def write(self, rel: str, content: str) -> None:
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(content).lstrip("\n"))

    def rm(self, rel: str) -> None:
        os.remove(os.path.join(self.root, rel))

    def read(self, rel: str) -> str:
        with open(os.path.join(self.root, rel), encoding="utf-8") as f:
            return f.read()

    def __enter__(self) -> "Repo":
        return self

    def __exit__(self, *exc) -> None:
        self._tmp.cleanup()


# --------------------------------------------------------------------------------------
# The all-four-agree fixture. Every negative test below is this, with ONE layer broken.
# --------------------------------------------------------------------------------------

def manifest_json(slug="widget", entry="/apps/widget/remoteEntry.js",
                  itype="module-federation", scope="widgetApp"):
    body = {
        "manifestVersion": "1",
        "slug": slug,
        "name": "Widget",
        "integration": {"type": itype, "scope": scope, "module": "./WidgetApp"},
        "routing": {"path": "/app/widget"},
    }
    if entry is not None:
        body["integration"]["remoteEntry"] = entry
    return json.dumps(body, indent=2) + "\n"


VITE = """
    import {{ defineConfig }} from 'vite'
    import federation from '@originjs/vite-plugin-federation'

    export default defineConfig({{
      plugins: [
        federation({{
          name: 'widgetApp',
          filename: 'remoteEntry.js',
          exposes: {{ './WidgetApp': './src/App' }},
          shared: {{ react: {{ singleton: true, requiredVersion: '^19.0.0' }} }},
        }}),
      ],
      base: '{base}',
      build: {{
        outDir: 'dist-mfe',
        target: 'esnext',{assets_dir}
      }},
    }})
"""

INGRESS = """
    apiVersion: networking.k8s.io/v1
    kind: Ingress
    metadata:
      name: widget
    spec:
      rules:
        - host: widget.example.com
          http:
            paths:
              - path: {path}
                pathType: Prefix
                backend:
                  service:
                    name: widget
                    port: {{ number: 80 }}
"""

NGINX_ALIAS = """
    server {{
        listen 80;
        root /usr/share/nginx/html;
        index index.html;

        location ^~ {serve_root} {{
            alias {alias};
            add_header Access-Control-Allow-Origin "https://app.fuzefront.com" always;
            try_files $uri $uri/ =404;
        }}

        location / {{
            try_files $uri $uri/ /index.html;
        }}
    }}
"""

DOCKERFILE = """
    FROM node:24-alpine AS build
    WORKDIR /app
    COPY . .
    RUN npm ci && npm run build:mfe

    FROM nginx:alpine
    COPY --from=build /app/dist-mfe {dest}
    COPY nginx.conf /etc/nginx/conf.d/default.conf
    EXPOSE 80
"""


def good_repo(slug="widget", serve_root="/apps/widget/",
              entry=None, itype="module-federation"):
    """All four layers agreeing. `serve_root` is free-form on purpose."""
    r = Repo()
    entry = entry if entry is not None else serve_root + "remoteEntry.js"
    body = manifest_json(slug=slug, entry=entry, itype=itype)
    r.write("registration/manifest.json", body)
    r.write("deploy/helm/widget/files/registration/manifest.json", body)
    r.write("frontend/vite.config.ts",
            VITE.format(base=serve_root, assets_dir="\n    assetsDir: '',"))
    r.write("deploy/helm/widget/Chart.yaml", "apiVersion: v2\nname: widget\nversion: 0.1.0\n")
    r.write("deploy/helm/widget/templates/ingress.yaml", INGRESS.format(path="/"))
    r.write("frontend/nginx.conf",
            NGINX_ALIAS.format(serve_root=serve_root,
                               alias="/usr/share/nginx/html" + serve_root))
    r.write("frontend/Dockerfile",
            DOCKERFILE.format(dest="/usr/share/nginx/html" + serve_root.rstrip("/")))
    return r


# --------------------------------------------------------------------------------------

class TestAllFourAgree(unittest.TestCase):

    def test_passes(self):
        with good_repo() as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("all four layers agree", result.stdout)

    def test_agreement_on_a_path_unrelated_to_the_slug_passes(self):
        """LOAD-BEARING, and re-litigated four times in this fleet.

        The assertion is that the four layers agree with EACH OTHER, not that they match
        the slug. `loadFederatedApp.ts:71` is the whole mechanism -- `new URL(remoteEntry,
        origin)` -- and the slug is not an input to it. A gate that demanded
        path == slug would produce exactly the finding that has driven four rounds of
        wrong slug migrations, each of which strands the live registration.
        """
        with good_repo(slug="widget", serve_root="/apps/totally-unrelated/") as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_no_finding_ever_prescribes_editing_a_slug(self):
        with good_repo(slug="widget", serve_root="/apps/nowhere/") as r:
            r.write("frontend/vite.config.ts",
                    VITE.format(base="/apps/elsewhere/", assets_dir="\n    assetsDir: '',"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("never by editing the slug", result.stdout)
        self.assertNotIn("should match the slug", result.stdout)
        self.assertNotIn("rename the slug", result.stdout)


class TestOneNegativePerLayer(unittest.TestCase):
    """One planted mismatch per layer. Each asserts the gate FAILS and NAMES that layer."""

    def test_L1_vendored_helm_copy_diverges(self):
        with good_repo() as r:
            r.write("deploy/helm/widget/files/registration/manifest.json",
                    manifest_json(entry="/apps/stale/remoteEntry.js"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L1 manifest", layers(result))
        self.assertIn("DIFFERS", result.stdout)

    def test_L2_missing_assetsDir_pushes_the_entry_a_segment_deeper(self):
        """The real FuzeKeys defect, and the reason `assetsDir: ''` is the convention.

        @originjs/vite-plugin-federation emits the entry at `${assetsDir}/${filename}`
        (dist/index.js:1231) with assetsDir defaulting to Vite's `assets` (:1777). Drop
        `assetsDir: ''` and the built entry is /apps/widget/assets/remoteEntry.js while
        the manifest still advertises /apps/widget/remoteEntry.js. `base` is unchanged,
        so layers 3 and 4 stay correct -- this isolates L2.
        """
        with good_repo() as r:
            r.write("frontend/vite.config.ts", VITE.format(base="/apps/widget/", assets_dir=""))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L2 build-base"}, result.stdout)
        self.assertIn("/apps/widget/assets/remoteEntry.js", result.stdout)

    def test_L3_ingress_routes_a_different_prefix(self):
        with good_repo() as r:
            r.write("deploy/helm/widget/templates/ingress.yaml", INGRESS.format(path="/other"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L3 ingress"}, result.stdout)
        self.assertIn("no Ingress path routes", result.stdout)

    def test_L4a_nginx_alias_points_at_a_directory_the_image_does_not_use(self):
        """Layer 4, first half. The image layout is RIGHT and nginx is wrong, which is
        how the attribution tie-break is decided: whichever half agrees with the serve
        path the other three layers already settled is the half that is correct."""
        with good_repo() as r:
            r.write("frontend/nginx.conf",
                    NGINX_ALIAS.format(serve_root="/apps/widget/",
                                       alias="/usr/share/nginx/html/apps/wrong/"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L4a webserver"}, result.stdout)
        self.assertIn("/usr/share/nginx/html/apps/wrong", result.stdout)

    def test_L4b_dockerfile_copies_the_build_flat(self):
        """Layer 4, second half -- ITS OWN TEST, because this is the one that shipped."""
        with good_repo() as r:
            r.write("frontend/Dockerfile", DOCKERFILE.format(dest="/usr/share/nginx/html"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L4b image-layout"}, result.stdout)
        self.assertIn("copied FLAT", result.stdout)


class TestVendoredCopyOwnershipIsPositional(unittest.TestCase):
    """Identify the vendored copy by PATH; validate it by CONTENT. Never the reverse.

    The bug these pin: identification used to require slug equality, so slug equality was
    doing two jobs -- identifying the copy AND validating it -- and a failure of the
    second silently disabled the first. A copy whose slug had gone stale read as "a
    different product" and was skipped, turning the check off precisely when it had
    something to say.

    Live on FuzeAgent main 0f38ee1: the vendored copy carried slug "agent" (root:
    "fuzeagent") and the old cross-origin remoteEntry. `diff` showed both fields
    differing; the gate reported nothing.
    """

    def fuzeagent_shape(self, vendored_slug="agent"):
        r = Repo()
        root_body = manifest_json(slug="fuzeagent",
                                  entry="/apps/fuzeagent/remoteEntry.js",
                                  scope="fuzeagentApp")
        r.write("registration/manifest.json", root_body)
        r.write("deploy/helm/fuzeagent/Chart.yaml",
                "apiVersion: v2\nname: fuzeagent\nversion: 0.1.0\n")
        # Stale on BOTH counts, exactly as shipped: an old slug and the pre-same-origin
        # cross-origin address.
        r.write("deploy/helm/fuzeagent/files/registration/manifest.json",
                manifest_json(slug=vendored_slug,
                              entry="https://fuzeagent.prod.fuzefront.com/remoteEntry.js",
                              scope="fuzeagentApp"))
        r.write("services/ui-react/vite.config.ts",
                VITE.format(base="/apps/fuzeagent/", assets_dir="\n    assetsDir: '',")
                    .replace("widgetApp", "fuzeagentApp"))
        r.write("deploy/helm/fuzeagent/templates/ingress.yaml", INGRESS.format(path="/"))
        r.write("services/ui-react/nginx.conf",
                NGINX_ALIAS.format(serve_root="/apps/fuzeagent/",
                                   alias="/usr/share/nginx/html/apps/fuzeagent/"))
        r.write("services/ui-react/Dockerfile",
                DOCKERFILE.format(dest="/usr/share/nginx/html/apps/fuzeagent"))
        return r

    def test_a_vendored_copy_with_a_STALE_SLUG_still_fails_L1(self):
        """The regression. A differing slug must never make the copy invisible."""
        with self.fuzeagent_shape() as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L1 manifest", layers(result), result.stdout)

    def test_the_slug_finding_names_both_slugs_and_both_files(self):
        with self.fuzeagent_shape() as r:
            result = run_gate(r.root)
        self.assertIn("'agent'", result.stdout)
        self.assertIn("'fuzeagent'", result.stdout)
        self.assertIn("deploy/helm/fuzeagent/files/registration/manifest.json", result.stdout)
        self.assertIn("registration/manifest.json", result.stdout)

    def test_the_slug_finding_prescribes_fixing_the_COPY_and_NOT_the_root(self):
        """A stale slug is worse than a stale path -- the init container POSTs the copy,
        so it registers a SECOND, WRONG app. The fix direction must be unambiguous, or
        this becomes the sixth instance of somebody editing an authoritative slug."""
        with self.fuzeagent_shape() as r:
            result = run_gate(r.root)
        self.assertIn("Fix the VENDORED COPY, never the root", result.stdout)
        self.assertIn("registers a second, wrong app", result.stdout)
        self.assertNotIn("rename the slug", result.stdout)

    def test_the_drifted_remoteEntry_is_reported_TOO_not_masked_by_the_slug(self):
        """Both divergences are real and independently actionable; reporting only the
        first would leave the cross-origin address to be found a second time."""
        with self.fuzeagent_shape() as r:
            result = run_gate(r.root)
        self.assertIn("https://fuzeagent.prod.fuzefront.com/remoteEntry.js", result.stdout)
        self.assertGreaterEqual(
            sum(1 for l in result.stdout.splitlines()
                if "::error" in l and "[L1 manifest]" in l), 2, result.stdout)

    def test_a_matching_vendored_copy_is_still_clean(self):
        with self.fuzeagent_shape(vendored_slug="fuzeagent") as r:
            # Make it byte-identical, which is the contract.
            import shutil
            shutil.copyfile(
                os.path.join(r.root, "registration/manifest.json"),
                os.path.join(r.root,
                             "deploy/helm/fuzeagent/files/registration/manifest.json"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_a_FOREIGN_products_vendored_manifest_is_still_ignored(self):
        """The negative half. FuzeFront vendors a whole FuzeQuality/ tree, chart and all.
        A foreign copy lives under ITS OWN chart path, which is not one of this repo's
        anchored chart roots, so a positional rule excludes it -- and for the right
        reason, rather than by accidentally comparing slugs."""
        with good_repo() as r:
            r.write("OtherProduct/helm/other/Chart.yaml",
                    "apiVersion: v2\nname: other\nversion: 0.1.0\n")
            r.write("OtherProduct/helm/other/files/registration/manifest.json",
                    manifest_json(slug="other", entry="/apps/other/remoteEntry.js"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("OtherProduct", result.stdout)

    def test_a_chart_dir_without_a_ChartYaml_confers_nothing(self):
        """Chart.yaml is required as EVIDENCE, so a directory merely named helm/ cannot
        drag an unrelated manifest into this product's identity."""
        with good_repo() as r:
            r.write("helm/notachart/files/registration/manifest.json",
                    manifest_json(slug="stranger", entry="/apps/stranger/remoteEntry.js"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("stranger", result.stdout)

    def test_slug_equality_survives_only_as_an_ADDITIONAL_inclusion_rule(self):
        """A copy of THIS product outside any chart directory is still picked up. The two
        rules union; neither may suppress the other."""
        with good_repo() as r:
            r.write("packaging/registration/manifest.json",
                    manifest_json(slug="widget", entry="/apps/stale/remoteEntry.js"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L1 manifest", layers(result), result.stdout)
        self.assertIn("packaging/registration/manifest.json", result.stdout)


class TestRealWorldShapes(unittest.TestCase):

    def fuzeservice_shape(self):
        """Correct manifest, correct vite base, correct Ingress, nginx with NO matching
        `location`, Dockerfile copying flat. The nginx ConfigMap dialect, as shipped."""
        r = Repo()
        body = manifest_json(slug="service", entry="/apps/service/remoteEntry.js",
                             scope="fuzeservice")
        r.write("registration/manifest.json", body)
        r.write("helm/fuzeservice/files/registration/manifest.json", body)
        r.write("packages/fuze-service/vite.config.ts",
                VITE.format(base="/apps/service/", assets_dir="\n    assetsDir: '',")
                    .replace("widgetApp", "fuzeservice"))
        r.write("helm/fuzeservice/templates/ingress.yaml", INGRESS.format(path="/"))
        r.write("helm/fuzeservice/templates/nginx-configmap.yaml", """
            apiVersion: v1
            kind: ConfigMap
            metadata:
              name: fuzeservice-nginx
            data:
              default.conf: |
                server {
                    listen 80;
                    root /usr/share/nginx/html;
                    index index.html;

                    location / {
                        try_files $uri $uri/ /index.html;
                    }

                    location ~* \\.(js|css|png|svg)$ {
                        expires 1y;
                    }
                }
            """)
        r.write("Dockerfile", """
            FROM node:20-alpine AS builder
            WORKDIR /app
            COPY . .
            RUN npm install && npm run build:mfe

            FROM nginx:alpine
            COPY --from=builder /app/packages/fuze-service/dist-mfe /usr/share/nginx/html
            COPY public/index.html /usr/share/nginx/html/index.html
            EXPOSE 80
            """)
        return r

    def test_the_fuzeservice_shape_fails(self):
        with self.fuzeservice_shape() as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L4b image-layout", layers(result))

    def test_the_fuzeservice_shape_is_NOT_caught_by_the_nginx_half_alone(self):
        """The whole reason layer 4 is split in two.

        FuzeService's `location / { root /usr/share/nginx/html; }` resolves
        /apps/service/remoteEntry.js to /usr/share/nginx/html/apps/service/remoteEntry.js
        -- exactly right. The conf is not the defect. Nothing ever put a file there. A
        layer-4 check that read only the nginx conf would have passed the outage.
        """
        with self.fuzeservice_shape() as r:
            result = run_gate(r.root)
        self.assertNotIn("L4a webserver", layers(result), result.stdout)

    def fuzepicker_88_shape(self):
        """THE WRONG-PREFIX SHAPE. Three layers agree on `/apps/picker/`; nginx declares
        `location ^~ /apps/fuzepicker/` with an alias that is otherwise correct.

        This is a DIFFERENT failure from the FuzeService fixture above. There the
        location is ABSENT; here it is PRESENT AND WRONG, which is worse in two ways:
        the block looks deliberate to a reviewer, and a gate that merely falls through to
        the catch-all blames the Dockerfile and sends the fix to the wrong file.

        Real, and the fifth instance of one root error: FuzePicker #88 changed the prefix
        to `/apps/fuzepicker/` reasoning from `backend/src/routes/appRegistry.ts`, which
        derives a slug from a name -- the CI/local-only fallback gated on
        `APP_REGISTRY_LOCAL_ADAPTER=1`, default OFF. Production is
        `backend/applications/src/app-registry/service.ts`, storing `slug: row.slug`
        verbatim. Citing the fallback had already caused three wrong migrations before
        this one. #89 reverts it with a one-word diff.
        """
        r = Repo()
        body = manifest_json(slug="picker", entry="/apps/picker/remoteEntry.js",
                             scope="pickerApp")
        r.write("registration/manifest.json", body)
        r.write("deploy/helm/fuzepicker/files/registration/manifest.json", body)
        r.write("picker-app/vite.config.ts",
                VITE.format(base="/apps/picker/", assets_dir="\n    assetsDir: '',")
                    .replace("widgetApp", "pickerApp"))
        r.write("deploy/helm/fuzepicker/templates/ingress.yaml",
                INGRESS.format(path="/apps/picker"))
        # The alias is IDENTICAL to what a correct config would carry; only the prefix
        # differs. The build is flat at the docroot ON PURPOSE -- that is what the alias
        # is for -- so the image layout is right and must not be "fixed".
        r.write("picker-app/nginx.conf", """
            server {
                listen 8080;
                root /usr/share/nginx/html;
                index index.html;

                location = /healthz {
                    return 200 'ok';
                }

                location ~* \\.(js|css|woff2?)$ {
                    expires 1y;
                }

                location ^~ /apps/fuzepicker/ {
                    alias /usr/share/nginx/html/;
                    try_files $uri $uri/ =404;
                }

                location / {
                    try_files $uri $uri/ /index.html;
                }
            }
            """)
        r.write("picker-app/Dockerfile", """
            FROM node:20-alpine AS build
            WORKDIR /app
            COPY . .
            RUN npm ci && npm run build

            FROM nginxinc/nginx-unprivileged:1.27-alpine
            COPY nginx.conf /etc/nginx/conf.d/default.conf
            COPY --from=build /app/dist /usr/share/nginx/html
            """)
        return r

    def test_a_present_but_WRONG_PREFIX_mount_location_fails_on_L4a(self):
        with self.fuzepicker_88_shape() as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L4a webserver"}, result.stdout)

    def test_the_wrong_prefix_finding_names_both_prefixes_and_the_nginx_file(self):
        with self.fuzepicker_88_shape() as r:
            result = run_gate(r.root)
        self.assertIn("picker-app/nginx.conf", result.stdout)
        self.assertIn("location ^~ /apps/fuzepicker/", result.stdout)
        self.assertIn("/apps/picker/", result.stdout)

    def test_the_wrong_prefix_finding_does_NOT_blame_the_dockerfile(self):
        """The regression this check exists to prevent. Before it, this exact shape
        reported `[L4b image-layout] ... The build is copied FLAT: the image must place
        it at /usr/share/nginx/html/apps/picker` -- sending a one-word nginx fix into a
        Dockerfile restructure, and undoing the alias design the repo deliberately chose.
        """
        with self.fuzepicker_88_shape() as r:
            result = run_gate(r.root)
        self.assertNotIn("L4b image-layout", layers(result), result.stdout)
        self.assertIn("THE IMAGE LAYOUT IS CORRECT", result.stdout)
        self.assertIn("Dockerfile must NOT be changed", result.stdout)

    def test_the_wrong_prefix_finding_never_prescribes_touching_the_slug(self):
        """Five rounds of this error have each ended in someone editing an identity
        field. The finding must send the fix to nginx and say so explicitly."""
        with self.fuzepicker_88_shape() as r:
            result = run_gate(r.root)
        self.assertIn("never the slug", result.stdout)
        self.assertIn("fix the prefix to /apps/picker/", result.stdout)
        self.assertNotIn("rename the slug", result.stdout)
        self.assertNotIn("should match the slug", result.stdout)

    def test_a_host_serving_SEVERAL_correct_mounts_is_not_flagged(self):
        """The guard against over-firing. Orphan detection runs ONLY once layer 4 is
        already known broken, so a repo whose own mount resolves correctly is never
        accused because a sibling mount exists on another prefix."""
        with good_repo(serve_root="/apps/widget/") as r:
            r.write("frontend/nginx.conf", """
                server {
                    listen 80;
                    root /usr/share/nginx/html;

                    location ^~ /apps/sibling/ {
                        alias /usr/share/nginx/html/apps/sibling/;
                    }

                    location ^~ /apps/widget/ {
                        alias /usr/share/nginx/html/apps/widget/;
                        try_files $uri $uri/ =404;
                    }

                    location / {
                        try_files $uri $uri/ /index.html;
                    }
                }
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("all four layers agree", result.stdout)

    def test_ordinary_locations_are_never_called_federated_mounts(self):
        """Pins the NARROWNESS of the mount-shape match, which nothing else does.

        Orphan detection only runs once layer 4 is already broken, and at that moment
        every non-matching prefix location is a candidate. If the shape test were loosened
        to "any prefix", a `= /healthz` or `/api/` block would be reported as a dead
        federated mount -- a confident, specific, wrong finding, which is worse than
        silence because someone will act on it. Found by a mutation that escaped the rest
        of this suite.
        """
        with good_repo() as r:
            # Break layer 4 so orphan detection actually runs.
            r.write("frontend/Dockerfile", DOCKERFILE.format(dest="/usr/share/nginx/html"))
            r.write("frontend/nginx.conf", """
                server {
                    listen 80;
                    root /usr/share/nginx/html;

                    location = /healthz { return 200 'ok'; }
                    location /api/ { proxy_read_timeout 60s; }
                    location /static/ { expires 1y; }

                    location / {
                        try_files $uri $uri/ /index.html;
                    }
                }
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L4b image-layout"}, result.stdout)
        for noise in ("/healthz", "/api/", "/static/"):
            self.assertNotIn(f"`location {noise}", result.stdout,
                             f"{noise} is not a federated mount")
        self.assertNotIn("federated-mount block", result.stdout)

    def test_the_fuzekeys_shape_passes(self):
        """`location ^~ /apps/<x>/ { alias ...; }` + the build baked there."""
        r = Repo()
        body = manifest_json(slug="keys", entry="/apps/fuzekeys/remoteEntry.js",
                             scope="fuzeKeysApp")
        with r:
            r.write("registration/manifest.json", body)
            r.write("deploy/helm/fuzekeys/files/registration/manifest.json", body)
            r.write("frontend/vite.config.ts",
                    VITE.format(base="/apps/fuzekeys/", assets_dir="\n    assetsDir: '',")
                        .replace("widgetApp", "fuzeKeysApp"))
            r.write("deploy/helm/fuzekeys/templates/ingress.yaml",
                    INGRESS.format(path='{{ .path | default "/" }}'))
            r.write("frontend/nginx.conf",
                    NGINX_ALIAS.format(serve_root="/apps/fuzekeys/",
                                       alias="/usr/share/nginx/html/apps/fuzekeys/"))
            r.write("frontend/Dockerfile", """
                FROM node:24-alpine AS build-mfe
                WORKDIR /app
                COPY . .
                RUN npm run build:mfe

                FROM nginx:alpine
                # MFE assets at /apps/fuzekeys/ (FuzeFront fetches remoteEntry.js here)
                COPY --from=build-mfe /app/dist-mfe /usr/share/nginx/html/apps/fuzekeys
                COPY nginx.conf /etc/nginx/conf.d/default.conf
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("all four layers agree", result.stdout)

    def test_a_helm_templated_ingress_path_with_a_literal_default_resolves(self):
        """FuzeKeys ships `- path: {{ .path | default "/" }}`. The literal fallback IS
        the shipped route when values are silent, so it must resolve rather than being
        reported as unknowable -- otherwise the fleet's positive control fails L3."""
        with good_repo() as r:
            r.write("deploy/helm/widget/templates/ingress.yaml",
                    INGRESS.format(path='{{ .path | default "/" }}'))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)


class TestNodeExpressServingDialect(unittest.TestCase):
    """Layer 4a's second dialect. nginx is declarative; Node serving is CODE.

    Since code cannot be executed here, the reader is built for an honest subset -- a
    mount whose URL prefix and filesystem root are BOTH literals -- and anything outside
    it is reported UNREADABLE rather than guessed. These pin that boundary in both
    directions: the readable shapes must be read correctly, and the unreadable ones must
    NOT come out clean.

    All three fixtures are the live shapes, and they differ from each other, which is
    exactly why each was read rather than assumed to match the first.
    """

    def _common(self, r, slug, serve_root):
        body = manifest_json(slug=slug, entry=serve_root + "remoteEntry.js",
                             scope=slug + "App")
        r.write("registration/manifest.json", body)
        r.write("deploy/helm/%s/Chart.yaml" % slug,
                "apiVersion: v2\nname: %s\nversion: 0.1.0\n" % slug)
        r.write("deploy/helm/%s/files/registration/manifest.json" % slug, body)
        r.write("deploy/helm/%s/templates/ingress.yaml" % slug, INGRESS.format(path="/"))
        r.write("federation/vite.config.ts",
                VITE.format(base=serve_root, assets_dir="\n    assetsDir: '',")
                    .replace("widgetApp", slug + "App"))

    def fuzemarket_shape(self):
        """Hand-rolled `serveStatic()` joining the request path straight onto ROOT -- a
        mount at `/` -- with ROOT from `process.env.STATIC_DIR`, set literally by the
        Dockerfile. The build lands at /app/site/dist, so /apps/market/remoteEntry.js
        resolves to /app/site/apps/market and 404s. Real and unfixed."""
        r = Repo()
        self._common(r, "market", "/apps/market/")
        r.write("server/server.js", """
            const http = require('http');
            const path = require('path');
            const fs = require('fs');
            const ROOT = process.env.STATIC_DIR
              ? path.resolve(process.env.STATIC_DIR)
              : path.resolve(__dirname, "..");
            function serveStatic(res, rel) {
              let safe = path.normalize(rel || "index.html");
              let p = path.join(ROOT, safe);
              fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); res.end(); } });
            }
            const server = http.createServer((req, res) => {
              const url = new URL(req.url, "http://localhost");
              if (url.pathname.startsWith("/api/")) { return; }
              serveStatic(res, decodeURIComponent(url.pathname.replace(/^\\/+/, "")));
            });
            """)
        r.write("Dockerfile", """
            FROM node:20-alpine AS builder
            WORKDIR /build
            COPY federation/ ./federation/
            RUN npm run build

            FROM node:20-alpine
            WORKDIR /app
            COPY server/ ./server/
            COPY index.html ./site/
            COPY --from=builder /build/dist/ ./site/dist/
            ENV PORT=8200 \\
                STATIC_DIR=/app/site \\
                NODE_ENV=production
            CMD ["node", "server/server.js"]
            """)
        return r

    def test_the_fuzemarket_shape_fails_on_L4a(self):
        with self.fuzemarket_shape() as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L4a webserver"}, result.stdout)

    def test_the_fuzemarket_finding_names_the_file_and_BOTH_paths(self):
        with self.fuzemarket_shape() as r:
            result = run_gate(r.root)
        self.assertIn("/app/site/apps/market", result.stdout)
        self.assertIn("/app/site/dist", result.stdout)
        self.assertIn("the Node static mount", result.stdout)

    def test_the_fuzemarket_finding_does_NOT_blame_the_dockerfile_by_default(self):
        """As with the FuzePicker wrong-prefix case. The build lands at a THIRD location
        matching neither the serve path nor the served root, so no flat copy was
        intended and the missing piece is the mount. Both fixes are named; neither is
        prescribed by reflex."""
        with self.fuzemarket_shape() as r:
            result = run_gate(r.root)
        self.assertNotIn("L4b image-layout", layers(result), result.stdout)
        self.assertIn("the missing piece is the MOUNT", result.stdout)
        self.assertIn("both are valid", result.stdout)
        self.assertIn("rather than changing the Dockerfile by reflex", result.stdout)

    def test_a_CORRECT_node_mount_is_clean(self):
        """The FuzeX shape: a literal `*_MOUNT_PREFIX` constant, a root from a Dockerfile
        ENV, and the build copied exactly there. It must come out CLEAN -- a dialect
        reader that only ever finds fault is as useless as one that never does."""
        r = Repo()
        with r:
            self._common(r, "fuzex", "/apps/fuzex/")
            r.write("services/design-frames-service/server.js", """
                const http = require('http');
                const path = require('path');
                const WEBAPP_DIR = process.env.DESIGN_FRAMES_WEBAPP_DIR
                  || path.join(__dirname, 'webapp-dist');
                const WEBAPP_MOUNT_PREFIX = '/apps/fuzex/';
                async function serveWebappAsset(res, relPath) {
                  const resolved = path.normalize(path.join(WEBAPP_DIR, relPath));
                }
                const server = http.createServer((req, res) => {});
                """)
            r.write("services/design-frames-service/Dockerfile", """
                FROM node:24-alpine AS webapp-builder
                WORKDIR /webapp
                COPY webapp/ ./
                RUN npm run build

                FROM node:20-alpine
                WORKDIR /app
                COPY . .
                COPY --from=webapp-builder /webapp/dist ./webapp-dist
                ENV DESIGN_FRAMES_WEBAPP_DIR=/app/webapp-dist
                CMD ["node", "server.js"]
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("all four layers agree", result.stdout)

    def test_a_DYNAMIC_root_is_UNREADABLE_not_a_silent_pass(self):
        """The FuzeMerchandize shape: `app.use(express.static(staticDir))` where
        staticDir is threaded through at runtime and no Dockerfile ENV pins it. "Could
        not check" must never render as "fine"."""
        r = Repo()
        with r:
            self._common(r, "merch", "/apps/merch/")
            r.write("server/app.mjs", """
                import express from 'express'
                export function buildApp(config) {
                  const app = express()
                  const staticDir = config.staticDir
                  app.use('/api', function apiNotFound(req, res) { res.status(404).end() })
                  app.use(express.static(staticDir, { setHeaders(res, p) {} }))
                  return app
                }
                """)
            r.write("Dockerfile", """
                FROM node:24-alpine
                WORKDIR /app
                COPY server ./server
                COPY --from=builder /build/dist ./public
                CMD ["node", "server/index.mjs"]
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L4a webserver", layers(result), result.stdout)
        self.assertIn("UNREADABLE (dynamic serve path in server/app.mjs:", result.stdout)
        self.assertIn("not a skip", result.stdout)

    def test_an_express_app_with_NO_static_mount_still_fails(self):
        """A declared remote served by nothing. Applicability comes from the manifest,
        never from which files happen to exist."""
        r = Repo()
        with r:
            self._common(r, "api", "/apps/api/")
            r.write("server/index.mjs", """
                import express from 'express'
                const app = express()
                app.get('/api/things', (req, res) => res.json([]))
                app.listen(8300)
                """)
            r.write("Dockerfile", """
                FROM node:24-alpine
                WORKDIR /app
                COPY server ./server
                CMD ["node", "server/index.mjs"]
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L4a webserver", layers(result), result.stdout)
        self.assertIn("nothing in this repo serves the declared", result.stdout)

    def test_an_express_app_serving_UNRELATED_static_assets_is_not_flagged(self):
        """The over-firing guard, and the one that matters most.

        Treating ANY `express.static` as the federated mount produces confident,
        specific, WRONG findings -- the same failure class as the FuzePicker
        misdiagnosis. A mount at `/images` cannot serve /apps/widget/ and must be
        ignored, leaving the real nginx mount to answer.
        """
        with good_repo() as r:
            r.write("server/index.mjs", """
                import express from 'express'
                const app = express()
                app.use('/images', express.static('/srv/images'))
                app.use('/downloads', express.static('/srv/downloads'))
                app.listen(3000)
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("all four layers agree", result.stdout)

    def test_an_unrelated_mount_cannot_OUTRANK_the_real_one_in_a_node_only_repo(self):
        """THE REAL over-firing guard, and the previous one was vacuous.

        The first version of this guard used a repo that also had a working nginx.conf,
        so the nginx dialect answered and the Node reader was never consulted -- the
        fixture agreed with the bug by coincidence and a mutation removing the
        plausibility guard escaped it entirely. That is the third time in this session a
        fixture has been unable to disagree with the check it was written for.

        This one is Node-ONLY, and the unrelated `/images` mount has a LONGER prefix than
        the real root mount. Drop the guard and longest-prefix-wins hands `/images` the
        answer, producing a confident, specific, wrong finding pointing at /srv/images.
        """
        r = Repo()
        with r:
            self._common(r, "market", "/apps/market/")
            r.write("server/server.js", """
                const http = require('http');
                const path = require('path');
                const express = require('express');
                const ROOT = process.env.STATIC_DIR
                  ? path.resolve(process.env.STATIC_DIR)
                  : path.resolve(__dirname, "..");
                const app = express();
                app.use('/images', express.static('/srv/images'));
                app.use('/downloads', express.static('/srv/downloads'));
                function serveStatic(res, rel) {
                  let p = path.join(ROOT, path.normalize(rel));
                }
                const server = http.createServer((req, res) => {
                  const url = new URL(req.url, "http://localhost");
                  serveStatic(res, url.pathname.replace(/^\\/+/, ""));
                });
                """)
            r.write("Dockerfile", """
                FROM node:20-alpine
                WORKDIR /app
                COPY server/ ./server/
                COPY --from=builder /build/dist/ ./site/apps/market/
                ENV STATIC_DIR=/app/site
                CMD ["node", "server/server.js"]
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("all four layers agree", result.stdout)
        self.assertNotIn("/srv/images", result.stdout)
        self.assertNotIn("/srv/downloads", result.stdout)

    def test_an_iframe_repo_with_an_express_app_is_still_SKIPPED(self):
        """Applicability is the manifest's business, not the serving code's."""
        with good_repo(itype="iframe") as r:
            r.write("server/index.mjs", """
                import express from 'express'
                const app = express()
                app.use(express.static('/srv/site'))
                app.listen(3000)
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("SKIPPED (integration.type: iframe)", result.stdout)


class TestTheImageComparedisTheServingOne(unittest.TestCase):
    """Layer 4b must read the image that SERVES, and only its final stage.

    Both halves of this were wrong and both produced confident, wrong findings on live
    repos -- the same class as the FuzePicker misdiagnosis:

      wrong image  fuzebi's ROOT Dockerfile is its BACKEND service and legitimately copies
                   /app/dist -> /app/dist. Its frontend/Dockerfile is the nginx image and
                   copies only an index.html. Pairing the first with the second's document
                   root told fuzebi to "mount /apps/fuzebi/ onto /app/dist" -- a path in a
                   different container.
      wrong stage  a builder stage's `COPY . .` puts the build at /app/dist in a layer
                   that is then discarded. Only the final `FROM` block ships.
    """

    def two_image_repo(self):
        r = good_repo()
        # The BACKEND image: a legitimate dist copy that has nothing to do with serving.
        r.write("Dockerfile", """
            FROM node:24-alpine AS builder
            WORKDIR /app
            COPY . .
            RUN npm run build

            FROM node:24-alpine AS runtime
            WORKDIR /app
            COPY --from=builder /app/dist ./dist
            COPY --from=builder /app/package.json ./package.json
            CMD ["node", "dist/server.js"]
            """)
        # The SERVING image: nginx, and it never receives the build.
        r.write("frontend/Dockerfile", """
            FROM node:24-alpine AS build
            WORKDIR /app
            COPY . .
            RUN npm run build:mfe

            FROM nginx:alpine
            COPY frontend/index.html /usr/share/nginx/html/index.html
            COPY nginx.conf /etc/nginx/conf.d/default.conf
            """)
        return r

    def test_a_backend_images_dist_copy_is_not_read_as_the_serving_layout(self):
        with self.two_image_repo() as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L4b image-layout"}, result.stdout)
        self.assertIn("no Dockerfile COPY of the remote's build output", result.stdout)

    def test_it_never_tells_a_repo_to_mount_a_path_from_another_container(self):
        with self.two_image_repo() as r:
            result = run_gate(r.root)
        self.assertNotIn("mount /apps/widget/ onto /app/dist", result.stdout)
        self.assertNotIn("the missing piece is the MOUNT", result.stdout)

    def test_a_builder_stage_copy_does_not_count_as_the_shipped_layout(self):
        """Only the final FROM block becomes the image."""
        with good_repo() as r:
            r.write("frontend/Dockerfile", """
                FROM node:24-alpine AS build
                WORKDIR /app
                COPY . .
                RUN npm run build:mfe
                COPY ./dist-mfe /usr/share/nginx/html/apps/widget

                FROM nginx:alpine
                COPY nginx.conf /etc/nginx/conf.d/default.conf
                """)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L4b image-layout", layers(result), result.stdout)
        self.assertIn("no Dockerfile COPY of the remote's build output", result.stdout)


class TestApplicabilityIsDeclaredNeverInferred(unittest.TestCase):
    """The distinction between this gate and a vacuous one."""

    def test_iframe_is_SKIPPED_not_passed_by_accident(self):
        with good_repo(itype="iframe") as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("SKIPPED (integration.type: iframe)", result.stdout)
        self.assertNotIn("all four layers agree", result.stdout)

    def test_spa_is_SKIPPED_with_its_declared_type_printed(self):
        with good_repo(itype="spa") as r:
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("SKIPPED (integration.type: spa)", result.stdout)

    def test_a_missing_vite_config_is_a_FINDING_not_a_skip(self):
        """The whole point. A declared module-federation remote with no build config is
        broken, not inapplicable."""
        with good_repo() as r:
            r.rm("frontend/vite.config.ts")
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L2 build-base", layers(result))
        self.assertIn("not a reason to pass", result.stdout)

    def test_a_missing_ingress_is_a_FINDING_not_a_skip(self):
        with good_repo() as r:
            r.rm("deploy/helm/widget/templates/ingress.yaml")
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L3 ingress", layers(result))

    def test_a_missing_nginx_config_is_a_FINDING_not_a_skip(self):
        with good_repo() as r:
            r.rm("frontend/nginx.conf")
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L4a webserver", layers(result))

    def test_a_missing_dockerfile_is_a_FINDING_not_a_skip(self):
        with good_repo() as r:
            r.rm("frontend/Dockerfile")
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L4b image-layout", layers(result))

    def test_an_absent_integration_type_is_a_FINDING_not_a_skip(self):
        with good_repo() as r:
            body = json.loads(r.read("registration/manifest.json"))
            del body["integration"]["type"]
            text = json.dumps(body, indent=2) + "\n"
            r.write("registration/manifest.json", text)
            r.write("deploy/helm/widget/files/registration/manifest.json", text)
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("L1 manifest", layers(result))
        self.assertIn("never inferred", result.stdout)

    def test_no_registration_manifest_at_the_root_is_SKIPPED_and_says_why(self):
        """FuzeFront is the HOST: it registers no portal app and has no serve contract.
        Whether a repo SHOULD register is gate-registration's question, not this one's."""
        with good_repo() as r:
            r.rm("registration/manifest.json")
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("no registration/manifest.json at the repo root", result.stdout)

    def test_a_covendored_products_manifest_is_not_mistaken_for_this_repos(self):
        """FuzeFront vendors a whole FuzeQuality/ tree. A shallowest-wins search reads
        that manifest and reports the HOST as a broken remote."""
        with good_repo() as r:
            r.rm("registration/manifest.json")
            r.write("OtherProduct/registration/manifest.json",
                    manifest_json(slug="other", entry="/apps/other/remoteEntry.js"))
            result = run_gate(r.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("no registration/manifest.json at the repo root", result.stdout)


class TestRatchet(unittest.TestCase):
    """The ramp is a worklist, not an exemption -- and never a `|| true`."""

    POLICY = {
        "mode": "ratchet",
        "owner": "@izzywdev",
        "ratchet": {"knownFailing": {"widget": {"layers": ["L4b image-layout"],
                                                "note": "fixture"}}},
    }

    def _policy(self, r, body=None):
        r.write("governance/federation-contract-policy.json",
                json.dumps(body if body is not None else self.POLICY, indent=2))

    def test_a_listed_repo_warns_on_its_listed_layer(self):
        with good_repo() as r:
            self._policy(r)
            r.write("frontend/Dockerfile", DOCKERFILE.format(dest="/usr/share/nginx/html"))
            result = run_gate(r.root, "--repo", "izzywdev/widget")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(warn_layers(result), {"L4b image-layout"}, result.stdout)
        self.assertEqual(layers(result), set(), result.stdout)

    def test_a_listed_repo_still_FAILS_on_an_unlisted_layer(self):
        """Fixing one layer and breaking a different one is caught. This is what makes
        the ramp a ratchet rather than an exemption."""
        with good_repo() as r:
            self._policy(r)
            r.write("deploy/helm/widget/templates/ingress.yaml", INGRESS.format(path="/other"))
            result = run_gate(r.root, "--repo", "izzywdev/widget")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L3 ingress"}, result.stdout)

    def test_an_unlisted_repo_is_enforced_at_full_strength_from_day_one(self):
        with good_repo() as r:
            self._policy(r)
            r.write("frontend/Dockerfile", DOCKERFILE.format(dest="/usr/share/nginx/html"))
            result = run_gate(r.root, "--repo", "izzywdev/brand-new-remote")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(layers(result), {"L4b image-layout"}, result.stdout)

    def test_mode_fail_ignores_the_ratchet_entirely(self):
        with good_repo() as r:
            body = dict(self.POLICY, mode="fail")
            self._policy(r, body)
            r.write("frontend/Dockerfile", DOCKERFILE.format(dest="/usr/share/nginx/html"))
            result = run_gate(r.root, "--repo", "izzywdev/widget")
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_a_missing_policy_file_is_FAIL_CLOSED(self):
        """Deleting the policy must not be a way to silence the gate."""
        with good_repo() as r:
            r.write("frontend/Dockerfile", DOCKERFILE.format(dest="/usr/share/nginx/html"))
            result = run_gate(r.root, "--repo", "izzywdev/widget")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("mode=fail", result.stdout)

    def test_a_stale_ratchet_entry_is_reported_so_the_ramp_cannot_reopen(self):
        with good_repo() as r:
            self._policy(r)
            result = run_gate(r.root, "--repo", "izzywdev/widget")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("::notice", result.stdout)
        self.assertIn("Remove the entry", result.stdout)

    def test_the_shipped_policy_is_valid_and_names_an_owner_and_a_flip_condition(self):
        path = os.path.join(REPO_ROOT, "governance", "federation-contract-policy.json")
        self.assertTrue(os.path.isfile(path), "the canonical policy must exist")
        with open(path, encoding="utf-8") as f:
            policy = json.load(f)
        self.assertIn(policy["mode"], ("ratchet", "fail", "warn"))
        self.assertTrue(policy.get("owner"), "a ramp with no owner is an exemption")
        self.assertTrue(policy.get("flipCondition"))
        for repo, entry in policy["ratchet"]["knownFailing"].items():
            self.assertTrue(entry.get("layers"), f"{repo}: an entry must name its layers")
            self.assertTrue(entry.get("note"), f"{repo}: an entry must say what is wrong")


if __name__ == "__main__":
    unittest.main()
