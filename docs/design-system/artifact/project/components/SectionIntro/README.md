`SectionIntro` — a FuzeFront design-system `layout` primitive, styled entirely with tokens.

**Props**

- `as?` — Element/component to render as. Default "div" — pass `motion.div` to animate it.
- `heading?` — Heading tag for `title`. Default "h2"; use "h1" for a page's own header.
- `icon?` — Optional node rendered above the heading (e.g. an `IconTile`).
- `title` — Heading content.
- `titleGap?` — Bottom margin under the heading, on the DS spacing scale. Default 4.
- `description?` — Optional lead paragraph rendered below the heading.
- `descriptionMaxWidth?` — Max prose width of `description`. Default "2xl" (42rem).
- `spacing?` — Bottom margin of the whole block, on the DS spacing scale. Default 12.
- `ref?`

See `components/index.d.ts` for the full prop contract.
