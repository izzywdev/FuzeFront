{{- define "fuzequality.labels" -}}
app.kubernetes.io/name: fuzequality
app.kubernetes.io/part-of: fuzequality
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "fuzequality.env" -}}
- name: DATABASE_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: DATABASE_URL } }
- name: FUZEQUALITY_API_TOKEN
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: FUZEQUALITY_API_TOKEN } }
- name: KAFKA_BROKERS
  value: {{ .Values.config.kafkaBrokers | quote }}
- name: LITELLM_URL
  value: {{ .Values.config.litellmUrl | quote }}
- name: FUZEQUALITY_LLM_MODEL
  value: {{ .Values.config.llmModel | quote }}
- name: LITELLM_MASTER_KEY
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: LITELLM_MASTER_KEY, optional: true } }
- name: GITHUB_APP_ID
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: GITHUB_APP_ID, optional: true } }
- name: GITHUB_APP_PRIVATE_KEY
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: GITHUB_APP_PRIVATE_KEY, optional: true } }
- name: GITHUB_WEBHOOK_SECRET
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: GITHUB_WEBHOOK_SECRET, optional: true } }
- name: JIRA_BASE_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: JIRA_BASE_URL, optional: true } }
- name: JIRA_EMAIL
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: JIRA_EMAIL, optional: true } }
- name: JIRA_API_TOKEN
  valueFrom: { secretKeyRef: { name: {{ .Values.secret.existingSecret }}, key: JIRA_API_TOKEN, optional: true } }
{{- end -}}
