A plain-text primitive that replaces ad-hoc `className="text-gray-500"` / `text-gray-600` / `text-gray-900` / `text-red-500` styling scattered across feature code with a semantic `tone` from the DS text-color scale. Use it for placeholder/empty-state copy, read-only field-value display, and de-emphasized captions or subtitles — anywhere a raw Tailwind gray shade would otherwise be reached for.

Also replaces the recurring `className="text-sm text-gray-{500,600} mb-{2,4}"` block-caption pattern (a de-emphasized supporting paragraph under a heading — an access-denied explanation, a dialog's helper copy, a section sub-label) via the `size` + `spacing` props, instead of a raw Tailwind size/margin utility.

Also replaces the recurring `className="font-medium text-gray-900"` pattern (a small bolded label/heading — a notification title, a contact-info item's label such as "Email"/"Phone"/"Office") via the `weight` prop, instead of a raw Tailwind `font-*` utility.

```jsx
<Text tone="muted">Select organization</Text>
<Text as="span" tone="secondary">{user.email}</Text>
<Text tone="primary">{profile.firstName || 'Not set'}</Text>
<Text tone="danger">Failed to load profile data.</Text>
<Text tone="secondary" size="sm" spacing="md">
  You don't have the required permissions to access this page.
</Text>
<Text as="h3" weight="medium">Email</Text>
<Text as="h4" weight="medium">{notification.title}</Text>
```

Tones: `primary` (default reading text — DS `--text-primary`), `secondary` (de-emphasized supporting copy — `--text-secondary`), `muted` (lowest-emphasis placeholder/empty copy — `--text-tertiary`), `danger` (inline error copy — `--error-color`). `as` (`p` default, or `span` | `div` | `label` | `h3` | `h4`) picks the rendered element. `size` (`inherit` default, or `xs` | `sm` | `base` | `md`) picks a step of the DS type scale — `inherit` keeps reading the surrounding layout's font size, unchanged from before `size` existed. `spacing` (`none` default, or `sm` | `md`) picks a step of the DS spacing scale applied as the logical `margin-block-end` (mirrors under RTL) — `none` keeps the original zero-margin behavior. `weight` (`inherit` default, or `regular` | `medium` | `semibold` | `bold`) picks a step of the DS font-weight scale — `inherit` applies no inline override, unchanged from before `weight` existed.
