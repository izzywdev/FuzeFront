# Provider + cluster-join inputs required by the contabo-k3s-node module.
# These are NEVER committed with real values — FuzeInfra's handler injects them at
# apply time ("Generate handler tfvars" writes them as *.auto.tfvars from its
# secrets: CONTABO_*, K3S_SERVER_URL, K3S_NODE_TOKEN, CONTABO_IMAGE_ID,
# NODE_SSH_PUBLIC_KEY). Empty defaults let `terraform validate`/`plan` run locally
# without secrets; the handler always supplies real values for the actual apply.

variable "contabo_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "contabo_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "contabo_api_user" {
  type      = string
  sensitive = true
  default   = ""
}

variable "contabo_api_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "k3s_server_url" {
  type    = string
  default = ""
}

variable "k3s_node_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "image_id" {
  type    = string
  default = ""
}

variable "ssh_public_key" {
  type    = string
  default = ""
}
