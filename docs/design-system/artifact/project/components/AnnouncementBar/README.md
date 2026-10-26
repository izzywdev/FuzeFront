`AnnouncementBar` — a FuzeFront design-system `shell` primitive, styled entirely with tokens.

**Props**

- `badge?` — Short uppercase badge label rendered before the message (e.g. "New", "Beta").
- `message?` — Text content of the announcement. Ignored when `children` are provided.
- `linkLabel?` — Label for the optional inline CTA link. Requires `href`.
- `href?` — URL the CTA link navigates to.
- `onClose?` — Called when the user dismisses the bar.

See `components/index.d.ts` for the full prop contract.
