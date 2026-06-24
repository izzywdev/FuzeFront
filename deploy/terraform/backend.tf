# Remote state — NEVER local. FuzeInfra moved its TF state to an S3 bucket, and
# every joining repo's infra state must be persisted there too (one state object
# per requesting repo). This partial backend block is REQUIRED: without it,
# `terraform init` silently falls back to local (ephemeral CI runner) state, so the
# node's state is lost after each run and every re-run re-attempts creation.
#
# The concrete config (bucket / key / region) is injected at apply time by
# FuzeInfra's infra-request-handler, which runs:
#   terraform init \
#     -backend-config="bucket=$TF_STATE_BUCKET" \
#     -backend-config="key=infra-requests/<owner>-<repo>.tfstate" \
#     -backend-config="region=$TF_STATE_REGION"
# (creds via TF_STATE_* secrets). FuzeFront holds NO state-backend creds — it only
# declares that state lives in S3; FuzeInfra (the owner) supplies the where/how.
#
# Local `terraform validate`/`plan` still works with `terraform init -backend=false`.
terraform {
  backend "s3" {}
}
