An inline dot + label pill for a fixed lifecycle-status vocabulary: service health (`online | degraded | offline`), portal lifecycle (`active | suspended`), domain verification (`verified | pending`), catalog enablement (`enabled | disabled`), Connect onboarding (`not-started | in-progress | restricted`), and invites (`invited | expired`). Background is a soft tint of the semantic color; the dot + text never rely on color alone.

```jsx
<StatusPill status="online" />
<StatusPill status="degraded" label="High latency" />
<StatusPill status="active" />                 {/* portal lifecycle */}
<StatusPill status="suspended" />
<StatusPill status="verified" label="Verified" />
<StatusPill status="in-progress" label="Connect onboarding" />
<StatusPill status="invited" />
```

Props: `status` (drives tone + default label) and `label` (optional text override, defaults to the capitalized status). Renders as a `<span>` with `role="status"` and `data-status={status}`.
