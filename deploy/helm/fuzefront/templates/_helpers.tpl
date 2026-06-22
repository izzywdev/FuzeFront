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
