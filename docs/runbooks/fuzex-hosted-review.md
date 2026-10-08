# Hosted FuzeX reviews and the frames-first gate

FuzeX stores immutable imported frame revisions and decisions bound to their
hosted content stamp. FuzeFront retains the source frames and declared
implementation coverage during migration. Approving an imported revision in
FuzeX can satisfy `scripts/check-frames-first.mjs` without editing Git approval
flags or opening a GitHub design-approval issue.

## Import and migrate a feature

1. Import the original `design/frames/<feature>` directory using FuzeX's
   `design-frames-client.mjs sync` or `sync-all`, specifying
   `izzywdev/FuzeFront` as the source repository. The client computes
   `manifest.sourceStamp` using the same original-file hashing algorithm as
   `scripts/stamp-frames.mjs`. This is distinct from the hosted content stamp:
   import embeds CSS and records provenance, so the hosted bytes differ.
2. Review and approve the desired flow at that hosted revision. Approvals are
   per flow and carry `contentStamp`; an old approval cannot approve new bytes.
3. Change `.fuze/fuzex-review.json` to `mode: "hosted"` and add a mapping under
   `features` from the repository feature directory to its hosted slug. For
   example, `"features": { "mfa-management": "mfa-management" }`. Keep
   `sourceRepo: "izzywdev/FuzeFront"`. `baseUrl` must be the HTTPS public FuzeX
   service prefix (currently planned as `https://app.fuzefront.com/apps/fuzex`).
4. Run `node scripts/check-frames-first.mjs --files <covered-ui-path>` and land
   the mapping through the normal PR gate. Migrate additional features as their
   imports and reviews become available.

The committed default remains `mode: "legacy"` until the service is provisioned.
An unmapped feature continues using Git manifest decisions. For a mapped feature,
CI recomputes the local source stamp, verifies the immutable revision's repository
and source stamp, reads the latest flow decision, requires its stamp to match the
hosted current revision, and checks that the current stamp did not change during
the request. Missing import, stale source, null/stale decision stamps, rejection,
bad responses and service outages block the gate. There is no outage fallback to
a Git `approved: true` flag. Legacy feature-level manifests need explicit flow
IDs before migration. The coverage audit remains offline.

Reads are public in the existing FuzeX contract, so this gate needs no browser or
machine credential and works for fork PRs. It follows no redirects. If private
review reads are introduced, that requires an explicit CI authentication design;
do not expose a write-capable token to PR code.

## Browser-to-service contract

The host backend now mounts a default-off JSON proxy at `/api/v1/fuzex`.
The FuzeX client preserves its `/api/v1/...` resource paths when using this base:

| Consumer | Base | Example request |
| --- | --- | --- |
| Portal browser with delegated user writes | `/api/v1/fuzex` | `/api/v1/fuzex/api/v1/features/demo` |
| Direct hosted MFE/CLI API route | `/apps/fuzex` | `/apps/fuzex/api/v1/features/demo` |

These are separate routes. The direct service route retains its own machine-token
contract for automation; a browser session must use the host proxy for delegation.
The proxy accepts only the `features`, `projects` and `discussions` JSON resources,
not rendered frame HTML, arbitrary upstream URLs or internal control routes.

- Public GET/HEAD requests carry no credentials upstream.
- When a browser sends `Authorization: Bearer <user-session-token>`, the host
  calls Security's `/api/v1/security/tokens/exchange` using its workload identity,
  the session as `subjectToken`, audience `service:fuzex`, and scope
  `fuzex:frames:read` for GET/HEAD or `fuzex:frames:write` for mutations.
- Security verifies the session and active organization membership. The backend
  selects the resource organization from `FUZX_AUTHZ_TENANT`; browser headers
  cannot choose the tenant or impersonate the actor.
- The upstream receives only `Authorization: Bearer <workload-token>` and
  `X-Fuze-Delegation: Bearer <exchanged-token>`. No machine credential is returned
  to the browser. FuzeX must verify token kinds, the delegation audience and
  scopes, tenant, and `delegated.actor.sub === workload.subject`, and derive the
  review actor from `delegated.subject`.
- Missing browser credentials on writes return 401. Failed exchanges do not
  fall back to machine-only writes. Redirects fail, and only JSON is relayed.

The session must be accepted by the Security identity-provider contract. The proxy
does not mint a substitute session from a local user ID, a pasted machine token,
or browser-supplied identity claims. Local-only legacy JWT sessions that Security
cannot introspect must sign in through the supported platform session flow.

## Activation prerequisites

Provision these through the owning deployment/security configuration; no secrets
belong in this repository:

- `FUZX_API_URL`: FuzeX Postgres API **origin**, e.g.
  `http://fuzex-postgres-tier.fuzex.svc.cluster.local:4410`. No path suffix.
- `FUZX_AUTHZ_TENANT`: canonical organization holding the shared review workspace.
- `FUZEFRONT_SECURITY_URL`: the Security origin. Existing default is
  `http://fuzefront-security:3002`.
- The host's projected workload token at
  `/var/run/secrets/tokens/fuzefront-security`, with Security workload grants for
  `fuzex:frames:read` and `fuzex:frames:write`. Existing connector workload setup is
  reused; do not create a reusable browser service credential.
- Unleash release flag `fuzefront.fuzex.hosted-review`, default OFF. Owner:
  FuzeFront backend / FUZX integration. Enable after service routing, delegation
  validation and workspace membership are verified. Remove the flag when the
  hosted migration is complete. Missing flag service keeps this route OFF.
- Network reachability from the host backend to Security and the FuzeX API.

The proxy JSON input limit is 20 MB, scoped to this route; the upstream's own
limits still apply. Its deadline is 15 seconds. It forwards no cookies or
caller-supplied delegation headers and returns `Cache-Control: no-store`.

## Verification

`node --test scripts/__tests__/check-frames-first.test.mjs` exercises legacy
coverage, hosted source/stamp mismatch, rejection, outage, concurrent import,
public/delegated reads, write authentication, path escapes, missing configuration,
default-off rollout, exchange rejection, and unsafe upstream content. This is the
existing gate workflow's test entrypoint. No governed workflow is edited locally.

Live acceptance after deployment: import one source revision, approve a flow,
verify the gate passes with a false local approval flag, reject it and verify
the gate blocks, then change a source byte and verify the stale import blocks.
Authenticate in the portal, create an annotation, and confirm FuzeX records the
verified user subject rather than an actor string supplied by the browser.
