{{/* Common labels. */}}
{{- define "unleash.labels" -}}
app.kubernetes.io/part-of: fuzefront
app.kubernetes.io/name: unleash
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/*
Pod scheduling block (nodeSelector + affinity + tolerations).
Usage:  {{- include "unleash.scheduling" (dict "svc" .Values.unleash "root" .) | nindent 6 }}
Falls back to the global placement defaults when the service sets nothing.
Renders nothing when neither specifies placement.
*/}}
{{- define "unleash.scheduling" -}}
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
Usage:  {{- include "unleash.metricsAnnotations" (dict "port" .Values.unleash.port "root" .) | nindent 8 }}
Renders nothing when observability.metrics.enabled is false.
*/}}
{{- define "unleash.metricsAnnotations" -}}
{{- $obs := .root.Values.observability | default dict -}}
{{- $m := $obs.metrics | default dict -}}
{{- if $m.enabled -}}
prometheus.io/scrape: "true"
prometheus.io/port: {{ .port | quote }}
prometheus.io/path: {{ .path | default $m.path | default "/metrics" | quote }}
{{- end -}}
{{- end -}}
