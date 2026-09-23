A plain-text primitive that replaces ad-hoc `className="text-gray-500"` / `text-gray-600` / `text-gray-900` / `text-red-500` styling scattered across feature code with a semantic `tone` from the DS text-color scale, and ad-hoc `className="text-sm ..."` (etc.) size utilities with a `size` step of the DS type scale. Use it for placeholder/empty-state copy, read-only field-value display, de-emphasized captions or subtitles, and small meta/caption lines (e.g. "Member since …", a fact-sheet label) — anywhere a raw Tailwind gray shade or text-size utility would otherwise be reached for.

```jsx
<Text tone="muted">Select organization</Text>
<Text as="span" tone="secondary">{user.email}</Text>
<Text tone="primary">{profile.firstName || 'Not set'}</Text>
<Text tone="danger">Failed to load profile data.</Text>
<Text as="div" tone="muted" size="sm">Member since: {joinedDate}</Text>
<Text as="dt" tone="secondary" size="sm">{item.label}</Text>
```

Tones: `primary` (default reading text — DS `--text-primary`), `secondary` (de-emphasized supporting copy — `--text-secondary`), `muted` (lowest-emphasis placeholder/empty copy — `--text-tertiary`), `danger` (inline error copy — `--error-color`). `as` (`p` default, or `span` | `div` | `label`) picks the rendered element. `size` (optional; one of the DS type-scale steps — `2xs`/`xs`/`sm`/`base`/`md`/`lg`/`xl`/`2xl`/`3xl`) sets font-size from the token scale; omit it to keep inheriting font-size/line-height from the surrounding layout (the original default behavior).
