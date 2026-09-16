# ADR-001: FuzeFront-owned authentication and authorization

**Status:** Accepted target architecture; production service-principal cutover is pending FQ-68 / FuzeInfra #988.

## Decision

FuzeQuality is a FuzeFront consumer product. It delegates human identity,
organization context, machine-principal authentication, and authorization
decisions to FuzeFront's existing security microservices. It does not run a
separate identity provider, create local product roles, or issue its own bearer
tokens.

The authoritative access boundary is the FuzeQuality API. The portal UI may hide
an action for usability, but it is never an authorization decision.

## Human request flow

```text
Portal session bearer
        |
        v
FuzeQuality API -- session lookup --> FuzeFront Security
        |                                  |
        |<-- user ID, active tenant, roles -+
        |
        +-- authorization check (tenant, quality_<resource>, action) --> FuzeFront Security / Permit
        |                                                                  |
        +<------------------------------ allow or deny ------------------+
        |
        v
Tenant-scoped FuzeQuality query or command
```

The API ignores caller-provided tenant identifiers when authorizing. The tenant
used in persistence and policy checks is the one returned by FuzeFront's session
endpoint. Missing or invalid sessions receive `401`; unresolved tenant, denied
permission, or unavailable policy decisions receive a fail-closed `403`.
Transport or security-service failures return a redacted `503` only when no
decision could be attempted.

## Product policy contract

`FuzeQuality/registration/policy.json` is the source declaration. FuzeFront
namespaces every bare resource as `quality_<BareResource>` before synchronizing
the product policy to Permit. API code must use the constants in
`apps/api/src/platform-permissions.ts`; it must not assemble ad-hoc
`fuzequality.*` names.

| API concern | Product resource | Representative actions |
| --- | --- | --- |
| Repository catalog and scans | `quality_Repository` | `read`, `onboard`, `scan` |
| Evidence and requirements | `quality_Evidence` | `read`, `export` |
| Review proposals | `quality_Suggestion` | `read`, `review`, `suppress` |
| Requested test implementation | `quality_TestImplementation` | `create`, `read` |
| Tenant membership | `quality_OrganizationAccess` | `read`, `manage` |
| Repository configuration | `quality_RepositoryAdministration` | `manage` |
| Cross-tenant platform administration | `quality_PlatformAdministration` | `read` |

Platform-administration checks require both an allowed product-policy decision
and the platform `admin` role returned by FuzeFront. Tenant owner/admin roles
are not a substitute for platform administration.

## Machine principals

Workers, the reconciler, and CI must use FuzeFront-issued, revocable
`ff_live_` service tokens with the narrowest required product scopes. The token
is delivered as a sealed, Argo-managed secret and is verified using FuzeFront's
shared service-authentication contract. Webhook signatures establish event
provenance only; they never authorize a user command.

The scaffold-era `FUZEQUALITY_API_TOKEN` guard is not an acceptable production
boundary. It remains an explicit migration gap until the scoped service identity
is provisioned. Do not remove that guard or enable the registration Job until
the FuzeInfra hand-off has delivered the replacement secret and the live secret
has been verified by name and key only, without exposing its value.

## Registration and deployment operations

The FuzeQuality registration Job is idempotent and runs after Helm
install/upgrade. Before enabling it, operators must verify all of the following
through GitOps and Argo health:

1. A sealed `fuzequality/fuzefront-registration` Secret with a `token` key was
   delivered by the FuzeInfra credential-handoff workflow.
2. The `fuzequality-registration` ConfigMap contains the reviewed federated
   manifest and policy, and `fuzefront-onboarding-kit` contains the matching
   `register.sh`.
3. The manifest declares the same-origin remote
   `/apps/fuzequality/assets/remoteEntry.js`, scope `fuzequality`, module
   `./App`, and route `/app/fuzequality`.
4. The registration Job completes and its logs report registration, activation,
   and policy submission without printing a bearer token.
5. An authenticated portal session loads the remote and receives tenant-scoped
   data; a session without the required action is denied by the API.

If registration fails, leave serving workloads intact, inspect the Job's
redacted logs and the Argo application health, then correct the GitOps input.
Do not create a plaintext Secret or patch chart-managed resources imperatively.

## Audit and incident handling

FuzeQuality audit records must include correlation ID, principal type, resolved
tenant, product resource/action, decision, source revision, and policy version.
They must never include an authorization header, cookie, raw token, or Jira/GitHub
secret.

For an authorization incident, capture the correlation ID, API response code,
FuzeFront Security availability, and the policy version. Escalate policy or
identity failures to the FuzeFront security-service owner; escalate secret
delivery or Argo reconciliation failures to FuzeInfra. Preserve the last known
catalog snapshot rather than widening access or treating an unavailable PDP as
an allow decision.

## Consequences

- FuzeQuality gains consistent session revocation, tenant isolation, and
  auditable authorization without duplicating identity infrastructure.
- A FuzeFront security outage can restrict privileged product actions. This is
  intentional fail-closed behavior.
- Product policy and service-identity rollout are cross-repository changes and
  require both FuzeFront and FuzeInfra GitOps evidence before production
  acceptance.
