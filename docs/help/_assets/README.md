# Help Center media assets

Committed visual media for help articles (screenshots, annotated images, diagrams) live here,
grouped by article slug:

```
docs/help/_assets/
  <article-slug>/
    <ordinal>-<description>.png      e.g. 01-dashboard-overview.png
```

## What belongs here

- **Screenshots / annotated images** — committed to git, referenced from an article's frontmatter
  `media:` list.
- **Diagrams** — prefer `.svg` (crisp, diff-able, theme-aware).

## What does NOT belong here

- **Video** is **not** committed to git (it bloats the repo and git handles binaries poorly).
  Video is hosted on an approved host and referenced by URL in frontmatter with `type: video`.
  Approved hosts are listed in `governance/help-system-policy.json` → `media.videoAllowedHosts`.
- **Placeholder / 0-byte files** — the gate rejects them. Do not commit a stand-in to be replaced
  later; land the article without the figure and add the figure when it is real.

## Referencing media from an article

```yaml
---
title: Getting Started
# ...other required fields...
media:
  - { src: _assets/getting-started/01-dashboard.png, alt: "The portal dashboard after sign-in", type: image }
  - { src: https://developers.fuzefront.com/media/getting-started.mp4, alt: "Two-minute portal tour", type: video }
---
```

The gate (`scripts/check-help-conformance.mjs`) checks that every image referenced exists, is not a
0-byte placeholder, is under the size budget, and has non-empty `alt` text (accessibility).

## Capture / production standard

Resolution, redaction (no real customer data or tokens in a screenshot), compression, caption and
alt-text rules, and the screencast/narration standard are defined in
**`governance/help-system-policy.md` → "Media standard"** and operationalized in the
`help-system` skill. Follow them so every figure in the help center reads as one system.
