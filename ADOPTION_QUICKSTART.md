# FuzeFront Adoption Quickstart

This guide is for developers and teams evaluating FuzeFront as a real platform component rather than just reading about the architecture.

## Pick your path

### 1. Developer: run the platform locally

```bash
npm run install:all
npm run db:init
npm run db:seed
npm run demo
```

Then inspect the runtime app registry, the example federated application, health updates, routing, and the integration SDK.

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

## Contribute

Look for issues labeled `good first issue`, `help wanted`, `community`, or `adoption`.

Small fixes are welcome. Documentation, examples, integration adapters, developer-experience improvements, tests, reproducible bug reports, and architecture criticism are all useful contributions.

See `COMMUNITY.md` and `CONTRIBUTING.md` for the broader participation model.
