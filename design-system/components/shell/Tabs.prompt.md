An accessible, controlled tab strip for switching between sub-views of an area (the WAI-ARIA tabs pattern with automatic activation). The consumer owns the active value; arrow keys move between tabs.

```jsx
const [tab, setTab] = useState("plans");

<Tabs
  ariaLabel="Billing sections"
  value={tab}
  onChange={setTab}
  tabs={[
    { value: "plans", label: "Plans" },
    { value: "invoices", label: "Invoices" },
    { value: "payments", label: "Payments" },
  ]}
/>
```

The active tab gets the seam-accent underline + `aria-selected`. Pair each tab's `controls` with the `id` of its `role="tabpanel"` for a fully-wired panel relationship.

**Route tabs** — give a tab an `href` to render it as a link instead of a button, for a console shell where each tab is its own route (e.g. Portal Admin):

```jsx
<Tabs
  ariaLabel="Portal admin"
  value={currentTab}
  tabs={[
    { value: "overview", label: "Overview", href: "/portal/admin" },
    { value: "users", label: "Users", href: "/portal/admin/users" },
    { value: "catalog", label: "App catalog", href: "/portal/admin/catalog" },
    { value: "billing", label: "Billing", href: "/portal/admin/billing" },
  ]}
/>
```

`value` still drives `aria-selected` (derive it from the current route); navigation is the anchor's default behavior — wrap the app's router `Link` around this pattern if client-side routing is needed instead of a full navigation.
