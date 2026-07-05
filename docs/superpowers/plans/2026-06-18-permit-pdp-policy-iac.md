# Plan A — Permit PDP + Policy IaC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Permit.io PDP in-cluster and codify the authorization schema (resources + roles) as version-controlled, idempotently-applied IaC, so a provisioned `owner` actually passes permission checks.

**Architecture:** The PDP runs as a standalone Deployment+Service (`fuzefront-permit-pdp:7000`), gated on `permit.enabled`. The policy *schema* is defined declaratively in TypeScript (`backend/src/permit/schema.ts`) and applied by an idempotent sync routine run as a Helm `post-install,post-upgrade` Job using the backend image. The schema talks to the Permit **cloud** control plane (via `PERMIT_API_KEY`); the PDP pulls policy from the cloud and answers `check()` locally.

**Tech Stack:** TypeScript, `permitio` SDK 2.4.0, Jest/ts-jest, Helm, `permitio/pdp-v2` image.

## Global Constraints
- Backend image ships **compiled `.js`** (`NODE_ENV=production`); any script run inside it must exist at `dist/...`. (per `backend.yaml:47`)
- `backend.port` must stay **3001**; Service name `fuzefront-backend` is significant.
- Secrets: chart-created `fuzefront-secrets` in dev; `existingSecret: fuzefront-secrets` (SealedSecret) in prod. Reuse the existing `PERMIT_API_KEY` key — do not add new secret keys.
- Permit roles referenced by code are exactly `admin`, `editor`, `viewer` (`role-assignment.ts:119-124`). Resources/actions are exactly those in `permission-check.ts` / `middleware/permissions.ts`.
- Tests live in `backend/tests/**/*.test.ts`; the global `tests/setup.ts` stands up Postgres for the whole run.

---

### Task 1: Permit schema definition + idempotent sync routine

**Files:**
- Create: `backend/src/permit/schema.ts`
- Create: `backend/src/permit/sync-permit-schema.ts`
- Test: `backend/tests/permit-schema.test.ts`
- Modify: `backend/package.json` (scripts)

**Interfaces:**
- Produces: `permitSchema: PermitSchema` (the resources+roles), `syncPermitSchema(permit: PermitSchemaClient, schema?: PermitSchema, log?: (m: string) => void): Promise<void>`, and types `PermitSchema`, `PermitResourceDef`, `PermitRoleDef`, `PermitSchemaClient`.
- Consumes: nothing from other tasks. The CLI guard lazily imports the real client from `../config/permit` so the module is import-safe in tests (no `PERMIT_API_KEY` needed).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/permit-schema.test.ts`:
```ts
import { permitSchema, syncPermitSchema, PermitSchemaClient } from '../src/permit/sync-permit-schema'

// A minimal fake of the permitio control-plane client surface we use.
function makeFakeClient(existing: { resources: string[]; roles: string[] }) {
  const calls = {
    resourceCreate: [] as any[],
    resourceUpdate: [] as any[],
    roleCreate: [] as any[],
    roleUpdate: [] as any[],
  }
  const client: PermitSchemaClient = {
    api: {
      resources: {
        get: async (key: string) => {
          if (!existing.resources.includes(key)) throw new Error('not found')
          return { key }
        },
        create: async (def: any) => { calls.resourceCreate.push(def) },
        update: async (key: string, def: any) => { calls.resourceUpdate.push({ key, def }) },
      },
      roles: {
        get: async (key: string) => {
          if (!existing.roles.includes(key)) throw new Error('not found')
          return { key }
        },
        create: async (def: any) => { calls.roleCreate.push(def) },
        update: async (key: string, def: any) => { calls.roleUpdate.push({ key, def }) },
      },
    },
  }
  return { client, calls }
}

describe('permit schema IaC', () => {
  it('defines exactly the resources and roles the code references', () => {
    expect(permitSchema.resources.map(r => r.key).sort()).toEqual(
      ['App', 'Organization', 'UserManagement']
    )
    expect(permitSchema.roles.map(r => r.key).sort()).toEqual(['admin', 'editor', 'viewer'])

    const org = permitSchema.resources.find(r => r.key === 'Organization')!
    expect(Object.keys(org.actions).sort()).toEqual(
      ['create', 'delete', 'manage', 'read', 'update']
    )
    const app = permitSchema.resources.find(r => r.key === 'App')!
    expect(Object.keys(app.actions).sort()).toEqual(
      ['create', 'delete', 'install', 'read', 'uninstall', 'update']
    )
    const um = permitSchema.resources.find(r => r.key === 'UserManagement')!
    expect(Object.keys(um.actions).sort()).toEqual(
      ['invite', 'remove', 'update_role', 'view_members']
    )
  })

  it('admin role can manage organizations and user management', () => {
    const admin = permitSchema.roles.find(r => r.key === 'admin')!
    expect(admin.permissions).toContain('Organization:manage')
    expect(admin.permissions).toContain('UserManagement:invite')
    expect(admin.permissions).toContain('App:delete')
  })

  it('viewer role is read-only (no write/manage perms)', () => {
    const viewer = permitSchema.roles.find(r => r.key === 'viewer')!
    expect(viewer.permissions).toContain('Organization:read')
    expect(viewer.permissions).toContain('App:read')
    expect(viewer.permissions.some(p => /:(create|update|delete|manage|invite|remove|update_role)$/.test(p))).toBe(false)
  })

  it('creates resources and roles when none exist (idempotent: create path)', async () => {
    const { client, calls } = makeFakeClient({ resources: [], roles: [] })
    await syncPermitSchema(client)
    expect(calls.resourceCreate.map(r => r.key).sort()).toEqual(['App', 'Organization', 'UserManagement'])
    expect(calls.roleCreate.map(r => r.key).sort()).toEqual(['admin', 'editor', 'viewer'])
    expect(calls.resourceUpdate).toHaveLength(0)
    expect(calls.roleUpdate).toHaveLength(0)
  })

  it('updates resources and roles when they already exist (idempotent: update path)', async () => {
    const { client, calls } = makeFakeClient({
      resources: ['App', 'Organization', 'UserManagement'],
      roles: ['admin', 'editor', 'viewer'],
    })
    await syncPermitSchema(client)
    expect(calls.resourceCreate).toHaveLength(0)
    expect(calls.roleCreate).toHaveLength(0)
    expect(calls.resourceUpdate.map(r => r.key).sort()).toEqual(['App', 'Organization', 'UserManagement'])
    expect(calls.roleUpdate.map(r => r.key).sort()).toEqual(['admin', 'editor', 'viewer'])
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && npm test -- --testPathPattern=permit-schema`
Expected: FAIL — `Cannot find module '../src/permit/sync-permit-schema'`.

- [ ] **Step 3: Create the schema definition**

Create `backend/src/permit/schema.ts`:
```ts
// Declarative Permit.io authorization schema (IaC). The single source of truth
// for the resources/actions the backend checks (src/utils/permit/permission-check.ts,
// src/middleware/permissions.ts) and the tenant roles it assigns
// (src/utils/permit/role-assignment.ts: owner/admin -> admin, member -> editor, viewer -> viewer).

export interface PermitResourceDef {
  key: string
  name: string
  actions: Record<string, { name: string }>
}

export interface PermitRoleDef {
  key: string
  name: string
  permissions: string[] // "<ResourceKey>:<action>"
}

export interface PermitSchema {
  resources: PermitResourceDef[]
  roles: PermitRoleDef[]
}

const action = (name: string) => ({ name })

export const permitSchema: PermitSchema = {
  resources: [
    {
      key: 'Organization',
      name: 'Organization',
      actions: {
        create: action('Create'),
        read: action('Read'),
        update: action('Update'),
        delete: action('Delete'),
        manage: action('Manage'),
      },
    },
    {
      key: 'App',
      name: 'App',
      actions: {
        create: action('Create'),
        read: action('Read'),
        update: action('Update'),
        delete: action('Delete'),
        install: action('Install'),
        uninstall: action('Uninstall'),
      },
    },
    {
      key: 'UserManagement',
      name: 'User Management',
      actions: {
        invite: action('Invite'),
        remove: action('Remove'),
        update_role: action('Update Role'),
        view_members: action('View Members'),
      },
    },
  ],
  roles: [
    {
      key: 'admin',
      name: 'Admin',
      permissions: [
        'Organization:create', 'Organization:read', 'Organization:update',
        'Organization:delete', 'Organization:manage',
        'App:create', 'App:read', 'App:update', 'App:delete', 'App:install', 'App:uninstall',
        'UserManagement:invite', 'UserManagement:remove',
        'UserManagement:update_role', 'UserManagement:view_members',
      ],
    },
    {
      key: 'editor',
      name: 'Editor',
      permissions: [
        'Organization:read',
        'App:create', 'App:read', 'App:update', 'App:install', 'App:uninstall',
        'UserManagement:view_members',
      ],
    },
    {
      key: 'viewer',
      name: 'Viewer',
      permissions: [
        'Organization:read',
        'App:read',
        'UserManagement:view_members',
      ],
    },
  ],
}
```

- [ ] **Step 4: Create the idempotent sync routine**

Create `backend/src/permit/sync-permit-schema.ts`:
```ts
import { permitSchema, PermitSchema } from './schema'

export { permitSchema } from './schema'
export type { PermitSchema, PermitResourceDef, PermitRoleDef } from './schema'

// The slice of the permitio client surface this routine uses. Declared
// structurally so tests can inject a fake without the real SDK / PERMIT_API_KEY.
export interface PermitSchemaClient {
  api: {
    resources: {
      get(key: string): Promise<unknown>
      create(def: unknown): Promise<unknown>
      update(key: string, def: unknown): Promise<unknown>
    }
    roles: {
      get(key: string): Promise<unknown>
      create(def: unknown): Promise<unknown>
      update(key: string, def: unknown): Promise<unknown>
    }
  }
}

// get-or-(create|update): idempotent and agnostic to SDK error shapes.
export async function syncPermitSchema(
  permit: PermitSchemaClient,
  schema: PermitSchema = permitSchema,
  log: (m: string) => void = console.log
): Promise<void> {
  for (const resource of schema.resources) {
    try {
      await permit.api.resources.get(resource.key)
      await permit.api.resources.update(resource.key, {
        name: resource.name,
        actions: resource.actions,
      })
      log(`Permit resource updated: ${resource.key}`)
    } catch {
      await permit.api.resources.create(resource)
      log(`Permit resource created: ${resource.key}`)
    }
  }

  for (const role of schema.roles) {
    try {
      await permit.api.roles.get(role.key)
      await permit.api.roles.update(role.key, {
        name: role.name,
        permissions: role.permissions,
      })
      log(`Permit role updated: ${role.key}`)
    } catch {
      await permit.api.roles.create(role)
      log(`Permit role created: ${role.key}`)
    }
  }
}

// CLI entry — only runs when executed directly (node dist/permit/sync-permit-schema.js).
// Lazily importing the real client here keeps the module import-safe for tests.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const permit = require('../config/permit').default as PermitSchemaClient
  syncPermitSchema(permit)
    .then(() => {
      console.log('Permit schema sync complete')
      process.exit(0)
    })
    .catch(err => {
      console.error('Permit schema sync failed:', err)
      process.exit(1)
    })
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd backend && npm test -- --testPathPattern=permit-schema`
Expected: PASS (5 tests).

- [ ] **Step 6: Add the npm script**

In `backend/package.json` scripts, add after `"db:init"`:
```json
    "permit:schema": "node dist/permit/sync-permit-schema.js",
```

- [ ] **Step 7: Verify type-check & build**

Run: `cd backend && npm run type-check && npm run build`
Expected: no errors; `dist/permit/sync-permit-schema.js` and `dist/permit/schema.js` exist.

- [ ] **Step 8: Commit**

```bash
git add backend/src/permit backend/tests/permit-schema.test.ts backend/package.json
git commit -m "feat(permit): codify authz schema (resources+roles) as idempotent IaC"
```

---

### Task 2: Permit PDP Deployment + Service + backend wiring

**Files:**
- Create: `deploy/helm/fuzefront/templates/permit-pdp.yaml`
- Modify: `deploy/helm/fuzefront/templates/backend.yaml:84-85` (PERMIT_PDP_URL)
- Modify: `deploy/helm/fuzefront/values.yaml` (add `permit:` block)
- Modify: `deploy/helm/fuzefront/values-prod.yaml` (`permit.enabled: true`)

**Interfaces:**
- Produces: in-cluster Service `fuzefront-permit-pdp:7000`; values key `.Values.permit.enabled` (bool), `.Values.permit.pdp.image.{repository,tag}`, `.Values.permit.pdp.resources`.
- Consumes: existing `fuzefront.secretName` helper + `PERMIT_API_KEY` secret key; `.Values.global.imagePullPolicy`.

- [ ] **Step 1: Add the `permit` values block**

In `deploy/helm/fuzefront/values.yaml`, after the `backend:` block (before `frontend:`), add:
```yaml
# Permit.io authorization. Disabled by default (minimal cut). When enabled, the
# chart runs a standalone PDP and (Task 3) a schema-sync Job. PERMIT_API_KEY is
# read from the existing chart Secret. Local enablement needs a REAL key — the
# PDP's offline mode is unreliable (see docs/troubleshooting/PERMIT_PDP_TROUBLESHOOTING.md).
permit:
  enabled: false
  pdp:
    image:
      repository: permitio/pdp-v2
      # Pin to a concrete tag (Step: verify before commit). Do NOT use :latest.
      tag: "0.8.1"
    resources:
      requests: { cpu: 100m, memory: 256Mi }
      limits:   { cpu: 500m, memory: 512Mi }
```

- [ ] **Step 2: Pin the PDP image tag**

Run: `docker pull permitio/pdp-v2:latest && docker run --rm --entrypoint sh permitio/pdp-v2:latest -c 'cat /app/VERSION 2>/dev/null || echo unknown'`
If a different concrete version is returned, set `permit.pdp.image.tag` in `values.yaml` to that exact version. Confirm the tag exists on Docker Hub (`docker manifest inspect permitio/pdp-v2:<tag>` returns without error). Leave it pinned — never `:latest`.

- [ ] **Step 3: Create the PDP Deployment + Service**

Create `deploy/helm/fuzefront/templates/permit-pdp.yaml`:
```yaml
{{- if .Values.permit.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fuzefront-permit-pdp
  labels:
    {{- include "fuzefront.labels" . | nindent 4 }}
    app.kubernetes.io/component: permit-pdp
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/part-of: fuzefront
      app.kubernetes.io/component: permit-pdp
  template:
    metadata:
      labels:
        app.kubernetes.io/part-of: fuzefront
        app.kubernetes.io/component: permit-pdp
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: permit-pdp
          image: "{{ .Values.permit.pdp.image.repository }}:{{ .Values.permit.pdp.image.tag }}"
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          ports:
            - name: http
              containerPort: 7000
          env:
            - name: PDP_API_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ include "fuzefront.secretName" . }}
                  key: PERMIT_API_KEY
            - name: PDP_DEBUG
              value: "false"
          readinessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 45
            periodSeconds: 15
          resources:
            {{- toYaml .Values.permit.pdp.resources | nindent 12 }}
---
apiVersion: v1
kind: Service
metadata:
  name: fuzefront-permit-pdp
  labels:
    {{- include "fuzefront.labels" . | nindent 4 }}
    app.kubernetes.io/component: permit-pdp
spec:
  selector:
    app.kubernetes.io/part-of: fuzefront
    app.kubernetes.io/component: permit-pdp
  ports:
    - name: http
      port: 7000
      targetPort: http
{{- end }}
```

- [ ] **Step 4: Point the backend at the in-cluster PDP when enabled**

In `deploy/helm/fuzefront/templates/backend.yaml`, replace lines 84-85:
```yaml
            - name: PERMIT_PDP_URL
              value: "http://localhost:7766"
```
with:
```yaml
            - name: PERMIT_PDP_URL
              {{- if .Values.permit.enabled }}
              value: "http://fuzefront-permit-pdp:7000"
              {{- else }}
              value: "http://localhost:7766"
              {{- end }}
```

- [ ] **Step 5: Enable Permit in prod**

In `deploy/helm/fuzefront/values-prod.yaml`, after the `frontend:` block, add:
```yaml
permit:
  enabled: true
```

- [ ] **Step 6: Verify the chart renders correctly (disabled by default)**

Run: `helm template fuzefront deploy/helm/fuzefront | grep -c 'permit-pdp'`
Expected: `0` (default `permit.enabled=false` renders no PDP).

Run: `helm template fuzefront deploy/helm/fuzefront | grep -A1 'name: PERMIT_PDP_URL'`
Expected: shows `value: "http://localhost:7766"`.

- [ ] **Step 7: Verify the chart renders the PDP when enabled (prod overlay)**

Run: `helm template fuzefront deploy/helm/fuzefront -f deploy/helm/fuzefront/values-prod.yaml | grep -E 'fuzefront-permit-pdp|http://fuzefront-permit-pdp:7000'`
Expected: shows the PDP Deployment+Service names and the backend `PERMIT_PDP_URL` pointing at `http://fuzefront-permit-pdp:7000`.

Run: `helm lint deploy/helm/fuzefront -f deploy/helm/fuzefront/values-prod.yaml`
Expected: `1 chart(s) linted, 0 chart(s) failed`.

- [ ] **Step 8: Commit**

```bash
git add deploy/helm/fuzefront/templates/permit-pdp.yaml deploy/helm/fuzefront/templates/backend.yaml deploy/helm/fuzefront/values.yaml deploy/helm/fuzefront/values-prod.yaml
git commit -m "feat(helm): deploy Permit PDP in-cluster, gated on permit.enabled"
```

---

### Task 3: Schema-sync Helm hook Job

**Files:**
- Create: `deploy/helm/fuzefront/templates/permit-schema-job.yaml`

**Interfaces:**
- Consumes: `.Values.permit.enabled`, `.Values.backend.image` (reuses the backend image that contains `dist/permit/sync-permit-schema.js` from Task 1), `fuzefront.secretName` + `PERMIT_API_KEY`.
- Produces: a `post-install,post-upgrade` Job `fuzefront-permit-schema-sync` that applies the schema to the Permit cloud control plane.

- [ ] **Step 1: Create the hook Job**

Create `deploy/helm/fuzefront/templates/permit-schema-job.yaml`:
```yaml
{{- if .Values.permit.enabled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: fuzefront-permit-schema-sync
  labels:
    {{- include "fuzefront.labels" . | nindent 4 }}
    app.kubernetes.io/component: permit-schema-sync
  annotations:
    # Apply the authz schema to the Permit cloud control plane after the app is
    # installed/upgraded. Idempotent (get-or-create|update), safe to re-run.
    "helm.sh/hook": post-install,post-upgrade
    "helm.sh/hook-weight": "5"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app.kubernetes.io/part-of: fuzefront
        app.kubernetes.io/component: permit-schema-sync
    spec:
      restartPolicy: Never
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: permit-schema-sync
          image: "{{ .Values.backend.image.repository }}:{{ .Values.backend.image.tag }}"
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          command: ["node", "dist/permit/sync-permit-schema.js"]
          env:
            - name: NODE_ENV
              value: "production"
            - name: PERMIT_API_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ include "fuzefront.secretName" . }}
                  key: PERMIT_API_KEY
            # Schema sync targets the Permit cloud API, not the PDP, but the
            # config module requires the var to be present at import.
            - name: PERMIT_PDP_URL
              value: "http://fuzefront-permit-pdp:7000"
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits:   { cpu: 250m, memory: 256Mi }
{{- end }}
```

- [ ] **Step 2: Verify the Job renders only when enabled**

Run: `helm template fuzefront deploy/helm/fuzefront | grep -c 'permit-schema-sync'`
Expected: `0`.

Run: `helm template fuzefront deploy/helm/fuzefront -f deploy/helm/fuzefront/values-prod.yaml --show-only templates/permit-schema-job.yaml | grep -E 'kind: Job|helm.sh/hook:|sync-permit-schema.js'`
Expected: shows `kind: Job`, the `post-install,post-upgrade` hook, and the `node dist/permit/sync-permit-schema.js` command.

- [ ] **Step 3: Commit**

```bash
git add deploy/helm/fuzefront/templates/permit-schema-job.yaml
git commit -m "feat(helm): run idempotent Permit schema-sync as post-install/upgrade hook"
```

---

### Final verification (manual, needs a real Permit key)
1. With a real `PERMIT_API_KEY` in `fuzefront-secrets`, deploy locally on kind with `--set permit.enabled=true`.
2. Confirm the PDP pod is `Ready` (`kubectl -n fuzefront get pods -l app.kubernetes.io/component=permit-pdp`).
3. Confirm the schema-sync Job `Completed` and its logs show `Permit resource created/updated` for `Organization`, `App`, `UserManagement` and roles `admin`, `editor`, `viewer`.
4. In the Permit dashboard, verify the three resources + three roles exist with the expected actions/permissions.
5. Smoke-test end-to-end: sync a user, create a tenant, assign role `admin`, then call `checkPermission({ user, action: 'read', resource: { type: 'Organization', tenant } })` → `true`.

## Self-review notes
- **Spec coverage:** covers the spec's "Permit PDP in chart" + "Permit policy schema as IaC" items. Resources/actions/roles match `permission-check.ts` and `role-assignment.ts` exactly.
- **No placeholders:** the only non-literal is the PDP image tag, which has an explicit pin-and-verify step (Task 2 Step 2).
- **Type consistency:** `PermitSchemaClient`, `permitSchema`, `syncPermitSchema` names are consistent across `schema.ts`, `sync-permit-schema.ts`, and the test.
