# FQ-149 workspace fidelity evidence

This QA workstream targets FQ-144. It does not establish acceptance of the parent
story's workspace topology or AST-based frontend inventory.

The executable fixture matrix lives in
`packages/scanner/src/workspace-fidelity.test.ts`. npm, pnpm, Yarn, and Nx layouts
each contain a web app and a design package. These fixtures test manifest-based
discovery, package ownership, absolute React Router literals, source revision,
parser version, diagnostics, counts, repeat-scan identity, and identity stability
after content changes. They do not invoke package-manager installs or Nx tooling.

Malformed manifests, empty repositories, explicit exclusions, and symlinked
external files/packages are also covered. Before the fix, the symlink fixture
returned five surfaces instead of one. Package/source discovery now excludes
symlinks and sorts paths to make repeat-scan surface ordering deterministic.
Scanner version is 1.2.1; catalog/config fingerprints and supplied source revisions
continue through the existing scan-details contract.

## Remaining acceptance gaps

Four `it.fails` cases assert desired behavior and reproduce unmet FQ-144
requirements. Vitest considers their expected failure successful execution;
**they are not passing acceptance tests**. Convert each to an ordinary test when
the corresponding implementation lands. An unexpected pass deliberately makes
the suite fail so the acceptance status must be updated.

| Fixture | Required result | Current heuristic result |
| --- | --- | --- |
| Comments, a navigation link, uppercase data, one component | 1 component | 5 surfaces: 4 false positives |
| Nested React Router relative child | 2 full routes | 1 route: child omitted |
| Two same-name components in one package | 2 distinct identities | 1 surface: identity collision |
| State keywords only in a comment | default state only | default plus 5 inferred states |

These findings block authoritative use of heuristic frontend totals for the
parent story. No semantic detector was promoted or new evidence class added by
this QA change. Existing heuristic behavior remains an explicit implementation
gap; the parent story must resolve its evidence contract before production
acceptance. No live dependency outage, installed-workspace resolution, browser
behavior, or production scan is claimed by this fixture matrix.

Run from `FuzeQuality` with its dependencies installed:

```sh
npx vitest run packages/scanner/src
```

## Changelog

1.2.1: exclude frontend symlinks, stabilize package/source discovery order, and
add workspace-fidelity fixtures with explicit parent-story acceptance gaps.
