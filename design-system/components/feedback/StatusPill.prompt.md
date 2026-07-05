An inline dot + label pill that reports the live health of a service or remote in the runtime fabric — `online` is green/success, `degraded` is amber/warning, `offline` is red/error.

```jsx
<StatusPill status="online" />
<StatusPill status="degraded" label="High latency" />
<StatusPill status="offline" label="remoteEntry 404" />
<StatusPill status="online" label="Backend API" />
```

Props: `status` (`online | offline | degraded`, drives the dot color and default label) and `label` (optional text override, defaults to the capitalized status). Renders as a `<span>` with `role="status"`.
