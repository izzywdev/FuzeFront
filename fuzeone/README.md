# FuzeOne — family onboarding toolkit

**FuzeOne** is the product family. **FuzeFront** (this repo) is its **app-of-apps host/framework**: the
app layer fuses *inside* the FuzeFront shell. **FuzeInfra** is the shared infrastructure layer *below*.
This `fuzeone/` toolkit installs the **family SDLC standard** into any repo joining the family — the
single source of truth lives here, in the hub.

## What gets installed

| File(s) | What | Update model |
|---|---|---|
| `.claude/agents/*` (11 + README) | Single-responsibility domain agents (`contract-designer` → backend/frontend/frontend-test/test/devops/docs + the integration & coordination hats: billing-payments / telephony / agile-manager / wordpress) with the honest-"done" contract | synced (copy); **prefer the user-level install below** |
| `CLAUDE.md` `<!-- FUZEONE -->` region | The committed family SDLC (so the team + GitHub-runner `@claude` + this repo all see it) | synced (region merge) |
| `.npmrc` | `@fuzefront/*` resolve privately from GitHub Packages | synced (template) |
| `.github/workflows/claude.yml`, `claude-auto-pr.yml`, `auto-merge.yml` | `@claude` handler, issue→draft-PR autonomy, merge-on-green | synced, self-contained |
| `.github/workflows/claude-ci-autofix.yml`, `telegram-pr-merged.yml` | CI-failure→Claude autofix, merge notifications | **reusable** — call `izzywdev/AITools` (central fixes propagate) |
| `.github/workflows/helm-validate.yml` | helm lint + kubeconform | synced, only if `deploy/helm/` exists |
| `.github/workflows/infra-dispatch.yml` | declare infra → FuzeInfra reconciles (repository_dispatch) | synced, only if `deploy/terraform/` or `deploy/argocd/` exists |

This is the **hybrid** model: workflows whose logic benefits from central updates are thin callers of
the family reusable workflows in `izzywdev/AITools`; everything else is a local file `fuzeone sync`
re-stamps. Re-run sync to pick up new standard versions.

## Installing the agents — two independent dimensions

The FuzeOne **engineer hats** (`.claude/agents/*`) can reach you two ways. You usually want **both**,
but they answer different questions:

| Dimension | Question it answers | Mechanism | Run |
|---|---|---|---|
| **Per machine** (user-level) | "I cloned a FuzeOne repo on a new laptop — how do I get the hats in *every* repo I open here?" | copies the hub's defs into `~/.claude/agents/` | `node fuzeone/install-user-agents.mjs` |
| **Per repo** (project-level) | "A brand-new repo wants to join the family with the standard SDLC + workflows" | `sync.mjs` stamps `.claude/agents/*` + workflows + CLAUDE region into the repo | `node fuzeone/sync.mjs --target .` |

**Why user-level is preferred for the hats:** the engineer hats are generic across the family, so
installing them once per machine (user scope) means *every* FuzeOne repo you open sees them — no
per-repo copies to duplicate and drift. The hub repo still **commits** the canonical defs under
`.claude/agents/`, so a fresh clone always carries the source of truth; the user-level install just
*promotes* them. (Claude resolves user-level + project-level agents both; project wins on a name clash.)

### New machine (first clone of any FuzeOne repo)
```bash
git clone https://github.com/izzywdev/FuzeFront        # or any family repo that carries fuzeone/
cd FuzeFront
node fuzeone/install-user-agents.mjs --check           # preview (writes nothing)
node fuzeone/install-user-agents.mjs                   # install/update ~/.claude/agents
#   or: fuzeone/bin/fuzeone.sh user-agents   (fuzeone\bin\fuzeone.ps1 user-agents on Windows)
```
Re-run after pulling new agent defs. Set `CLAUDE_HOME` to target a non-default Claude home.

### New repo joining the family
Run the repo sync (below) for the workflows/CLAUDE-region/npmrc, **and** make sure the hats are
installed at user level once on that machine (above). With the user-level install present a member
repo does not need its own `.claude/agents/` copies — though `sync.mjs` will still stamp them if you
prefer a fully self-contained clone.

## How to onboard a repo

**The easy way — just ask the expert agent** (it's globally available in any repo):
> "Hi, I'm a new repo `FuzePlan` joining the FuzeOne family — set me up as a member of the FuzeFront
> system and ready to work in the proper SDLC."

`fuzefront-expert` runs the onboarding flow below and opens a "Join FuzeOne" PR.

**The manual way** — from a checkout of this hub, target another repo:
```bash
# 1. fetch the hub toolkit (or use your existing FuzeFront checkout)
git clone --depth 1 https://github.com/izzywdev/FuzeFront /tmp/fuzeone-hub

# 2. preview what would change in the target repo (writes nothing)
node /tmp/fuzeone-hub/fuzeone/sync.mjs --target /path/to/FuzePlan --check

# 3. apply
node /tmp/fuzeone-hub/fuzeone/sync.mjs --target /path/to/FuzePlan
#    options: --scope @fuzefront  --hub izzywdev/FuzeFront  --hub-ref v1  --repo FuzePlan  --dry-run
```
Then set the repo secrets it lists (`gh secret set …`), commit on a branch, and open a PR.

## Engineer hats: install once at USER level (recommended)
The engineer "hats" are generic across the family, so install them **once per machine** at the user
scope (`~/.claude/agents/`) instead of copying them into every member repo. The hub repo still commits
the canonical defs under `.claude/agents/` (so they travel with a fresh clone and stay version-
controlled) — this step just promotes them to the user scope, where every repo you open sees them:

```bash
# from a checkout of the hub (this repo):
node fuzeone/install-user-agents.mjs --check     # preview drift, writes nothing
node fuzeone/install-user-agents.mjs             # install/update ~/.claude/agents
fuzeone/bin/fuzeone.sh user-agents               # same, via the shim
```
Set `CLAUDE_HOME` to install under a non-default Claude home. Re-run after pulling new agent defs.
The per-repo `.claude/agents/*` sync entries above remain for repos that prefer self-contained clones;
with the user-level install you can rely on the user scope and skip per-repo copies.

## Required secrets (sync prints the applicable set)
- `ANTHROPIC_API_KEY` — `@claude` handler + CI autofix.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — merge notifications (optional).
- `FUZEINFRA_DISPATCH_TOKEN` — only if the repo declares infra; fires the FuzeInfra dispatch.

Never paste a secret into chat or a commit. Use `gh secret set NAME` (hidden prompt) or
`gh secret set NAME < file` from a gitignored file.

## Drift / updates
`node fuzeone/sync.mjs --target . --check` reports drift (exit 1 if any). Re-run without `--check` to
update. The `manifest.json` is the contract of managed files + `fuzeoneVersion`.
