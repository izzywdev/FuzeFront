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

/api/v3 has to stay for now — Authentik's flow-executor page is a SPA that calls
it from the browser, and fuzefront-backend currently reaches Authentik's Admin API
by hairpinning out through this same public edge (it sets no AUTHENTIK_BASE_URL,
so authentik-admin.ts falls back to deriving it from AUTHENTIK_ISSUER_URL). It is
authenticated — /api/v3/core/users/me/ returns 403 unauthenticated — but it is
surface that should shrink once that hairpin is repointed in-cluster.
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
- /api/v3
- /static/dist
- /static/authentik
{{- end -}}
