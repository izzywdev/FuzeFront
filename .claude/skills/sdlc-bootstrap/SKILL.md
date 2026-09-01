---
name: sdlc-bootstrap
description: Use to onboard a repo onto the FuzeSDLC standard in one pass: install the agent subset from the repo manifest, community files, hardening + automation, the CLAUDE.md overlay, and (apps) the inherited design system + channels.
---

# sdlc-bootstrap

Brings a repo onto the canonical standard. Reads `.fuze/manifest.json` (schema: `governance/repo-manifest.schema.json`).

## Incremental script (re-runnable)

The mechanical steps are executed by **`scripts/sdlc-bootstrap.sh`** — **idempotent + incremental**: it adds/updates only what is missing or stale, so you can update the script once and re-run it on every already-onboarded repo to pick up new pieces (e.g. the `governance-sync` caller + the `FUZESDLC_DEPLOY_KEY` read-key) **without redoing onboarding**. Run it from a cloned consuming repo:

```bash
scripts/sdlc-bootstrap.sh --canonical <FuzeSDLC-checkout> --repo . --set-secret
```

It stamps the standard workflow stack incl. the **`governance-sync.yml` caller** (ref-pinned to the manifest's `baselineRef`), reconciles the agent subset, and — when the manifest declares **`roles`** — stamps the **agent-templates framework** (`schema`/`roles/_base`/`sync`/`providers`) + the **`provision-sync.yml`** caller (see the `managed-agents-roles` skill). With `--set-secret` it sets the **read-only `FUZESDLC_DEPLOY_KEY`** repo secret (value from `$FUZESDLC_DEPLOY_KEY`). Concrete role/env/vault definitions stay the repo's own. The steps below cover the judgement parts the script leaves to you (authoring `<repo>-expert`, class-specific license, chart scaffold, hardening).

## Steps
1. **Manifest** — write/validate `.fuze/manifest.json` (tier, required `<repo>-expert`, agent subset, opt-in channels, designSystem, hardening, **`platformServices`** spine integration points + **`dependsOn`/`providesTo`** product deps — `governance/platform-services.md`).
2. **Agents** — copy the manifest's agent subset (incl. the `<repo>-expert`, authored if absent) from `FuzeSDLC/agents/` into the repo `.claude/agents/`. No dangling expert references. **Also install the ADVISOR experts** so agents consult them instead of reading another product's source (baseline §2): the **spine experts `fuzefront-expert` + `fuzeinfra-expert` ALWAYS**, plus the **`<dependsOn>`-product experts** (from the manifest's `dependsOn` — e.g. a repo that `dependsOn` FuzeContact/FuzeBI/FuzePlan installs `fuzecontact-expert`/`fuzebi-expert`/`fuzeplan-expert`). Advisor experts are consulted, not owners. The **`<repo>-expert` MUST encode** (per `governance/platform-services.md` + `cross-product-feature-requests.md`): the 7 spine services + this product's integration point for each, its `dependsOn`/`providesTo`, and how to **issue and receive** a cross-product feature request (owner path: plan→FuzePlan, develop→FuzeAgent, deploy→FuzeDeploy, notify). **Model-tier defaults arrive with the copied agent files** — each agent's `model:` frontmatter field is canonical in FuzeSDLC; don't hand-edit it per repo (use the optional `modelCascade` manifest override instead).
3. **Skills** — install the canonical skills the agent subset references, **including `model-cascade`** (tiered execution); reference `governance/model-cascade.md` for the policy/rubric. The runtime loads each agent's `skills:` allowlist.
4. **CLAUDE.md overlay** — thin file pointing at the FuzeSDLC baseline + repo tier/expert + only repo-specific rules.
5. **Community files** — shared ones (`CODEOWNERS`, `CODE_OF_CONDUCT.md`, PR/issue templates, `dependabot.yml`) from `community-templates/`; and the **class-specific** `LICENSE`/`CONTRIBUTING.md`/`SECURITY.md` (+ `NOTICE` for commercial) from `community-templates/<class>/` where `<class>` = the manifest's `class` (`oss/` or `commercial/`). **A `commercial-private` repo gets the proprietary LICENSE + NOTICE — never MIT** (see `governance/repo-classes.md`). Don't overwrite an existing, intentionally-different LICENSE without flagging.
6. **Automation + gate** — from `workflow-templates/` (incl. `governance-nightly.yml` for the nightly reconciliation sweep **and `nightly-integration.yml`** for nightly integration tests + draft-PR auto-fix — give each repo a **staggered cron minute** so the fleet doesn't thunder). Ensure the **`@claude` handler (`claude.yml`) + the agent set are installed** so the nightly's `@claude` build-issue is answerable (a hard prerequisite); ensure `ANTHROPIC_API_KEY` secret + `allow_auto_merge=true` + `delete_branch_on_merge=true`; add `.github/dependabot.yml` (github-actions).
7. **Starter Helm chart** — scaffold `helm/<repo>/` from `community-templates/chart/` (substitute `NAME` → the repo's lowercase name) so `helm-validate` + `gate-localup`'s chart step pass from day one. The starter is **`enabled: false`-gated** — it lints and renders to nothing until the real service exists (CLAUDE.md "enabled gate"); `devops-engineer` replaces it with the real Deployment+Service+values when FuzeDeploy ships the service. **A repo with NO chart fails `helm-validate` — never skip this.**
8. **Harden** — run the `repo-hardening` skill.
9. **Apps** — depend on `@fuzefront/design-system`, scaffold the local extension package, enable the `design-system-inheritance` CI check; install opted-in channel agents + packaging skills.
10. **Propagation wiring** (`governance/agent-ownership.md`) — stamp the **`governance-sync.yml`** shim (every repo) so each PR reconciles to the newest policy at CI time, and set the read-only **`FUZESDLC_DEPLOY_KEY`** secret it uses (min-privilege: read to FuzeSDLC only). Stamp **`publish-expert.yml`** so the repo proposes its OWN `<repo>-expert` to the hub as an `agent-sync/<slug>` PR (needs **`FUZESDLC_AGENT_PUSH_TOKEN`**, a fine-grained PAT scoped to FuzeSDLC only); the hub's `agent-sync-guard` scope-checks it before merge. If the manifest declares **`roles`**, also stamp the **agent-templates framework** + the LOCAL **`provision.yml`** + **`provision-sync.yml`** (`managed-agents-roles` skill). All stamped workflows are **self-contained** — never add a cross-repo `uses:` into the private FuzeSDLC: it fails to resolve and reds the whole run. `scripts/sdlc-bootstrap.sh` does all of this incrementally.

## Verify
The repo's `.claude/agents` matches the manifest; `CLAUDE.md` resolves; ruleset active; gate green; (apps) DS check wired. See `governance/onboarding-consuming-repo.md`.
