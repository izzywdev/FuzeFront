{{/* Name of the Secret the workloads read from. */}}
{{- define "fuzefront.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- .Values.secret.existingSecret -}}
{{- else -}}
fuzefront-secrets
{{- end -}}
{{- end -}}

{{/* Common labels. */}}
{{- define "fuzefront.labels" -}}
app.kubernetes.io/part-of: fuzefront
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/*
Pod scheduling block (nodeSelector + affinity + tolerations).
Usage:  {{- include "fuzefront.scheduling" (dict "svc" .Values.someService "root" .) | nindent 6 }}
Falls back to the global placement defaults when a service sets nothing. Renders
nothing when neither the service nor the global defaults specify placement, so it
is a no-op by default (heavy stateless services can opt into node-2 via values).
*/}}
{{- define "fuzefront.scheduling" -}}
{{- $svc := .svc | default dict -}}
{{- $g := .root.Values.global.scheduling | default dict -}}
{{- $nodeSelector := $svc.nodeSelector | default $g.nodeSelector -}}
{{- $affinity := $svc.affinity | default $g.affinity -}}
{{- $tolerations := $svc.tolerations | default $g.tolerations -}}
{{- with $nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/*
Prometheus scrape annotations for a pod template.
Usage:  {{- include "fuzefront.metricsAnnotations" (dict "port" .Values.backend.port "root" .) | nindent 8 }}
Renders nothing when observability.metrics.enabled is false, so it is a no-op by
default. `path` defaults to /metrics.
*/}}
{{- define "fuzefront.metricsAnnotations" -}}
{{- $obs := .root.Values.observability | default dict -}}
{{- $m := $obs.metrics | default dict -}}
{{- if $m.enabled -}}
prometheus.io/scrape: "true"
prometheus.io/port: {{ .port | quote }}
prometheus.io/path: {{ .path | default $m.path | default "/metrics" | quote }}
{{- end -}}
{{- end -}}

{{/*
The ONLY Authentik paths that may be reachable from the public internet.

Authentik is an IdP for public products (FuzeFront, and MendysRobotics via
marketplace.mendysrobotics.com, whose /api/auth/oidc/login 302s to this IdP), so
its OIDC protocol and login-flow surface cannot be made private without breaking
customer logins. Its ADMINISTRATION surface can, and must be.

The critical entry is what is ABSENT: a bare "/if". That prefix served
/if/admin/ — the full Authentik admin interface — from every public host. Only
/if/flow (the login/enrollment flow executor UI) and /if/session-end are needed
by a browser. Admins reach the admin UI at authentik.<prod domain>, which sits
behind Cloudflare Access.

Do NOT re-add "/if", and do not add "/if/user": FuzeFront owns its own profile
and MFA UI (mfa_factors is native, not an Authentik stage).

/api/v3 is NO LONGER exposed wholesale. It used to be, for two reasons, and both
are now gone:
  1. The flow-executor SPA calls the API from the browser. Measured against
     2026.5.5 (full network capture of an anonymous load of
     /if/flow/default-authentication-flow/), the ONLY /api/v3 path it touches is
     /api/v3/flows/executor/. Config and branding arrive embedded in the initial
     HTML, not via /api/v3/root/config/ or /api/v3/core/brands/current/.
     /api/v3/root/config is kept anyway: it is anonymous-safe, and a flow variant
     that bootstraps from it would otherwise fail to render a login page.
  2. fuzefront-backend reached the Admin API by hairpinning out through this
     public edge, because backend.yaml set no AUTHENTIK_BASE_URL and
     authentik-admin.ts falls back to deriving it from AUTHENTIK_ISSUER_URL.
     backend.yaml now sets AUTHENTIK_BASE_URL to the in-cluster Service, the same
     way security.yaml already did.

So /api/v3/core/*, /api/v3/providers/*, /api/v3/policies/* and the rest of the
Admin API are no longer routable from the internet at all. They were previously
reachable and merely *rejected* (403) by Authentik's own authorization — defence
by application authz alone, with no network boundary behind it.

Do NOT widen this back to a bare /api/v3. If a login flow breaks, capture the
browser's network log and add the ONE specific prefix it needs.

EVERY entry below carries a trailing slash. This is not cosmetic: Traefik's
Kubernetes Ingress provider implements `pathType: Prefix` as its `PathPrefix`
matcher — a plain STRING prefix, not the Kubernetes spec's element-wise
segment match. `/application` (no slash) therefore string-prefix-matches
`/applications` too, and routed the ENTIRE Authentik application-list API
(GET /applications, no auth challenge on the list itself) to the public
internet — live for an unknown period until caught. `/source` matched
`/sources`, `/flows` matched anything starting `/flows`, `/-` matched any
path starting with a bare hyphen, and so on for every entry that lacked a
trailing slash. The manifest was correct against the Kubernetes spec and
wrong against the controller that actually serves it.

`- /application` MUST NOT be re-added: narrow to `/application/o/` (the OIDC
provider's authorize/token/userinfo/jwks/end-session endpoints — verified
against every provider blueprint under authentik/blueprints/, all
authentik_providers_oauth2; there is no SAML provider configured, so
`/application/saml/` is not needed). If a SAML provider is ever added, add
`/application/saml/` explicitly then — do not widen back to a bare prefix.

THIS LIST IS A CLOSED SET, AND IT IS ENFORCED. Every entry below must also
appear in APPROVED_PUBLIC_PATHS in deploy/scripts/authentik-path-policy.sh
with a written justification. Adding a path here without adding it there
FAILS THE BUILD, and vice versa. That is deliberate: this list used to be
guarded only by a denylist, which by construction can object only to
surfaces somebody remembered to enumerate — which is exactly how
/applications reached the public internet unlisted, unnoticed, and green.
Do not "fix" a closed-set failure by pasting the path into the policy file;
add the browser network capture that proves the OIDC flow needs it, or
remove it from here.

The policy file is the single source of truth for BOTH guards, which check
it from opposite ends:

  - `gate-authentik-public-paths` (helm-validate.yml, backed by
    deploy/scripts/check-authentik-public-paths.sh) renders both overlays
    and fails if (1) any Authentik-backed path here is a STRING PREFIX (i.e.
    would traefik-match) of a known-forbidden path, or (2) the rendered set
    is not EXACTLY the approved set.
  - `check-authentik-live-boundary.sh` (prod-post-deploy.yml) black-box
    probes the real public edge, catching what a static check cannot: a
    Traefik upgrade that changes matcher semantics, or an Ingress applied
    outside this chart.

Both carry a --self-test that must go red on the known-broken input before
the real check is trusted.

NOTE on the entries below: 5 of the 12 — /if/session-end/, /flows/, /ws/,
/-/ and /outpost.goauthentik.io/ — have NO evidence in this repo
that a browser needs them — they were inherited from the pre-incident list.
They are marked `unverified` in the policy file, which prints a warning for
each on every CI run. /-/ in particular serves only Authentik's health
endpoints, whose sole in-repo consumer is the kubelet probe hitting the pod
directly on port 9000 (authentik.yaml) — which never transits this Ingress.
Settle each with a network capture of a live login and delete the ones that
turn out to be unnecessary; do not delete them blind, since a path a real
login needs is an outage.
*/}}
{{- define "fuzefront.authentikPublicPaths" -}}
- /application/o/
- /if/flow/
- /if/session-end/
- /source/
- /flows/
- /ws/
- /-/
- /outpost.goauthentik.io/
- /api/v3/flows/executor/
- /api/v3/root/config/
- /static/dist/
- /static/authentik/
{{- end -}}

{{/*
Render .Values.federatedProxy.upstreams as the JSON object the backend's
federated asset proxy expects: {"<slug>":"<base url>"}.

Returns "{}" when the feature is disabled or the list is empty, so the env var
is always present and always parses — a backend that finds no upstreams answers
404 for every remote, which is the intended default.

Entries missing `slug` or `url` FAIL THE RENDER rather than being skipped. A
silently dropped remote is indistinguishable from a working one until someone
opens the portal and finds a blank panel; `helm template` is the last place that
mistake is cheap to catch.
*/}}
{{- define "fuzefront.federatedProxyUpstreams" -}}
{{- $out := dict -}}
{{- if .Values.federatedProxy.enabled -}}
{{- range $i, $u := .Values.federatedProxy.upstreams -}}
{{- if not $u.slug -}}
{{- fail (printf "federatedProxy.upstreams[%d] has no `slug` — the browser requests /apps/<slug>/..., so this entry could never be matched." $i) -}}
{{- end -}}
{{- if not $u.url -}}
{{- fail (printf "federatedProxy.upstreams[%d] (slug %q) has no `url` — there is nothing to proxy to." $i $u.slug) -}}
{{- end -}}
{{- $_ := set $out $u.slug $u.url -}}
{{- end -}}
{{- end -}}
{{- $out | toJson -}}
{{- end -}}
