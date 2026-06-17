A single toast notification — a `bg-tertiary` card with a level-colored left bar (`info` = cyan accent) and an optional dismiss (x) button, surfaced by the host shell when an app or the runtime fabric reports a status.

```jsx
<Toast level="success" title="Remote mounted" message="FuzeClock loaded from remoteEntry.js" onDismiss={() => dismiss(id)} />
<Toast level="error" title="Load failed" message="Could not reach https://apps.local/remoteEntry.js" onDismiss={() => dismiss(id)} />
<Toast level="warning" message="Session expires in 2 minutes." onDismiss={() => dismiss(id)} />
<Toast level="info" message="Organization switched to acme-corp." />
```

Levels: `success` | `warning` | `error` | `info` (info uses `--accent-2`). Props: `title`, `message`, and `onDismiss` (renders the x IconButton when provided).
