The centered intro paragraph directly under a section heading on a marketing page (e.g. a `<h2>` section title followed by one sentence explaining the section). Replaces the recurring ad-hoc `className="text-lg text-gray-600 max-w-2xl mx-auto"` pattern duplicated across `fuzefront-website` marketing pages.

```jsx
<h2>Everything your SaaS needs, none of the overhead</h2>
<SectionLede>
  FuzeOne bundles the primitives that every product team reinvents — so yours doesn't have to.
</SectionLede>
```

Tokens only: `--text-lg` size, `--text-secondary` tone (the gray-600 mapping), `--container-2xl` (672px, matches `max-w-2xl`) width cap, centered via `margin-inline: auto` + `text-align: center`. `as` (`p` default, or `div`/`span`) picks the rendered element. Sits on the page's ambient light theme — unlike a dark-hero lead, it needs no `data-theme` pin.
