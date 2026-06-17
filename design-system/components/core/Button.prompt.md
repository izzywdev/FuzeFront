The host shell's pill-ish action button — accent-glow `primary` is the core CTA ("Launch app", "Connect remote", "Sign in"); `secondary` is the quieter bordered action, `ghost` for low-emphasis controls, `danger` for destructive ones.

```jsx
<Button variant="primary" withArrow>Launch app</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="ghost" size="sm">Skip</Button>
<Button variant="danger" leadingIcon={<TrashIcon />}>Remove remote</Button>
<Button variant="primary" fullWidth size="lg">Sign in</Button>
```

Variants: `primary` (accent fill + fuse glow), `secondary` (raised + border), `ghost` (transparent), `danger` (error fill). Sizes `sm | md | lg`. `withArrow` adds a trailing arrow; `leadingIcon` prepends an icon node; `fullWidth` stretches; active state nudges down 1px; supports `disabled`.
