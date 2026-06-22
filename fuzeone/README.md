# FuzeOne — family onboarding toolkit

**FuzeOne** is the product family. **FuzeFront** (this repo) is its **app-of-apps host/framework**: the
app layer fuses *inside* the FuzeFront shell. **FuzeInfra** is the shared infrastructure layer *below*.
This `fuzeone/` toolkit installs the **family SDLC standard** into any repo joining the family — the
single source of truth lives here, in the hub.

## What gets installed

| File(s) | What | Update model |
|---|---|---|
| `.claude/agents/*` (6 + README) | Single-responsibility domain agents (`contract-designer` → backend/frontend/test/devops/docs) with the honest-"done" contract | synced (copy) |
| `CLAUDE.md` `<!-- FUZEONE -->` region | The committed family SDLC (so the team + GitHub-runner `@claude` + this repo all see it) | synced (region merge) |
| `.npmrc` | `@fuzefront/*` resolve privately from GitHub Packages | synced (template) |
| `.github/workflows/claude.yml`, `claude-auto-pr.yml`, `auto-merge.yml` | `@claude` handler, issue→draft-PR autonomy, merge-on-green | synced, self-contained |
| `.github/workflows/claude-ci-autofix.yml`, `telegram-pr-merged.yml` | CI-failure→Claude autofix, merge notifications | **reusable** — call `izzywdev/AITools` (central fixes propagate) |
| `.github/workflows/helm-validate.yml` | helm lint + kubeconform | synced, only if `deploy/helm/` exists |
| `.github/workflows/infra-dispatch.yml` | declare infra → FuzeInfra reconciles (repository_dispatch) | synced, only if `deploy/terraform/` or `deploy/argocd/` exists |

This is the **hybrid** model: workflows whose logic benefits from central updates are thin callers of
the family reusable workflows in `izzywdev/AITools`; everything else is a local file `fuzeone sync`
re-stamps. Re-run sync to pick up new standard versions.

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

## Required secrets (sync prints the applicable set)
- `ANTHROPIC_API_KEY` — `@claude` handler + CI autofix.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — merge notifications (optional).
- `FUZEINFRA_DISPATCH_TOKEN` — only if the repo declares infra; fires the FuzeInfra dispatch.

Never paste a secret into chat or a commit. Use `gh secret set NAME` (hidden prompt) or
`gh secret set NAME < file` from a gitignored file.

## Drift / updates
`node fuzeone/sync.mjs --target . --check` reports drift (exit 1 if any). Re-run without `--check` to
update. The `manifest.json` is the contract of managed files + `fuzeoneVersion`.
