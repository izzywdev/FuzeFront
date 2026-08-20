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
*/}}
{{- define "fuzefront.authentikPublicPaths" -}}
- /application
- /if/flow
- /if/session-end
- /source
- /flows
- /ws
- /-
- /outpost.goauthentik.io
- /api/v3/flows/executor
- /api/v3/root/config
- /static/dist
- /static/authentik
{{- end -}}
