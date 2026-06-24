# `deploy/terraform/` — declarative node/infra requests (consumer side)

FuzeFront holds **no Contabo/cluster credentials**. It only *declares* the infra it
needs; **FuzeInfra** (the cluster owner + sole credential holder) applies it. This is
the **Terraform plane** of the two-plane GitOps model (the Argo plane is pull-based;
see `deploy/argocd/`).

## Flow (how a node actually gets provisioned)

```
edit deploy/terraform/node-requests.json   (declare the node)
        │  push to master (touches deploy/terraform/**)
        ▼
.github/workflows/infra-dispatch.yml        (FuzeFront — holds FUZEINFRA_DISPATCH_TOKEN only)
        │  fires repository_dispatch (type=infra-request) with client_payload.requests INLINE
        ▼
FuzeInfra infra-request-handler.yml          (FuzeInfra — holds ALL creds + state)
        │  1. validate requests vs config/infra-request-whitelist.json -> skip | apply | gate
        │  2. terraform init  (S3 remote backend, key=infra-requests/<repo>.tfstate)
        │  3. terraform apply (Contabo provider) -> create instance + cloud-init k3s join
        │  4. label the joined node
        ▼
node joins the k3s cluster, labeled node-role=workload -> Argo schedules workloads on it
```

## The contract (get these right or it no-ops / fails)

| File | Purpose | Gotcha |
|---|---|---|
| `node-requests.json` | **Single source of truth**: a list of `{name, product_id, region, role, labels}`. Read by BOTH `infra-dispatch.yml` (sent as `client_payload.requests` — what FuzeInfra validates) AND `node-request.tf` (the apply). | `product_id` **MUST be in FuzeInfra's whitelist** (`allowed_product_ids`) or the request **gates** (manual PR). Whitelisted ≠ available — Contabo can still reject `Product <X> is not available` (account/region stock); confirm with `cntb get products`. |
| `node-request.tf` | Calls FuzeInfra's `contabo-k3s-node` module with `requests = jsondecode(file("node-requests.json"))` **and passes the module's required args** (below). | The module REQUIRES 8 args; declaring only `source`+`requests` fails `Missing required argument`. |
| `variables.tf` | Declares the module's required inputs — values **injected at apply by the handler's tfvars from FuzeInfra secrets**, never committed: `contabo_client_id/secret/api_user/api_password`, `k3s_server_url`, `k3s_node_token`, `image_id`, `ssh_public_key`. Empty defaults so local `validate` works. | Names MUST match what the handler's tfvars writes. |
| `backend.tf` | `terraform { backend "s3" {} }` — **state is remote (S3), never local.** The handler injects `bucket/key/region` via `-backend-config`. | Without it, `init` silently uses **local ephemeral CI state** → node state lost, every re-run re-creates from scratch. |

## Why each was needed (failure modes seen 2026-06-24/25)
1. Dispatch sent only `{repo,ref,changed}` → validator *"no infra requests → skip"* (no-op). Fix: send `requests` inline.
2. `product_id` not whitelisted → `gate`. Fix: whitelisted tier (or file a FuzeInfra issue to whitelist it).
3. Module called without its required args → `Missing required argument` ×8. Fix: `variables.tf` + pass-through.
4. No `backend.tf` → local ephemeral state. Fix: S3 partial backend.
5. Whitelisted product still `not available` (Contabo stock). Fix: `cntb`-confirm + whitelist an available strong tier (V92 ≈ 8vCPU/30GB, V76).

## Whitelist vs availability (two separate gates)
- **Whitelist** (`config/infra-request-whitelist.json` in FuzeInfra): `allowed_product_ids`, `allowed_regions`, `allowed_roles`, `max_nodes_per_request`, `allowed_repos`. A miss → gated PR, not auto-apply. (As of 2026-06-25 the listed tiers V1/V45/V46/V47 are all *unavailable* — see FuzeInfra#65 to add V92/V76.)
- **Availability**: Contabo must actually be able to order that `product_id` in that region for this account — check with `cntb get products` (only FuzeInfra holds the creds).

## Editing checklist
- `product_id`: BOTH whitelisted in FuzeInfra AND `cntb`-confirmed available in the region.
- `region`: matches the existing FuzeInfra cluster region (currently `EU`).
- `role`: drives the `node-role=workload` label FuzeFront affinity targets.
- Local sanity: `terraform init -backend=false && terraform validate`.
- Never commit Contabo/k3s/SSH secret values — the handler injects them.
