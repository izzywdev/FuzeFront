Semantic table shell — builds `<thead>` from a `columns` array (with sort carets + `aria-sort`) and accepts the consumer's `<tbody>` as `children`. Sorting logic (e.g. TanStack) stays in the consumer; DataTable handles only structure, tokens, and sort-state presentation. Includes loading skeleton rows and a centered empty state.

```jsx
// Basic read-only table
<DataTable
  columns={[
    { key: "name",  header: "Name" },
    { key: "role",  header: "Role" },
    { key: "joined", header: "Joined" },
  ]}
>
  <tbody>
    {users.map((u) => (
      <tr key={u.id}>
        <td style={{ padding: "var(--space-3) var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{u.name}</td>
        <td style={{ padding: "var(--space-3) var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{u.role}</td>
        <td style={{ padding: "var(--space-3) var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{u.joined}</td>
      </tr>
    ))}
  </tbody>
</DataTable>

// With sort + loading
<DataTable
  columns={[
    { key: "name",  header: "Name",   sortable: true },
    { key: "email", header: "Email",  sortable: true },
    { key: "org",   header: "Org" },
  ]}
  sortBy={sortBy}
  sortDir={sortDir}
  onSort={(key) => handleSort(key)}
  loading={isLoading}
  emptyState="No members found."
>
  <tbody>...</tbody>
</DataTable>
```

**API shape:**
- `columns` — `{ key, header, sortable?, align? }[]` — defines `<thead>` cells
- `children` — the consumer's `<tbody>` (or `<tbody>` + `<tfoot>`)
- `loading` — replaces `children` with 5 skeleton rows (aria-hidden)
- `emptyState` — shown centered when `children` is absent and not loading
- `onSort(key)` — called when a `sortable` header is clicked
- `sortBy` / `sortDir` — control which header shows the active caret + aria-sort

The wrapper `<div>` accepts all standard HTML div attributes for layout/ref needs.
