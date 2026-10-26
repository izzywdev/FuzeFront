# App-builder secrets (build-with-agent)

applications-service reads `FUZEAGENT_BUILD_API_TOKEN` (bearer for FuzeAgent's
build endpoint) from a Secret. The chart wires it as an `optional: true`
`secretKeyRef`, so nothing breaks while it is absent: POST builds answers
`503 builder_unavailable`.

The token is deliberately NOT sealed in git yet: it needs FuzeAgent's real token
and the cluster's public cert, and `gate-sealed-keys` only fails when a sealed key
is *removed*, so adding the key later is allowed.

## Enabling (human, once FuzeAgent exposes the build endpoint)

1. Seal the key into `deploy/contabo/sealed/fuzefront-secrets.yaml` (prompts for
   the value; plaintext never touches git):

   ```bash
   deploy/scripts/seal-secret.sh FUZEAGENT_BUILD_API_TOKEN \
     --scope fuzefront/fuzefront-secrets \
     --in ~/.fuzefront-secrets/fuzeagent-build-api-token.txt
   ```

   (`--scope <namespace>/<secret-name>` overrides the script's hard-coded
   default scope; `fuzefront/fuzefront-secrets` is shown for clarity. See the
   script header for usage.)
2. In `deploy/helm/fuzefront/values-prod.yaml` under `applicationsService.appBuilder` set:
   - `buildApiUrl`: FuzeAgent's in-cluster build URL
   - `tokenSecretName: fuzefront-secrets` (key defaults to `FUZEAGENT_BUILD_API_TOKEN`)
3. Commit and merge; Argo syncs. Optional rate-limit overrides:
   `readRateLimit` / `writeRateLimit` / `callbackRateLimit`.
