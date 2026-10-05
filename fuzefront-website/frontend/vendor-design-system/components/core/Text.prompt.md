A plain-text primitive that replaces ad-hoc `className="text-gray-500"` / `text-gray-600` / `text-gray-900` / `text-red-500` styling scattered across feature code with a semantic `tone` from the DS text-color scale. Use it for placeholder/empty-state copy, read-only field-value display, and de-emphasized captions or subtitles — anywhere a raw Tailwind gray shade would otherwise be reached for.

Also replaces the recurring `className="text-sm text-gray-{500,600} mb-{2,4}"` block-caption pattern (a de-emphasized supporting paragraph under a heading — an access-denied explanation, a dialog's helper copy, a section sub-label) via the `size` + `spacing` props, instead of a raw Tailwind size/margin utility.

Also replaces the recurring `className="text-gray-{500,600} mb-{6,8}"` centered CTA-lead pattern (a de-emphasized paragraph under a `<h2>`/`<h3>` CTA or section heading, e.g. "Talk to our team.") via `tone="secondary"` + `spacing="lg"`/`"xl"`.

```jsx
<Text tone="muted">Select organization</Text>
<Text as="span" tone="secondary">{user.email}</Text>
<Text tone="primary">{profile.firstName || 'Not set'}</Text>
<Text tone="danger">Failed to load profile data.</Text>
<Text tone="secondary" size="sm" spacing="md">
  You don't have the required permissions to access this page.
</Text>
<Text tone="secondary" spacing="xl">
  Talk to our team. We'll map your use case to the right products.
</Text>
```

Tones: `primary` (default reading text — DS `--text-primary`), `secondary` (de-emphasized supporting copy — `--text-secondary`), `muted` (lowest-emphasis placeholder/empty copy — `--text-tertiary`), `danger` (inline error copy — `--error-color`). `as` (`p` default, or `span` | `div` | `label`) picks the rendered element. `size` (`inherit` default, or `xs` | `sm` | `base` | `md`) picks a step of the DS type scale — `inherit` keeps reading the surrounding layout's font size, unchanged from before `size` existed. `spacing` (`none` default, or `sm` | `md` | `lg` | `xl`) picks a step of the DS spacing scale applied as the logical `margin-block-end` (mirrors under RTL) — `none` keeps the original zero-margin behavior; `lg`/`xl` cover the wider `mb-6`/`mb-8` gap.
