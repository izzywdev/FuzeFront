# FuzeFront Help Center — content source of record

This directory is the **single source of truth** for the in-app help system served at
`https://app.fuzefront.com/help`. It is content-driven: the help UI
(`frontend/src/pages/HelpPage.tsx`) and anything else that surfaces help (the Developer Portal,
onboarding emails) read from this tree, so a fact is written **once** here and never duplicated
into a React component.

## Layout

```
docs/help/
  manifest.json          index of record — sections → articles (nav order)
  manifest.schema.json   JSON Schema for manifest.json
  user-guide/*.md        end-user articles (audience: user)
  developer-guide/*.md   builder articles (audience: developer)
  _assets/               screenshots and other committed media (see _assets/README.md)
```

## Rules (summary — the full policy is governance/help-system-policy.md)

- Every article carries YAML frontmatter: `title`, `description`, `audience`, `order`, `owner`,
  `lastReviewed`, `status`. See the policy for the contract.
- **No placeholders in a `status: published` article** — no `TODO`/`TBD`, no dead links, no fake
  credentials, no `localhost` URLs. Draft-only content uses `status: draft`.
- Content must be **accurate to the current platform**: product name is FuzeFront, auth is
  Authentik SSO + Permit, deploy is Kubernetes/Helm/Argo (GitOps), packages are `@fuzefront/*`.
- `manifest.json` and the files on disk must agree **both ways** — no orphan files, no dangling
  nav entries.

## Enforcement

`gate-help-conformance` (`.github/workflows/gate-help-conformance.yml` →
`scripts/check-help-conformance.mjs`, config in `governance/help-system-policy.json`) runs on every
PR that touches this tree or `HelpPage.tsx` and fails the build on any violation.

## Authoring

Use the `help-system` skill (`.claude/skills/help-system/`) — it carries the article template,
the media standard, the voice/tone rules, and the pre-merge checklist. Run the gate locally before
pushing:

```bash
node scripts/check-help-conformance.mjs --all
```
