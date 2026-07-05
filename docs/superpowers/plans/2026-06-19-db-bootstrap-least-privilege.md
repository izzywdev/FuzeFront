# Plan A0 — DB bootstrap + least-privilege roles

## Problem

The backend connects to FuzeInfra Postgres as one role and conflates three
privilege tiers:

1. It `CREATE DATABASE`s itself at startup (`ensureDatabase` in
   `backend/src/config/database.ts`) — needs CREATEDB.
2. It creates/manages the `fuzefront_user` ROLE inside a schema migration
   (`backend/src/migrations/008_create_fuzefront_user.ts`) — needs CREATEROLE.
3. Migration 008 hardcodes the DB name `fuzefront_platform` in its `GRANT
   CONNECT ON DATABASE` statements, so it fails on any other DB name. This is
   what reds `backend-tests.yml` (runs against `fuzefront_platform_test`).

Migration 008 also hardcodes the `fuzefront_user` password as a literal.

## Goal — separate bootstrap (privileged, once) from runtime (least-privilege)

1. Helm `pre-install,pre-upgrade` **bootstrap Job** connects as the FuzeInfra
   Postgres superuser and idempotently: `CREATE DATABASE`, `CREATE ROLE
   fuzefront_user LOGIN PASSWORD …` + connect/usage/DML grants + ownership of
   the app schema (public).
2. Remove the `CREATE DATABASE` path from `ensureDatabase` (runtime no longer
   self-creates the DB; it only verifies reachability).
3. Delete migration 008. No migration does cluster-level role/DB management.
4. Runtime + migrations connect as least-privilege `fuzefront_user`.

## FuzeInfra superuser credential (research result)

- FuzeInfra Postgres is initialised with `POSTGRES_USER=fuzeinfra` /
  `POSTGRES_PASSWORD=fuzeinfra_secure_password` (chart
  `FuzeInfra/helm/fuzeinfra/values.yaml` → `credentials.postgres`). Because the
  container's `POSTGRES_USER` is `fuzeinfra`, **that role IS the cluster
  superuser** in the deployed StatefulSet (verified against the Helm
  `databases.yaml` + `secrets.yaml`).
- The creds are exposed in the **`fuzeinfra` namespace** as Secret
  `fuzeinfra-secrets` (keys `POSTGRES_USER` / `POSTGRES_PASSWORD`), overridable
  via `credentials.existingSecret`.
- K8s Secrets are namespace-scoped; FuzeFront installs into the `fuzefront`
  namespace, so the Job cannot `secretKeyRef` the `fuzeinfra` secret directly.
  → The chart gets explicit `database.bootstrap.superuser.*` values that name
  the secret + keys (default: the chart's own Secret, into which the operator
  supplies the superuser password). This keeps FuzeInfra generic (no FuzeFront
  role baked into it) and FuzeFront owns its bootstrap.

NOT BLOCKED: the superuser credential exists and is usable; the only nuance is
the cross-namespace boundary, handled via configurable secret refs.

## Tasks

- T1 (plan): this doc.
- T2 (backend, TDD): remove `CREATE DATABASE` from `ensureDatabase`; it becomes
  a connectivity/existence check that errors clearly if the DB is missing
  (bootstrap is responsible for creating it). Keep `waitForPostgres`.
- T3 (backend): delete migration 008 (+ its dist artifacts). Verify no other
  migration does role/DB DDL.
- T4 (helm): add `templates/db-bootstrap-job.yaml` (pre-install,pre-upgrade
  hook). Runs a small node/psql script as the superuser to CREATE DATABASE +
  CREATE ROLE + grants + schema ownership, idempotently. Add
  `database.bootstrap.*` values, wire runtime user to least-privilege
  `fuzefront_user`, add `DB_BOOTSTRAP_PASSWORD` to the Secret.
- T5 (values): switch `database.user` to `fuzefront_user`; add bootstrap block
  in `values.yaml` / `values-prod.yaml`.
- T6 (verify): `helm template`/`helm lint`; backend jest suite locally against a
  throwaway DB created out-of-band as superuser (proving runtime no longer needs
  CREATEDB/CREATEROLE).

## Test strategy

- Backend unit test asserting `ensureDatabase` no longer issues `CREATE
  DATABASE` and surfaces a clear error when the DB is absent.
- Full jest suite: pre-create `fuzefront_a0_test` DB + `fuzefront_user` as
  superuser, then run the suite as `fuzefront_user` to prove least-privilege
  runtime works end to end (migrations + seeds + auth/apps tests).
- `helm template -f values-local.yaml` and `-f values-prod.yaml` render the
  bootstrap Job correctly; `helm lint`.

## CI fix

Deleting migration 008 removes the hardcoded `fuzefront_platform` GRANT that
fails under `DB_NAME=fuzefront_platform_test`, making `backend-tests.yml` green.
