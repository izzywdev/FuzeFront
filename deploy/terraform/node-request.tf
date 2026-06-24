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

  # The request is declared ONCE in node-requests.json (single source of truth):
  # .github/workflows/infra-dispatch.yml sends that exact JSON as the dispatch
  # payload's `requests` (what FuzeInfra's validator checks against its whitelist),
  # and Terraform reads the SAME file here for the apply — so validation and apply
  # can never drift. product_id MUST be one of FuzeInfra's whitelisted tiers
  # (currently V1/V45/V46/V47) or the request routes to a gated manual-approval PR
  # instead of auto-applying. A single workload worker to offload the heavy
  # stateless services (LiteLLM/chat/billing) off the primary node.
  requests = jsondecode(file("${path.module}/node-requests.json"))

  # Injected by FuzeInfra's handler (NOT defined/committed here):
  #   oauth2_client_id / oauth2_client_secret / oauth2_user / oauth2_pass  (Contabo)
  #   k3s_server_url / k3s_node_token                                      (existing cluster)
  #   backend config                                                       (TF state in FuzeInfra)
}
