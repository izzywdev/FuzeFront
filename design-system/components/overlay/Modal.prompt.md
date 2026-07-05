Generic accessible modal shell — a fixed full-viewport backdrop with a centered `bg-tertiary` card topped by the 2px fuse-seam gradient bar. Focus is trapped inside; Escape and backdrop-click both call `onClose`.

```jsx
<Modal open={isOpen} onClose={() => setOpen(false)} title="Invite member">
  <Input id="email" label="Email" type="email" placeholder="team@acme.com" />
  <Button onClick={() => setOpen(false)}>Send invite</Button>
</Modal>

<Modal open={isOpen} onClose={() => setOpen(false)} title="Edit organization" size="lg">
  {/* wider layout at 720px */}
  <OrgForm />
</Modal>

<Modal open={isOpen} onClose={() => setOpen(false)}>
  {/* no title — aria-labelledby omitted */}
  <p>Are you sure you want to delete this app?</p>
  <Button variant="danger" onClick={confirmDelete}>Delete</Button>
</Modal>
```

Props: `open` (bool — unmounts when false), `onClose` (Escape + backdrop click), `title` (heading + aria-labelledby), `size` (`'md'` 560px | `'lg'` 720px), `style` (dialog card overrides). Focus trap wraps Tab/Shift+Tab within focusable elements; the dialog itself receives initial focus on open.
