A reorderable list — drag is the primary interaction, the up/down button pair is the keyboard-accessible equivalent. Built for the per-portal app catalog (enable + reorder), generic beyond it.

```jsx
<SortableList
  ariaLabel="Enabled apps"
  items={enabledApps}
  getKey={(app) => app.id}
  renderItem={(app) => (
    <div>
      <div>{app.name}</div>
      <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>{app.integration}</div>
    </div>
  )}
  renderActions={(app) => <Toggle checked={app.enabled} onChange={() => toggleApp(app.id)} />}
  onReorder={(next) => persistOrder(next.map((a) => a.id))}
/>
```

Each row is `draggable`; drop reorders via `onReorder(nextItems)`. The ▲▼ buttons (`data-action="move-up" | "move-down"`) call the same reorder path and disable at the list boundary, so the endpoint's unusable direction is never clickable.
