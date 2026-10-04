# Per-service database + login role (data ownership pattern)

**Reference implementation:** `selection-list-service` (database `fuzefront_selection_list`, role `selection_list_svc`).
**Owner:** database-engineer (data tier). Deploy wiring: devops-engineer. Postgres itself: FuzeInfra.

## The pattern in one paragraph

Every microservice that owns data gets **its own database, owned by its own LOGIN role, with its own credentials in its own Secret**.
No such service runs as the shared `fuzefront_user` (`database.user`) for its own data, and the shared role is explicitly denied access to the service's database.
The role + database are created and reconciled **by a chart hook Job on every sync** from a password that is minted and sealed by a workflow, so no human ever sees or types the password.

```
sealed secret (DB_PASSWORD, minted+sealed in CI)
        |  decrypted by sealed-secrets controller -> Secret/selection-list-secrets
        v
pre-install/pre-upgrade Job  fuzefront-svcdb-selection-list-service   (superuser, idempotent psql)
   - role   selection_list_svc  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS, password := Secret
   - db     fuzefront_selection_list  OWNER selection_list_svc
   - REVOKE ALL ON DATABASE FROM PUBLIC and from fuzefront_user; assert nobody but the owner holds a privilege
   - public schema in that db: PUBLIC revoked, owned by selection_list_svc
        v
Deployment connects as selection_list_svc  (DB_HOST/PORT/NAME/USER/PASSWORD + DB_SSL; no DATABASE_URL)
   knex migrations run as the owner and can only DDL inside their own database
```

### Where it lives

| Piece | File |
|---|---|
| Registry of services using the pattern | `deploy/helm/fuzefront/values.yaml` -> `database.bootstrap.serviceDatabases` (list of values keys) |
| Per-service identity | `selectionListService.dbName`, `selectionListService.db.{role,secretName,passwordKey,ssl}` |
| Generic bootstrap Job (one per enabled entry) | `deploy/helm/fuzefront/templates/service-db-bootstrap-job.yaml` |
| Deployment env (reads the same values) | `deploy/helm/fuzefront/templates/selection-list-service-deployment.yaml` |
| Secret shape + go-live notes | `deploy/contabo/sealed/selection-list-service-secrets.yaml.template` |
| Mint+seal workflow | `.github/workflows/rotate-sealed-secret.yml` |

Nothing renders while `selectionListService.enabled` is `false` (rendered output of `values.yaml`, `values-local.yaml`, `values-prod.yaml` is byte-identical to before the change).

## Providing the password (first time) - no human sees it

The sealing key is cluster-side, so this is done by the **dispatchable workflow**, which generates the value from `openssl rand` inside the run, seals it offline against the committed public cert (`deploy/sealed-secrets/sealing-cert.pem`), and opens a PR containing ciphertext only:

```bash
gh workflow run rotate-sealed-secret.yml \
  -f scope=fuzefront/selection-list-secrets \
  -f key=DB_PASSWORD \
  -f manifest=deploy/contabo/sealed/selection-list-secrets.yaml
```

Then review + merge the PR it opens (not auto-merge-labelled on purpose: `master` is deploy-on-push). Argo's `fuzefront-sealed` app applies `deploy/contabo/sealed/`, and the controller decrypts it into `Secret/selection-list-secrets` (`DB_PASSWORD`).
The generated value is 64 hex characters (URL/shell/SQL-safe; the Job additionally handles arbitrary characters, verified with quotes, backslashes and `$`).

**Order matters (two merges):**
1. merge the sealed secret; 2. later, flip `selectionListService.enabled: true`.
The bootstrap Job is a `pre-upgrade` hook and runs *before* the `fuzefront-sealed` app is applied. Enabling both in one change makes the Job fail on a missing Secret, which fails the whole `fuzefront` sync. (The Job prints an explicit FATAL if the password is empty.)

## Rotation

1. Re-dispatch the workflow above (same inputs). It generates a new value and re-seals `DB_PASSWORD` in place; merge the PR.
2. **Sync the `fuzefront` Argo Application** (a manual sync/refresh is enough; the Secret change alone does not trigger the chart's hook). The pre-sync Job runs `ALTER ROLE ... PASSWORD` with the new value.
3. **Then** restart the service pods (`kubectl rollout restart deploy/fuzefront-selection-list-service` via your GitOps/ops path). Pods read the Secret only at start.

Do not restart pods between step 1 and step 2: a restart in that window reads the new password while the role still has the old one, so it would fail to authenticate until the Job runs. Pooled connections opened before the change keep working until pods restart.
Verified locally: after the Job re-runs with a new password, the old password is rejected and the new one authenticates; data is untouched.

## Adding the next service

1. Give the service's values block (e.g. `billingService`) `enabled`, `dbName`, and `db: {role, secretName, passwordKey}` (copy the `selectionListService.db` block; `ssl` only if the service reads `DB_SSL`).
2. Append the values key to `database.bootstrap.serviceDatabases`.
3. In its Deployment use `DB_HOST/PORT` from `fuzeinfra.postgres`, `DB_NAME` <- `<svc>.dbName`, `DB_USER` <- `<svc>.db.role`, `DB_PASSWORD` <- secretKeyRef `<svc>.db.secretName/passwordKey`. Do not read the chart Secret's `DB_PASSWORD`.
4. Dispatch the sealing workflow for `fuzefront/<svc>-secrets` / `DB_PASSWORD` / `deploy/contabo/sealed/<svc>-secrets.yaml`; merge. Then enable the service.
5. Do **not** add the database to `EXTRA_DATABASES` in `db-bootstrap-job.yaml` - that mechanism creates a database owned by the *shared* role, which is exactly what this pattern replaces.

Services that predate this (backend, chat, notification, devportal, authentik via `EXTRA_DATABASES`; billing/config via their own role + schema in the shared DB) are **not** migrated by this change. Moving them is a data migration with its own cutover and is a separate piece of work per service.

## Threat model / why

| Concern | How the pattern addresses it |
|---|---|
| **Blast radius** | A SQL-injection or leaked credential in one service reaches only that service's database. The role cannot `CREATEDB`/`CREATEROLE`/replicate, is not superuser, and has no grant on any other service's data. |
| **Least privilege for migrations** | The service runs knex migrations at startup, so its role must be able to DDL - but only inside its own database, which it owns. Superuser is used only by the hook Job. |
| **No PUBLIC access** | Postgres grants `CONNECT` on every new database to `PUBLIC`. The Job revokes it, revokes the shared `fuzefront_user`, and fails the sync if any grantee other than the owner holds a privilege (verified). |
| **Independent rotation** | The password lives in its own Secret and is reconciled by the Job on every sync, so rotating one service never touches the shared `DB_PASSWORD` or any other service. Drift (a CREATEDB flag, a stray grant) is also repaired on each sync (verified). |
| **Nobody handles the secret** | Minted with `openssl rand` and sealed inside a workflow run; the Job reads it from the environment (not argv), disables statement/error-statement logging for the session, never uses `set -x`. Verified: the password never appears in the Postgres server log. |
| **Auditability** | Role, database, grants and the Job SQL are all in git and reviewable; Postgres logs show the real service identity (`selection_list_svc`) instead of a shared one. |

## Known limits / follow-ups (not fixed here)

- **Other databases still allow `CONNECT` via `PUBLIC`.** Verified locally: `selection_list_svc` can still `\c` into `fuzefront_platform` (default PUBLIC CONNECT), though it holds no table privileges there. Closing that means revoking PUBLIC CONNECT on every pre-existing database after confirming each owner role has an explicit grant - it touches other services and belongs in its own change (FuzeInfra-side default for new databases is the durable fix; delegate via `@fuze`).
- **Migrations run at app start** (`src/index.ts` -> `runMigrations`), not in a pre-sync Job. With `replicas: 1` this is safe (knex takes its lock table); raising replicas should move migrations to a hook/init step. Service code is out of this slice.
- **TLS to Postgres is UNVERIFIED.** The service's production knexfile defaults to `ssl: true` (verified certs). The chart sets `DB_SSL` from `selectionListService.db.ssl` (`"true"`). Whether the shared FuzeInfra Postgres serves TLS with a certificate this client trusts could not be checked from here; if the pod logs "server does not support SSL" or a certificate error, set `db.ssl: "false"` (one reviewable line) or have FuzeInfra provide a trusted cert.
- **Postgres server version on FuzeInfra is UNVERIFIED.** The Job uses the `postgres:15` client image (same as the billing/config bootstrap Jobs); the SQL was exercised against PostgreSQL 16 and uses nothing newer than PG12 features. The pre-15 `public` schema default (PUBLIC may CREATE) is handled by reasoning only (explicit `REVOKE ... FROM PUBLIC` + owner change), not exercised - only PG16 was available.
- **`check-job-interpreters.sh` could not be run locally** (needs a Docker daemon); the Job uses `postgres:15` + `/bin/sh`, identical to the existing billing/config bootstrap Jobs.
