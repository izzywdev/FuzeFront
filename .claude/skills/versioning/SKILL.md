---
name: versioning
description: Use whenever you change a published package, an API/event contract, or cut a release/deploy — the family SemVer discipline gated by gate-version. How to bump npm package versions (Changesets / Conventional Commits), version API contracts (info.version + oasdiff for breaking changes), tag releases, and the no-prod-deploy-without-a-version-bump rule. Standard: governance/versioning.md; owned by platform-governance.
---

# versioning

Per `governance/versioning.md`. **SemVer 2.0** everywhere; **`gate-version`** (Harden Gate) enforces it.

## Changing a published npm package
Bump `package.json` `version` per the change (`fix:`→patch, `feat:`→minor, breaking→major) **and** add a Changeset (`.changeset/*.md`). `gate-version` fails a PR that changes a package's source without a SemVer bump.

## Changing an API/event contract
Bump `info.version` (SemVer). Run **`oasdiff`** vs the base spec — a **breaking** diff REQUIRES a **MAJOR** bump. Keep the generated `@fuzefront/<svc>-client` version in lockstep. `gate-version` fails an unbumped contract change.

## Releasing / deploying to prod
Cut a **SemVer git tag `vX.Y.Z`**; tag the image with it (**no `latest` in prod**). FuzeDeploy/GitOps deploys only a SemVer-tagged image; the prod values image-tag bump references the new version. **Never** hand-deploy or deploy `latest`/untagged to prod (prod is GitOps).

## Tooling
Changesets (versioning + changelog) · `oasdiff` (breaking-change classification) · Conventional Commits (level inference) · `semver` validation.

## Done
`gate-version` green; changed package/contract versions bumped + valid SemVer; release SemVer-tagged; prod references a versioned image.
