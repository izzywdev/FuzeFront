# FuzeFront Adoption Quickstart

This guide is for developers and teams evaluating FuzeFront as a real platform component rather than just reading about the architecture.

## Pick your path

### 1. Developer: run the platform locally

The self-contained local stack is `docker-compose.e2e.yml` — the same one CI runs. It brings up Postgres, Redis, Authentik (identity), the backend, the security service and the shell, with no secrets or `.env` values required. Database migrations run automatically when the backend starts.

**Prerequisites:** Git, Docker Desktop (running), and Node.js 24+ / npm 10+ for the example app. Ports `3001`, `3002`, `4173` and `9000` must be free.

**1. Start the stack** (the first build takes several minutes):

```bash
git clone https://github.com/izzywdev/FuzeFront.git
cd FuzeFront
docker compose -f docker-compose.e2e.yml up -d --build
docker compose -f docker-compose.e2e.yml ps
```

Success: `postgres`, `redis`, `backend`, `security` and `authentik-worker` report `(healthy)`. `authentik-server` and `frontend` can take another minute or two.

**2. Sign in.** Open http://localhost:4173 and choose **Create an account**. The password must be at least 12 characters and include uppercase, lowercase, a digit and a symbol. "Sign in with Google" is not configured in the local stack.

**3. Run the example federated app.** `clock-app` is served from your machine and registered in the platform database, the same way CI does it (`.github/workflows/e2e.yml`). Keep the preview running in its own terminal:

```bash
cd clock-app
npm install
VITE_HUB_API_URL=http://localhost:3001 VITE_PUBLIC_URL=http://localhost:4174 npm run build
npx vite preview --port 4174 --host 0.0.0.0
```

On Windows PowerShell, set the variables first:

```powershell
cd clock-app
npm install
$env:VITE_HUB_API_URL = "http://localhost:3001"
$env:VITE_PUBLIC_URL  = "http://localhost:4174"
npm run build
npx vite preview --port 4174 --host 0.0.0.0
```

Then, from the repo root in a second terminal, register it (a single line, so it works in any shell):

```bash
docker compose -f docker-compose.e2e.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U e2e -d fuzefront_platform -c "INSERT INTO apps (name, url, remote_url, scope, module, integration_type, description, is_active) VALUES ('Clock','http://localhost:4174','http://localhost:4174/apps/clock','clockApp','./ClockApp','module-federation','on-the-fly clock',true) ON CONFLICT (name) DO NOTHING;"
```

Success: `INSERT 0 1`. Refresh http://localhost:4173, open **Clock** under **APPS** in the sidebar, and it mounts inside the shell showing "Mounted inside FuzeFront: yes" and your signed-in email. The dashboard itself may still say "No applications available"; use the sidebar.

From here, inspect the runtime app registry, the example federated application, routing, and the integration SDK.

**Stop:** `docker compose -f docker-compose.e2e.yml down`. Add `-v` to also delete the data (users, registered apps).

#### Troubleshooting

- **`postgres` exits with code 127** and `docker logs fuzefront-e2e-postgres-1` shows `env: can't execute 'bash\r'` (Windows): the shell scripts were checked out with CRLF line endings. On a clone made before `*.sh` was pinned to LF in `.gitattributes`, run `git config core.autocrlf input`, re-checkout with `git checkout -- deploy/e2e`, then `docker compose -f docker-compose.e2e.yml down -v` and `up -d` again.
- **After any failed first start, use `down -v`.** Postgres only runs its init script on an empty data volume.
- **`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`** (Windows): Docker Desktop isn't running. Start it and wait for "Engine running", for example after a reboot.
- **"Incorrect email or password" when creating an account:** the password didn't meet the policy above. Check `docker compose -f docker-compose.e2e.yml logs security` for the exact reason.
- **`clock-app` isn't listed after `npm run dev`:** the dev server doesn't produce `remoteEntry.js`, and self-registration from the browser is blocked in this stack. Use the build + preview + register steps above.

### 2. Platform engineer: run the Kubernetes path

```bash
cd FuzeInfra && make kind-up && cd ..

docker build -t fuzefront/backend:local ./backend
docker build -t fuzefront/frontend:local \
  --build-arg VITE_API_URL=http://fuzefront.dev.local ./frontend

kind load docker-image \
  fuzefront/backend:local \
  fuzefront/frontend:local \
  --name fuzeinfra

helm upgrade --install fuzefront deploy/helm/fuzefront \
  -n fuzefront --create-namespace \
  -f deploy/helm/fuzefront/values-local.yaml
```

### 3. Architecture reviewer: challenge the design

Read `docs/SOFTWARE_FACTORY.md`, then join the public architecture review:

https://github.com/izzywdev/FuzeFront/issues/1015

We specifically want concrete failure modes, security concerns, coupling problems, operational risks, and examples where an existing platform solves the problem better.

### 4. Design partner: bring a real workload

Open a Design Partner issue or start from:

https://github.com/izzywdev/FuzeFront/issues/1016

Useful evaluation cases include:

- a startup operating several products with a small team;
- a platform team standardizing app delivery;
- a software studio repeatedly rebuilding common infrastructure;
- a CTO testing governed AI-assisted delivery;
- an independent founder trying to maximize organizational leverage.

## What success looks like

For each real evaluation we want to capture:

- time to first successful local run;
- time to onboard an existing app;
- what manual work was eliminated;
- what still required custom integration;
- where the abstractions leaked;
- deployment and operational friction;
- security or governance concerns;
- whether a second application becomes materially easier than the first.

Want to turn that into a comparable, publishable number instead of an
anecdote? See [`docs/benchmarks/app-onboarding-benchmark.md`](benchmarks/app-onboarding-benchmark.md) —
a fixed procedure and results template for exactly the two bullets above
("time to onboard" and "second app vs. first").

## Contribute

Look for issues labeled `good first issue`, `help wanted`, `community`, or `adoption`.

Small fixes are welcome. Documentation, examples, integration adapters, developer-experience improvements, tests, reproducible bug reports, and architecture criticism are all useful contributions.

See `COMMUNITY.md` and `CONTRIBUTING.md` for the broader participation model.
