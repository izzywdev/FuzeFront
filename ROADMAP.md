# FuzeFront Public Roadmap

FuzeFront is the application/runtime layer of the broader Fuze Software Factory. This roadmap is intentionally public: it is meant to help adopters, contributors, platform engineers, CTOs, and design partners see what the project is trying to prove next.

The roadmap is organized around evidence, not feature volume.

## What we need to prove

### 1. A new developer can get productive quickly

We need a newcomer to be able to understand the architecture, run the project, register an application, and contribute without private context.

Success looks like:
- clean quickstarts on Windows, Linux, and macOS;
- copy-paste integration examples;
- clear failure diagnostics;
- documented boundaries and non-goals;
- small, reviewable first contributions.

### 2. External applications can onboard without platform surgery

FuzeFront should make adding an application a contract/integration problem rather than a central-shell rewrite.

Success looks like:
- stable registration contracts;
- working Module Federation, iframe, and Web Component examples;
- predictable auth/routing/health behavior;
- app onboarding that does not require rebuilding the platform shell.

### 3. The platform works under real workloads

Design-partner integrations are more important than synthetic demos.

Success looks like:
- external teams running real applications;
- documented integration friction;
- production-oriented deployment evidence;
- measurable reductions in repeated platform work;
- public case studies where partners permit them.

### 4. The Software Factory model compounds

The core thesis is not that one app is easier to build. It is that each additional app should inherit more reusable capability than the previous one.

Success looks like:
- reusable onboarding templates;
- reusable SDLC and governance;
- reusable infrastructure and deployment;
- reusable observability and operational integrations;
- declining manual effort per additional product.

### 5. Community becomes part of the development loop

The project should not depend on one maintainer defining every requirement.

Success looks like:
- external issues and architecture reviews;
- external PRs;
- repeat contributors;
- public design discussions;
- community-proposed integrations and examples.

## Near-term priorities

- Harden the public Adoption Quickstart.
- Add minimal integration examples for all supported app modes.
- Improve troubleshooting and first-run diagnostics.
- Publish explicit architectural boundaries/non-goals.
- Recruit design partners with real workloads.
- Add community-owned examples and adapters.
- Improve accessibility and RTL developer guidance.
- Make the repository easier to evaluate without private Fuze context.

## Medium-term priorities

- Reduce application onboarding to a more automated, repeatable flow.
- Improve multi-tenant and team-oriented platform capabilities.
- Strengthen runtime observability and integration diagnostics.
- Expand standardized product templates.
- Create measurable platform/adoption benchmarks.
- Publish real workload case studies.
- Make cross-repository Software Factory governance more visible without exposing proprietary internals.

## Long-term direction

The long-term goal is a governed, AI-native Software Factory in which a very small team can repeatedly move from product intent to running software using shared planning, SDLC policy, agent orchestration, deployment, infrastructure, runtime, and business capabilities.

The metric that matters is organizational leverage: how much reliable product output can be created and operated per person as the platform compounds.

## Get involved

- Start with the [Adoption Quickstart](docs/ADOPTION_QUICKSTART.md).
- Read the [Software Factory architecture](docs/SOFTWARE_FACTORY.md).
- Join the [Architecture Review](https://github.com/izzywdev/FuzeFront/issues/1015).
- Apply as a [Design Partner](https://github.com/izzywdev/FuzeFront/issues/1016).
- Pick a newcomer-friendly issue from the [open issues](https://github.com/izzywdev/FuzeFront/issues).

If you think this roadmap prioritizes the wrong proof points, open an issue and argue for a better one.
