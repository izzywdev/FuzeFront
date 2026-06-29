# deploy/ci — staged CI workflows

GitHub only executes workflows under `.github/workflows/`. Files here are **staged**
workflow definitions that an automated agent authored but could not place under
`.github/workflows/` directly (GitHub App tokens cannot write workflow files).

## `rotate-sealed-secret.yml`

Family-standard hands-off SealedSecret rotation (mirrors the FuzeInfra template,
izzywdev/FuzeInfra#111), pointed at this repo's `deploy/scripts/seal-secret.sh` and
the `deploy/contabo/sealed/<name>.yaml` manifests. Default scope:
`fuzefront/fuzefront-secrets`.

**To install (one-time, by a maintainer):**

```bash
git mv deploy/ci/rotate-sealed-secret.yml .github/workflows/rotate-sealed-secret.yml
git commit -m "ci: install rotate-sealed-secret workflow"
# open a PR; squash-merge (signed by GitHub) satisfies master's required_signatures
```

**Then rotate** (Actions → "Rotate sealed secret" → Run workflow):

- `key`: `AUTHENTIK_BOOTSTRAP_TOKEN`
- `scope`: `fuzefront/fuzefront-secrets`
- `value_mode`: `generate`

On merge: the `fuzefront-sealed` Argo app (selfHeal) syncs the SealedSecret →
the in-cluster sealed-secrets controller decrypts it → **stakater/Reloader** rolls
`authentik-server` + `authentik-worker` (annotation in
`deploy/helm/fuzefront/templates/authentik.yaml`, toggle `authentik.reloader.enabled`).
No manual `seal-secret.sh`, no manual restart.

If Reloader is not installed cluster-side, set the `reload_argocd_app` input as a
fallback (requires `ARGOCD_SERVER` + `ARGOCD_AUTH_TOKEN` repo secrets; otherwise a
no-op note), or restart the deployments out-of-band.
