# =============================================================================
# FuzeFront infra REQUEST — declarative "please give me a node" (GitOps IaC).
#
# FuzeFront does NOT provision anything and holds NO Contabo/cluster credentials.
# It only DECLARES what it needs. On change to deploy/terraform/** (or
# deploy/argocd/**), .github/workflows/infra-dispatch.yml fires a
# repository_dispatch to FuzeInfra; FuzeInfra's handler (the sole credential
# holder) runs `terraform apply` against the module below, joins+labels the node
# into the existing k3s cluster, and syncs the Argo apps.
#
# The module lives in FuzeInfra (the cluster owner). The Contabo provider creds,
# the k3s server URL + join token, and the TF state backend are all injected by
# FuzeInfra's handler at apply time — never committed here.
#
# Allowed request shapes are whitelisted by FuzeInfra's handler (auto-applied);
# anything outside the whitelist requires manual approval. See README.md.
# =============================================================================

module "fuzefront_nodes" {
  # FuzeInfra owns the contabo-k3s-node module (provider + cloud-init k3s agent
  # join + node labeling). Pinned by ref; FuzeInfra publishes/updates it.
  source = "git::https://github.com/izzywdev/FuzeInfra.git//modules/contabo-k3s-node?ref=main"

  # The whitelisted request: a single workload worker node to offload the
  # heavy stateless services (LiteLLM / chat / billing) off the primary node.
  # Stateful pods stay on node-1 (local-path); see deploy/helm/fuzefront node
  # affinity (added in the prod-CD chart).
  #
  # Re-applied 2026-06-24: ensure fuzefront-worker-2 is provisioned + joined to
  # the k3s cluster so Argo can schedule the FuzeFront workloads on it.
  requests = [
    {
      name       = "fuzefront-worker-2"
      product_id = "V92"        # ~8 vCPU / 30 GB (whitelisted tier); adjust within the allow-list
      region     = "EU"         # must match the existing FuzeInfra cluster region
      role       = "workload"   # → node label node-role=workload (FuzeFront affinity targets this)
      labels = {
        "node-role"            = "workload"
        "app.fuzefront.com/by" = "fuzefront"
      }
    }
  ]

  # Injected by FuzeInfra's handler (NOT defined/committed here):
  #   oauth2_client_id / oauth2_client_secret / oauth2_user / oauth2_pass  (Contabo)
  #   k3s_server_url / k3s_node_token                                      (existing cluster)
  #   backend config                                                       (TF state in FuzeInfra)
}
