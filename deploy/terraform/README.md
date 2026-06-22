# FuzeFront infra requests (declare here → FuzeInfra reconciles)

FuzeFront is **GitOps-only** and holds **no Contabo or cluster credentials**. To get
infrastructure (e.g. a worker node), we *declare* a request here; **FuzeInfra** (the
cluster owner + sole credential holder) applies it. This keeps the repos decoupled and
scales as more services are added.

## How it works
1. Edit a request under `deploy/terraform/**` (or an Argo app under `deploy/argocd/**`) and merge to `master`.
2. `.github/workflows/infra-dispatch.yml` detects the change and fires a `repository_dispatch`
   (`event_type: infra-request`) to `izzywdev/FuzeInfra`, using the scoped `FUZEINFRA_DISPATCH_TOKEN`
   secret (its only power is to trigger that dispatch — no cloud/cluster access).
3. FuzeInfra's `repository_dispatch: infra-request` handler (holds the Contabo creds, the k3s
   server URL + join token, and the TF state backend) checks the request against its **whitelist**:
   - **whitelisted** (allowed `product_id` / `region` / `role`) → **auto-applies** (`terraform apply`),
     provisions the Contabo node, cloud-init `k3s agent`-joins + labels it, syncs the Argo apps;
   - **non-whitelisted** → opens a gated PR with `terraform plan` for human approval.

## What FuzeFront declares vs what FuzeInfra injects
| Declared here (FuzeFront) | Injected by FuzeInfra at apply (never here) |
|---|---|
| node `name`, `product_id`, `region`, `role`, `labels` | Contabo OAuth2 creds |
| which Argo Applications exist (`deploy/argocd/`) | k3s server URL + node join token |
| | TF state backend |

The `contabo-k3s-node` module is owned/published by **FuzeInfra** (`modules/contabo-k3s-node`).

## Whitelist (auto-apply allow-list — enforced by FuzeInfra)
Requests matching ALL of these auto-apply; anything else needs approval:
- `product_id` ∈ FuzeInfra's approved tiers (e.g. the ~8vCPU/30GB workload tier)
- `region` == the existing cluster's region (`EU`)
- `role` ∈ {`workload`} (stateful roles are not auto-grantable — they need a storage story)
- node count delta within a bounded cap per request

## Adding capacity
Edit `node-request.tf` (add/adjust an entry within the whitelist) → merge → the node appears and is
labeled so FuzeFront's `nodeSelector`/affinity (in the Helm chart) schedules the heavy stateless
services (LiteLLM/chat/billing) onto it; stateful pods stay on node-1 (`local-path`).
