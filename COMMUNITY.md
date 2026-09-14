# FuzeFront Community

FuzeFront is the application layer of the Fuze Software Factory: an AI-native platform for planning, building, governing, deploying, integrating, and operating software products on a shared foundation.

This repository is open to developers, platform engineers, engineering managers, CTOs, founders, and teams who want to test the architecture in real workloads.

## How to get involved

### Try the platform

Start with the README and the local Kubernetes flow. If something is confusing, brittle, missing, or slower than it should be, open an issue. Friction reports are useful contributions.

### Review the architecture

We actively want technical criticism of the Software Factory model, especially around:

- runtime application registration;
- module federation boundaries;
- multi-repository SDLC governance;
- Kubernetes and GitOps architecture;
- security and tenancy boundaries;
- developer experience and onboarding;
- observability and operational ownership;
- where AI agents should and should not be trusted.

Use the Architecture Review issue template to challenge assumptions and propose alternatives.

### Become a design partner

We are looking for teams willing to test FuzeFront against a real product or internal platform use case.

A useful design partner may be:

- a startup trying to launch multiple products with a very small team;
- an engineering organization standardizing how internal apps are delivered;
- a platform team looking for a reusable application shell and shared runtime;
- a CTO experimenting with agentic SDLC and AI-assisted software delivery;
- an agency or software studio that repeatedly rebuilds the same product infrastructure.

Open a Design Partner issue with the shape of your environment and what you would want to prove.

### Contribute code

See [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused PRs are preferred. Good contributions include documentation fixes, onboarding improvements, reproducible bug reports, integration examples, tests, security improvements, and developer-experience work.

## Community principles

- Evidence beats hype. If a claim is not true in production, say so.
- Reproducibility matters. Bugs should include enough information for someone else to reproduce them.
- Architecture is debatable. Strong technical disagreement is welcome when it is specific and constructive.
- AI-generated code is not exempt from engineering standards.
- Production safety, security, and maintainability win over demo speed.

## What we want to learn publicly

The project is testing a larger thesis: can a small team create and operate substantially more software by turning repeated company-level work into reusable platform capabilities?

That means the community is not only here to consume a finished product. We want developers and engineering leaders to help pressure-test the model itself.

If you can break an assumption, expose a missing layer, improve an integration path, or prove a workload the platform can support, that is valuable.

## Start here

- Read the main [README](README.md)
- Read the [Software Factory architecture](docs/SOFTWARE_FACTORY.md)
- Open an Architecture Review issue
- Apply as a Design Partner through the issue template
- Browse open issues and contribute a focused PR

The goal is to build a real engineering community around the platform, not a passive audience around a marketing page.
