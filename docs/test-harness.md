# Local Integration Test Harness

`docker-compose.test.yml` brings up a self-contained environment for
running integration and email end-to-end tests without touching production
infrastructure.

## Services

| Service            | Port(s)        | Purpose |
|--------------------|----------------|---------|
| `postgres-test`    | 5433           | Postgres 15 for backend integration tests |
| `kafka-test`       | 9094 (external)| KRaft Kafka (no ZooKeeper) |
| `mailhog`          | 1025 (SMTP), 8025 (Web UI) | Email sink; inspect received mail at http://localhost:8025 |
| `permit-pdp-test`  | 7767           | Permit.io PDP in offline mode |
| `email-service-test`| 3004          | email-service wired to MailHog |

## Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin) >= v24
- Root workspace deps installed: `npm ci` from repo root

## Start the harness

```bash
docker compose -f docker-compose.test.yml up -d
```

Wait for all services to become healthy:
```bash
docker compose -f docker-compose.test.yml ps
```

## Run the email integration test

```bash
cd services/email-service
KAFKA_BROKERS=localhost:9094 MAILHOG_API=http://localhost:8025 npm test
```

Open http://localhost:8025 to see received emails in the MailHog web UI.

## Run the backend integration tests

```bash
DB_HOST=localhost DB_PORT=5433 DB_NAME=fuzefront_platform_test \
  DB_USER=postgres DB_PASSWORD=postgres \
  PERMIT_API_KEY=${PERMIT_API_KEY:-ci-noop} \
  PERMIT_PDP_URL=http://localhost:7767 \
  cd backend && npm run test:integration
```

## Tear down

```bash
docker compose -f docker-compose.test.yml down -v
```

## CI

The `email-integration` job in `.github/workflows/ci.yml` starts the
harness, runs `services/email-service npm test`, and tears down automatically.

## Authentik SMTP wiring (Helm/kind)

To wire Authentik email verification to MailHog locally, set in a gitignored values file:

```yaml
authentik:
  smtp:
    host: "mailhog-service-name-or-ip"
    port: 1025
    from: "noreply@fuzefront.dev"
```

For production, set `secret.smtpPassword` and `authentik.smtp.*` to your
real SMTP provider values. For SendGrid: host `smtp.sendgrid.net`, port `587`,
username `apikey`, password = your SendGrid API key.
