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
