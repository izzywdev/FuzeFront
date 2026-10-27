---
name: help-system
description: Use when creating, editing, reviewing, or restructuring FuzeFront help content — the in-app Help Center at app.fuzefront.com/help (source of record docs/help/**, rendered by frontend/src/pages/HelpPage.tsx) and its alignment with the Developer Portal (developers.fuzefront.com). Enforces the help-system policy: content-driven single source of truth, accurate-or-absent (no FrontFuse/localhost/@frontfuse/sdk/fake-credential rot), no placeholders in published articles, the article frontmatter contract, bidirectional manifest coverage, the screenshot/diagram/video media standard, accessibility + RTL i18n, design-system conformance for the help UI, and the freshness/ownership model. The procedure behind gate-help-conformance.
---

# help-system

The help system has shipped badly wrong content to production before (it called the product
"FrontFuse", hard-coded `localhost:3001`, told developers to `npm install @frontfuse/sdk`, and gave
Netlify deploy steps for a Kubernetes/Helm/Argo platform). **Help content is code.** Treat it with
the same rigor: accurate, reviewed, tested in CI, kept fresh.

**The law is `governance/help-system-policy.md`.** Read it. This skill is the operational shortcut.
Machine-checkable rules live in `governance/help-system-policy.json`; the gate is
`scripts/check-help-conformance.mjs` (`gate-help-conformance`).

## Before you touch anything

1. Read `governance/help-system-policy.md` (full policy) and `docs/help/README.md` (layout).
2. Verify every platform fact against its source — never from memory. The facts table is policy §7;
   platform truth is owned by `CLAUDE.md` (product name, auth = Authentik SSO, authz = Permit,
   deploy = K8s/Helm/Argo GitOps, packages = `@fuzefront/*`, toolchain Node 24 / React 19 /
   MF `requiredVersion ^19.0.0`, same-origin API base, naming rules, design system).

## Non-negotiables (gate fails the build on these)

- **Never** write any forbidden string (see the JSON): `FrontFuse`, `@frontfuse/`, `@frontfuse/sdk`,
  `localhost:3001`, `admin@frontfuse.dev`, `admin123`, `your-org/frontfuse`, `*.frontfuse.dev`,
  `discord.gg/frontfuse`. No `http(s)://localhost`, `127.0.0.1`, `example.*`, or `your-…` hosts.
- **Never** leave a placeholder (`TODO`/`TBD`/`FIXME`/`COMING SOON`/`XXX`/`PLACEHOLDER`) in a
  `status: published` article. Unfinished → `status: draft`.
- **Never** commit a fake/0-byte/placeholder screenshot, or a screenshot with no `alt` text.
- **Never** put credentials (real or fake) in help.
- **Always** list a new article in `docs/help/manifest.json` (coverage is bidirectional — no orphans,
  no dangling nav entries).
- **Always** make internal relative links resolve.
- API examples use **same-origin relative paths** (`POST /api/v1/apps`), never an absolute host.

## Article template

```markdown
---
title: <Human Title>
description: <one sentence: what this covers and for whom>
audience: user            # user | developer
order: <n>                # nav order within the section
owner: "@izzywdev"
lastReviewed: 2026-10-26   # today, YYYY-MM-DD — only after verifying the WHOLE article is true
status: published          # published | draft
# media:                   # OPTIONAL — only when the asset actually exists
#   - { src: _assets/<slug>/01-thing.png, alt: "What it shows and why", type: image }
---

# <Human Title>

<One paragraph: what the reader can do after this.>

## <Imperative task heading>
<Steps / concepts. Define FuzeFront terms on first use. No emojis, no hype.>

## Related
- [Next article](./other-article.md)
- Live API catalog & sandbox: https://developers.fuzefront.com
```

## Media (policy §10)

- Screenshots → `docs/help/_assets/<article-slug>/<ordinal>-<desc>.png`, ≤500 KB, redacted (no real
  data/tokens), with `alt`. Diagrams → SVG, theme-aware.
- Video is **not** committed to git: host on an approved host (`media.videoAllowedHosts` in the JSON),
  reference with `type: video` + https URL, provide captions/transcript. Prose must stand without it.
- AI (Opus) may script/storyboard/caption a screencast; it does not record or video-edit.
- Add media only "where needed" — not on every button.

## Help UI changes (policy §13)

- `HelpPage.tsx` uses `@fuzefront/design-system` tokens/primitives only (no raw hex/px) —
  `gate-ds-conformance`.
- Fixing wrong **content** in place is a correctness fix. A **structural** UI change (new layout/nav,
  content-driven renderer) needs `product-designer` frames (`design/frames/help/**`) in a
  frames-only PR first (`gate-frames-first`), then build, then `ui-runtime-validation` (console-clean
  in a real browser).

## Before you open the PR

```bash
node scripts/check-help-conformance.mjs --all
node --test scripts/__tests__/check-help-conformance.test.mjs
```
Then work the Definition of Done checklist (policy §18). Open a non-draft PR with the `auto-merge`
label. If you changed the help UI structurally, the frames PR lands first.

## References
- `references/definition-of-done.md` — the DoD checklist, copyable into a PR.
