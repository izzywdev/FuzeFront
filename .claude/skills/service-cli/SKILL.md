---
name: service-cli
description: Use when building/maintaining a microservice CLI. Conventions for command design, output contracts, and CI safety.
---

# service-cli

Conventions: noun-verb command tree; `--json` machine output alongside human output; non-zero exit on error; no interactive prompts when stdin/stdout is piped; generate commands/types from the service contract; shell completion. Owned by cli-engineer.

*(Structured stub — flesh out with concrete commands/checks as the first repo adopts it.)*
