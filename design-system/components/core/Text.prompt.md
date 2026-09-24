A plain-text primitive that replaces ad-hoc `className="text-gray-500"` / `text-gray-600` / `text-gray-900` / `text-red-500` styling scattered across feature code with a semantic `tone` from the DS text-color scale. Use it for placeholder/empty-state copy, read-only field-value display, and de-emphasized captions or subtitles — anywhere a raw Tailwind gray shade would otherwise be reached for.

```jsx
<Text tone="muted">Select organization</Text>
<Text as="span" tone="secondary">{user.email}</Text>
<Text tone="primary">{profile.firstName || 'Not set'}</Text>
<Text tone="danger">Failed to load profile data.</Text>
```

Tones: `primary` (default reading text — DS `--text-primary`), `secondary` (de-emphasized supporting copy — `--text-secondary`), `muted` (lowest-emphasis placeholder/empty copy — `--text-tertiary`), `danger` (inline error copy — `--error-color`). `as` (`p` default, or `span` | `div` | `label`) picks the rendered element; font-size/line-height inherit from context, so wrap `Text` in whatever sizing utility/class the surrounding layout already uses.
