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
