---
name: shared-datastore-provisioning
description: Use whenever a Fuze service needs a production database, missing database credentials, or a sealed credential handoff. Discovers FuzeInfra's Postgres/Mongo provisioning and sealing workflows, selects the engine from the service contract, preserves the two-namespace password invariant, drives the reviewed GitOps change and credential handoff, and verifies the running service. Missing local kubeconfig or secret-admin access is a delegation step, not a reason to ask the user to provision it manually.
---

# Shared datastore provisioning

FuzeInfra owns the shared database engines and provisioning. A consumer owns its
schema, migrations, connection configuration, and deployment. When hosting exposes
a missing role, database, or credential, include provisioning in the implementation
and drive it through FuzeInfra's existing workflows. Do not finish with an infra
handoff document when the authorized workflows can complete that handoff.

## 1. Discover the current contract before declaring a blocker

Consult `fuzeinfra-expert` and read the current default branch of
[`izzywdev/FuzeInfra`](https://github.com/izzywdev/FuzeInfra):

- `docs/consuming-repos/POSTGRES_PROVISIONING.md` and
  `docs/consuming-repos/MONGODB_PROVISIONING.md` for connection details.
- `helm/fuzeinfra/templates/service-db-provisioning.yaml` and
  `service-mongo-provisioning.yaml`, plus `values-contabo.yaml`, for the actual
  provisioning contract. Postgres uses `serviceDatabases`; MongoDB uses
  `serviceMongoDatabases`. Both have idempotent PostSync Jobs.
- `governance/datastore-allocations.md`, `governance/credential-handoff.json`,
  and `docs/CREDENTIAL_HANDOFF.md` for existing allocations and authorized
  source-to-consumer mappings.
- `.github/workflows/`, `docs/SECRETS_MANAGEMENT.md`,
  `docs/SECURE_AGENT_SECRET_HANDOVER.md`, and the capability registry for
  provisioning, sealing, handoff, and verification operations.

Read each selected workflow's inputs, permissions, guards, and output contract
before dispatch. Discover product-specific or newly added workflows too; these
examples are not a complete catalog. Where older prose describes imperative
`psql` or Mongo init scripts, follow the current declarative templates and reviewed
workflow. A local credential failure does not establish that FuzeInfra's runner
lacks the capability.

## 2. Choose the engine from the data requirements

Use the engine already required by the service's frozen contract and migrations.
For a new model, use Postgres for relational entities, constraints, transactions,
approval state, and revision metadata; JSONB can hold flexible frame/flow documents
without a second engine. Choose MongoDB when access patterns require document
aggregates and the implementation already uses MongoDB. Record the choice in the
service plan. Provision both only for distinct justified workloads. Never add a
private database server to a consumer chart because its shared allocation is missing.

## 3. Preserve the two-namespace credential invariant

Generate one credential inside the owning workflow and seal that same credential
for both consumers:

1. The provisioning Job's input in namespace `fuzeinfra`, normally
   `<service>-db-credentials` with key `password`.
2. The app's runtime Secret in its own namespace, with exactly the keys its chart
   references (`DATABASE_URL` and/or `DB_*` for Postgres; configured MongoDB
   URI/password keys and the correct `authSource` for MongoDB).

Strict-scope SealedSecret ciphertext is bound to namespace **and** Secret name;
copying ciphertext to another namespace does not re-seal it. Seal twice from one
source, or use the authorized publisher to derive the consumer URI from that
source. Independently generated passwords will not authenticate.

The FuzeInfra password SealedSecret and the allocation's `enabled: true` change
must land in the **same FuzeInfra PR**. Postgres mounts every enabled password
non-optionally: one absent Secret can block every service's provisioning. Apply
the same prerequisite to MongoDB entries with `managePassword: true` (the
default); `managePassword: false` is for an existing user and cannot create a new
one. Preserve existing entries when editing Helm lists: an overlay replaces a list
instead of merging it.

Put app ciphertext in a source Argo actually renders (e.g. a chart template when
the Application renders only that chart), and match the consumer's actual default
branch. A sealed file outside the Application's sources never reaches the cluster.
Establish the reviewed app manifest before using a publisher that requires it to
exist. Add allocations and handoff mappings under FuzeInfra review; source-to-target
mappings are grants, not arbitrary caller inputs.

## 4. Execute the workflow, PR, and GitOps path

Delegate FuzeInfra-owned changes to its authorized agent or `@fuze` handler with
app, engine, namespace, manifest path, required key **names**, and acceptance
checks. Existing authorization to provision/deploy remains valid; do not ask again
for routine choices or work already authorized. Follow `capability-delegation` when
your environment cannot perform the operation. An agent working in the owner repo
can prepare the reviewed owner PR.

Known operations to inspect and reuse:

- Named `repository_dispatch` operations: FuzeInfra may expose a generic,
  schema-validated operation such as `provision-service-postgres`. The consumer
  supplies a bounded runtime declaration; FuzeInfra verifies it against the
  already-declared disabled allocation and credential-handoff registry, then
  opens a reviewed GitOps PR. FuzeInfra workflow code must not name or branch
  on a particular consuming product. A consumer may invoke the named event with
  a short-lived `fuze-agent` App installation token, minted in GitHub Actions
  from the fleet-propagated `FUZE_AGENT_APP_ID` and
  `FUZE_AGENT_APP_PRIVATE_KEY` secrets and restricted to FuzeInfra with
  `Contents: write`. Do not add or reuse a long-lived
  `FUZEINFRA_DISPATCH_TOKEN`; it is the legacy manual-onboarding transport.
  Do not create a generic
  "dispatch any workflow" relay: it turns a Contents-scoped repository-dispatch
  credential into unconstrained Actions execution. `infra-dispatch.yml` remains
  the family-wide Terraform `infra-request` transport, not a general workflow
  dispatcher.
- `secret-provision.yml`: generates or verifies Actions secrets in allowlisted
  targets. It does not provision a database or deliver a cluster Secret. Cross-repo
  `copy` is deliberately forbidden.
- `rotate-sealed-secret.yml`: generates and seals a value, then opens a GitOps PR.
  Leave its explicit `value` input blank; never put secrets in dispatch inputs.
  Do not use independent rotations to establish a matched database credential.
- `publish-sealed-handoff.yml`: publishes strict-scoped ciphertext through an
  enabled, reviewed `governance/credential-handoff.json` entry, returning a consumer
  PR and preserving other encrypted keys. Use its registered `id`; do not query a
  Secret value to reconstruct the URI yourself.
- `scripts/seal-secret.sh`: the owner workflow seals against the published public
  certificate with secret input in protected temporary storage. Inspect wrappers:
  older `seed-service-db.sh` versions print the password and must not be used as an
  automated handoff channel.

If an operation or consumer grant is absent, have the owner implement the guarded
workflow or reviewed registry entry as part of the task. Use existing secure
handover channels when cross-repo secret writes are unavailable. Do not transfer
plaintext, widen permissions without review, or bypass protected-branch checks.
Drive owner/consumer PRs through required checks and the authorized merge path,
then wait for Argo. Schema migrations remain app-owned and run through the
committed migration Job, not an ad-hoc production command.

## 5. Verify the running allocation and service

Read cluster state through FuzeInfra's `cluster-query.yml` (permitted read verbs
only); no local kubeconfig is required. Inspect the provisioning Job, sealed
controller status, app pods, PVC if used, and Argo Application. Verify Argo's
observed revision equals the merged revision and reports `Synced`/`Healthy`.
Hook Jobs can be deleted after success: use Argo's operation result or owner
verification output when the Job is absent.

Require positive authentication to the allocated database, successful committed
migrations, and an app readiness/API check through the owner verification workflow
or running service. Rendered Helm, successful dispatch, presence-only secret checks,
and healthy engine pods do not prove the app connects. Use narrow queries and
known-redacted logs. `cluster-query` refuses plain Secret reads; credential handoff
belongs to the sealing publisher.

Report owner/consumer PR URLs, workflow run URLs, observed Argo revision, and app
connection/readiness results. Read a failed run and pursue the next authorized
route before reporting a blocker. Escalate only a concrete unmet grant, credential,
or required approval after routes are exhausted; never ask a human to relay
commands or passwords.

## Secret handling

Secret values never appear in git, issue/PR bodies, chat, logs, dispatch inputs,
command arguments, artifacts, or returned agent results. Disable tracing, mask
runner-generated values before downstream use, and restrict temporary plaintext
to the owning workflow's protected storage with cleanup. Return names, ciphertext,
and verification results only. Preserve other encrypted keys on reseal and configure
the app's reload trigger so a changed Secret is consumed on rollout.
