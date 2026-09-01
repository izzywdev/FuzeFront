---
name: local-environment
description: Use when building or verifying a repo's bounded local deployment. How to vendor FuzeInfra, stand the service up against the consumer-test compose (CI/quick) and kind+Helm (full parity), wire the external-service mock matrix, and enforce the no-prod-egress boundary. Enforced by gate-localup; owned by local-env-verifier (devops-engineer builds it).
---

# local-environment

Per `governance/local-environment.md`. Grounded in FuzeInfra's `docker-compose.consumer-test.yml` + `versions.env` + `make kind-up`.

## Set up the bounded local-up
1. **Vendor FuzeInfra** as a git submodule (gives consumer-test compose, `versions.env`, the Helm chart — version-accurate).
2. **CI/quick tier (gate-localup):**
   ```
   docker compose --env-file FuzeInfra/versions.env -f FuzeInfra/docker-compose.consumer-test.yml up -d --wait
   # start your service pointed at localhost deps + the mocks below; run a health/smoke
   docker compose -f FuzeInfra/docker-compose.consumer-test.yml down -v
   ```
3. **Full-parity tier:** `cd FuzeInfra && make kind-up` (kind + ingress-nginx + cert-manager local CA + Helm `values-local`, `*.dev.local`), then deploy your chart/`values-local.yaml` (skaffold) into the kind `fuzeinfra` cluster.

## Mock matrix (never call the real external locally)
email→MailHog · SMS/voice→Twilio mock (`TWILIO_MOCK=true`) · authz→Permit PDP offline · payments→Stripe test mode · another Fuze service→Prism/MSW from its OpenAPI contract · AWS→LocalStack.

## Boundary check (what gate-localup asserts)
- The bounded stack stands up + a health/smoke passes.
- **No egress to real/prod endpoints** — run on an egress-deny network and/or assert the mocks were hit; fail if a real external host is contacted.
- `helm lint` + `helm template | kubeconform -strict -ignore-missing-schemas` for the chart.

## Provide
A Helm chart + `values-local.yaml` (+ skaffold; Argo app for prod), the consumer-test wiring, and a documented one-command up per tier. A PR that breaks the local-up or adds a real external call fails the gate.
