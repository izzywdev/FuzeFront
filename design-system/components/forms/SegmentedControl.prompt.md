A compact toggle for choosing ONE value from a short, mutually-exclusive set of 2-3 options — the invitee kind (existing / external), the delivery channel (email / WhatsApp), the member type (employee / customer). Use `Tabs` for navigating sub-views and `Select` for longer lists; use this when the choice changes a form's shape in place.

```jsx
const [channel, setChannel] = useState("email");

<SegmentedControl
  ariaLabel="Send via"
  value={channel}
  onChange={setChannel}
  options={[
    { value: "email", label: "Email", icon: "✉️" },
    { value: "whatsapp", label: "WhatsApp", icon: "💬" },
  ]}
/>
```

Each segment is a real button with `aria-pressed`; the selected one is also filled with the accent tint and carries `data-selected="true"`, so the state is not color-only. Left/Right/Home/End move focus (direction-aware under RTL); Enter/Space commits. Pass `disabled` to inert the whole control (e.g. a member type that is fixed by context) — it renders `aria-disabled="true"` on the group and the selected segment stays visible.
