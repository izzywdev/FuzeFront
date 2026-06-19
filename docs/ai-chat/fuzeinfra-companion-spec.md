# FuzeInfra Companion PR Spec — AI Chat (RAG) Foundation

This document specifies exactly what the companion PR in the **izzywdev/FuzeInfra** repo
must add to support the FuzeFront AI Chat feature. The FuzeFront Helm chart and Argo apps
in this repo depend on these additions.

---

## 1. LiteLLM Helm Chart — `FuzeInfra/helm/litellm`

The `deploy/argocd/applications/litellm.yaml` Argo Application points at this path. You must
create a Helm chart here before the Argo Application can sync.

### 1a. Directory layout

```
FuzeInfra/helm/litellm/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
    configmap.yaml
```

### 1b. Chart.yaml

```yaml
apiVersion: v2
name: litellm
description: LiteLLM unified LLM gateway for FuzeFront AI Chat
type: application
version: 0.1.0
appVersion: "1.40.10"  # verify ghcr.io/berriai/litellm for latest stable tag before merge
```

### 1c. values.yaml

```yaml
litellm:
  enabled: true
  image:
    repository: ghcr.io/berriai/litellm
    # Pin a concrete tag. Verify latest stable at https://github.com/BerriAI/litellm/releases
    tag: "main-v1.40.10"
  port: 4000
  replicas: 1
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits:   { cpu: "1",  memory: 512Mi }
  # Model list rendered into the ConfigMap.
  # Claude is the primary model; text-embedding-3-small for RAG embeddings.
  models:
    - model_name: claude-default
      litellm_params:
        model: anthropic/claude-opus-4-5
        api_key: "os.environ/ANTHROPIC_API_KEY"
    - model_name: text-embedding-3-small
      litellm_params:
        model: openai/text-embedding-3-small
        api_key: "os.environ/OPENAI_API_KEY"
  # success_callback: billing event. Either handle here (emit to Kafka) or in
  # the chat-service (receives usage from LiteLLM response headers). The FuzeFront
  # chat-service will handle billing.llm.usage events on its side as the primary
  # path; the LiteLLM success_callback below is optional belt-and-suspenders.
  successCallbacks: []
```

### 1d. templates/configmap.yaml

```yaml
{{- if .Values.litellm.enabled }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: litellm-config
  namespace: fuzeinfra
data:
  config.yaml: |
    model_list:
    {{- range .Values.litellm.models }}
      - model_name: {{ .model_name }}
        litellm_params:
          model: {{ .litellm_params.model }}
          api_key: {{ .litellm_params.api_key }}
    {{- end }}
    general_settings:
      master_key: "os.environ/LITELLM_MASTER_KEY"
    {{- if .Values.litellm.successCallbacks }}
    litellm_settings:
      success_callback:
      {{- range .Values.litellm.successCallbacks }}
        - {{ . }}
      {{- end }}
    {{- end }}
{{- end }}
```

### 1e. templates/deployment.yaml

```yaml
{{- if .Values.litellm.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: litellm
  namespace: fuzeinfra
spec:
  replicas: {{ .Values.litellm.replicas }}
  selector:
    matchLabels:
      app: litellm
  template:
    metadata:
      labels:
        app: litellm
    spec:
      containers:
        - name: litellm
          image: "{{ .Values.litellm.image.repository }}:{{ .Values.litellm.image.tag }}"
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: {{ .Values.litellm.port }}
          args:
            - --config
            - /app/config.yaml
            - --port
            - {{ .Values.litellm.port | quote }}
          env:
            # Provider keys come from the fuzeinfra-ai-keys Secret (never committed).
            # See §3 below for the Secret spec.
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: fuzeinfra-ai-keys
                  key: ANTHROPIC_API_KEY
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: fuzeinfra-ai-keys
                  key: OPENAI_API_KEY
            - name: LITELLM_MASTER_KEY
              valueFrom:
                secretKeyRef:
                  name: fuzeinfra-ai-keys
                  key: LITELLM_MASTER_KEY
          volumeMounts:
            - name: config
              mountPath: /app/config.yaml
              subPath: config.yaml
          readinessProbe:
            httpGet:
              path: /health
              port: {{ .Values.litellm.port }}
            initialDelaySeconds: 15
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: {{ .Values.litellm.port }}
            initialDelaySeconds: 30
            periodSeconds: 15
          resources:
            {{- toYaml .Values.litellm.resources | nindent 12 }}
      volumes:
        - name: config
          configMap:
            name: litellm-config
{{- end }}
```

### 1f. templates/service.yaml

```yaml
{{- if .Values.litellm.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: litellm
  namespace: fuzeinfra
spec:
  selector:
    app: litellm
  ports:
    - port: {{ .Values.litellm.port }}
      targetPort: {{ .Values.litellm.port }}
{{- end }}
```

---

## 2. Enabling ChromaDB

ChromaDB is already gated in the fuzeinfra chart values. To enable it, flip the flag in
`deploy/argocd/applications/fuzeinfra.yaml` (FuzeFront repo) inside the `helm.values` block:

```yaml
# In deploy/argocd/applications/fuzeinfra.yaml, change:
chromadb: { enabled: false }
# to:
chromadb: { enabled: true }
```

The fuzeinfra chart must already have a `chromadb` component. If it does not, add it:

### 2a. ChromaDB Helm component (if not yet in fuzeinfra chart)

Add to `FuzeInfra/helm/fuzeinfra/templates/chromadb.yaml`:

```yaml
{{- if .Values.chromadb.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chromadb
  namespace: fuzeinfra
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chromadb
  template:
    metadata:
      labels:
        app: chromadb
    spec:
      containers:
        - name: chromadb
          # Pin a concrete tag. Verify at https://github.com/chroma-core/chroma/releases
          image: chromadb/chroma:0.5.3
          ports:
            - containerPort: 8000
          env:
            # Local dev: auth disabled. Production: set CHROMA_SERVER_AUTHN_PROVIDER
            # and CHROMA_SERVER_AUTHN_CREDENTIALS_FILE with token-based auth.
            - name: IS_PERSISTENT
              value: "TRUE"
          volumeMounts:
            - name: chroma-data
              mountPath: /chroma/chroma
          readinessProbe:
            httpGet:
              path: /api/v1/heartbeat
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/v1/heartbeat
              port: 8000
            initialDelaySeconds: 20
            periodSeconds: 15
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: 500m, memory: 1Gi }
      volumes:
        - name: chroma-data
          persistentVolumeClaim:
            claimName: chromadb-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: chromadb-pvc
  namespace: fuzeinfra
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 5Gi
  storageClassName: {{ .Values.global.storageClass | default "standard" }}
---
apiVersion: v1
kind: Service
metadata:
  name: chromadb
  namespace: fuzeinfra
spec:
  selector:
    app: chromadb
  ports:
    - port: 8000
      targetPort: 8000
{{- end }}
```

Add the default values to `FuzeInfra/helm/fuzeinfra/values.yaml`:

```yaml
chromadb:
  enabled: false
```

### 2b. Authentication notes

- **Local/dev**: `IS_PERSISTENT=TRUE`, no auth credentials set — ChromaDB runs without auth.
- **Production**: Set the following env vars in a sealed/external Secret in `fuzeinfra`:
  - `CHROMA_SERVER_AUTHN_PROVIDER: chromadb.auth.token.TokenAuthServerProvider`
  - `CHROMA_SERVER_AUTHN_CREDENTIALS_FILE: /chroma/auth/server.htpasswd`
  (or use `CHROMA_SERVER_AUTH_TOKEN_TRANSPORT_HEADER` for token auth).
  The chat-service must supply `CHROMA_AUTH_TOKEN` from its own secret.

---

## 3. Provider-Key Secret in `fuzeinfra` namespace

The LiteLLM chart reads provider keys from a Secret named `fuzeinfra-ai-keys` in the
`fuzeinfra` namespace. **This secret is NEVER committed to git.** Create it out-of-band,
preferably as a SealedSecret (if using sealed-secrets) or via your secrets management
pipeline.

### 3a. Required keys

| Key | Description |
|-----|-------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI API key (for embeddings) |
| `LITELLM_MASTER_KEY` | LiteLLM gateway master key (shared with chat-service) |

### 3b. Manual creation (dev only)

```bash
kubectl create secret generic fuzeinfra-ai-keys \
  --namespace fuzeinfra \
  --from-literal=ANTHROPIC_API_KEY=<your-key> \
  --from-literal=OPENAI_API_KEY=<your-key> \
  --from-literal=LITELLM_MASTER_KEY=<your-random-master-key>
```

### 3c. Production

Use SealedSecrets or an external secrets operator. Never pass real keys via Helm values or
commit them to git. The LiteLLM Argo Application will remain in a degraded/suspended state
until this Secret exists in the cluster.
