#!/usr/bin/env bash
# authentik-path-policy.sh — THE single source of truth for which Authentik
# surfaces may face the public internet, and which must never.
#
# Sourced by BOTH guards, which check the same policy from opposite ends:
#   - check-authentik-public-paths.sh  (static, pre-merge: rendered chart)
#   - check-authentik-live-boundary.sh (black-box, post-deploy: live edge)
#
# It exists because those two scripts previously carried their own copies of
# FORBIDDEN_PATHS under a "keep the two lists in sync" comment. A comment is
# not a mechanism: nothing failed if they drifted, and a surface added to one
# list but not the other would be guarded pre-merge and unguarded in prod (or
# the reverse) with both jobs green. Deduplicating the list removes the drift
# by construction instead of asking a reviewer to notice it.
#
# ── WHY ANY AUTHENTIK PATH IS PUBLIC AT ALL ───────────────────────────────
# FuzeFront abstracts the IdP vendor at the API layer: products and the SPA
# call the security service (/v1/security/*, @fuzefront/security-client) and
# never name Authentik. That abstraction is real and holds — there is no
# Authentik path anywhere in frontend/src.
#
# It cannot, however, extend to the browser-redirect leg of OIDC. OIDC is a
# front-channel protocol: the user agent itself must transit the authorization
# endpoint and render the login/consent UI. A backend cannot proxy that away
# without becoming a credential interceptor. So a SMALL, CLOSED set of
# Authentik-native paths is reverse-proxied under app.fuzefront.com (which is
# why the IdP HOST stays invisible — the vendor is hidden at the hostname
# layer even though the path layer necessarily leaks it).
#
# "Small and closed" is the whole security property, and it is what
# APPROVED_PUBLIC_PATHS below makes machine-checkable.

# ── Layer 1: the CLOSED SET ────────────────────────────────────────────────
# The complete set of paths that fuzefront.authentikPublicPaths (_helpers.tpl)
# is permitted to route to authentik-server. The static guard asserts the
# rendered chart matches this EXACTLY — no extras, and nothing missing.
#
# This is an ALLOWLIST, and that is deliberate. The guard used to be a
# denylist alone, which can only ever forbid a surface somebody remembered to
# enumerate. That is precisely how `/applications` reached the internet: no
# one had listed it, so no check could object. Under a closed set, ANY new
# Authentik path — enumerated or not, thought of or not — fails the build
# until a human adds it here with a justification. The denylist below is kept
# as a second layer, not the only one.
#
# Format: "<path>|<verified>|<justification>"
#   verified = "capture"  — confirmed required by an observed browser network
#                           capture or by code in this repo
#   verified = "unverified" — inherited from the pre-incident list; no evidence
#                           in this repo demonstrates a browser needs it. NOT
#                           removed blind (removing a path a live login turns
#                           out to need is an outage), but reported by the
#                           guard so the debt is visible instead of silent.
# shellcheck disable=SC2034  # consumed by the scripts that source this file
APPROVED_PUBLIC_PATHS=(
  "/application/o/|capture|OIDC authorize/token/userinfo/jwks/end-session. The browser MUST reach authorize: backend/security/src/services/oidc.ts pins token/userinfo/jwks to the in-cluster base but leaves authorization_endpoint EXTERNAL, 'it is browser-facing'. Narrowed from a bare /application, which string-prefix-matched /applications."
  "/if/flow/|capture|Flow-executor UI. The authorize endpoint 302s the user agent here to render login/consent. frontend/vite.config.ts excludes /if/ from the service-worker navigation fallback for exactly this reason."
  "/if/session-end/|unverified|RP-initiated-logout landing page. No code in this repo constructs or navigates to it; grep for session-end/end_session across backend/security/src, frontend/src and deploy/helm returns nothing."
  "/source/|capture|Social (Google) sign-in. frontend/vite.config.ts: 'Social sign-in navigates the browser to /source/oauth/login/<provider>/; without these entries the SW served the cached SPA shell instead of letting the redirect reach Authentik'. Note the SINGULAR /source/ — /sources is the admin source-list API and is forbidden below."
  "/api/v3/flows/executor/|capture|The flow-executor SPA calls this from the browser to advance stages. (The security service ALSO drives it, but server-side over the in-cluster base — see authentikBaseUrl() — so that consumer needs no public route.)"
  "/api/v3/root/config/|capture|Anonymous-safe bootstrap config. Not observed in the 2026.5.5 capture (config arrives embedded in the initial HTML) but retained so a flow variant that bootstraps from it still renders a login page."
  "/static/dist/|capture|Static JS/CSS assets for the flow-executor UI above."
  "/static/authentik/|capture|Static branding/theme assets for the flow-executor UI above."
  "/outpost.goauthentik.io/|unverified|Embedded-outpost / forward-auth endpoints. No forward-auth consumer exists in this chart; inherited from the pre-incident list."
  "/flows/|unverified|No Authentik surface at this bare prefix is referenced anywhere in this repo. Inherited from the pre-incident list. Distinct from /api/v3/flows/executor/ above, which is the one the browser demonstrably uses."
  "/ws/|unverified|Authentik websocket endpoint. No browser consumer in this repo; the flow executor is plain HTTP."
  "/-/|unverified|Serves Authentik's health endpoints. Its ONLY demonstrated consumer in this repo is the kubelet probe — deploy/helm/fuzefront/templates/authentik.yaml uses httpGet /-/health/live/ and /-/health/ready/ on port 9000 DIRECTLY against the pod, which does not transit the Ingress at all. Nothing in this repo shows a browser needing it."
)

# ── Layer 2: the DENYLIST ──────────────────────────────────────────────────
# Surfaces that must never be reachable, checked independently of the closed
# set. Under Traefik's PathPrefix (a plain STRING prefix, NOT the Kubernetes
# spec's element-wise segment match) an approved path that is a string prefix
# of any entry here routes that entry to the internet.
#
# Kept even though the closed set now subsumes it: the closed set says "only
# these", this says "and specifically never those", and the live probe can
# only use this half (it cannot enumerate what an edge does NOT route).
# shellcheck disable=SC2034  # consumed by the scripts that source this file
AUTHENTIK_FORBIDDEN_PATHS=(
  # The original incident: Authentik's application-list API.
  "/applications"
  # Admin + user-account UI.
  "/if/admin"
  "/if/user"
  # Admin REST API namespaces.
  "/api/v3/core"
  "/api/v3/providers"
  "/api/v3/policies"
  "/api/v3/admin"
  "/api/v3/rbac"
  "/api/v3/crypto"
  "/api/v3/events"
  "/api/v3/outposts"
  "/api/v3/stages"
  "/api/v3/propertymappings"
  "/api/v3/managed"
  # Admin source-list API. Note this is the PLURAL form; the singular
  # /source/ is approved above for the social-login redirect.
  "/sources"
)
