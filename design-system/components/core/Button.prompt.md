The host shell's pill-ish action button — accent-glow `primary` is the core CTA ("Launch app", "Connect remote", "Sign in"); `secondary` is the quieter bordered action, `ghost` for low-emphasis controls, `danger` for destructive ones.

```jsx
<Button variant="primary" withArrow>Launch app</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="ghost" size="sm">Skip</Button>
<Button variant="danger" leadingIcon={<TrashIcon />}>Remove remote</Button>
<Button variant="primary" fullWidth size="lg">Sign in</Button>

{/* Polymorphic — pass href to render a real <a>, same visual treatment */}
<Button variant="primary" href="https://app.fuzefront.com/signup">Sign Up Free</Button>
<Button variant="ghost" href="https://app.fuzefront.com/login">Sign In</Button>
<Button variant="primary" href="https://docs.example.com" target="_blank">
  Read the docs
</Button>

{/* Polymorphic via `as` — in-app routing through react-router-dom's Link */}
<Button as={Link} to="/dashboard" variant="secondary">Go to dashboard</Button>
```

Variants: `primary` (accent fill + fuse glow), `secondary` (raised + border), `ghost` (transparent), `danger` (error fill). Sizes `sm | md | lg`. `withArrow` adds a trailing arrow; `leadingIcon` prepends an icon node; `fullWidth` stretches; active state nudges down 1px; supports `disabled`.

**Polymorphic.** Pass `href` to render a real `<a>` instead of a `<button>` — same variant styling, real anchor semantics (`href`/`target`/`rel`, middle-click/ctrl-click opens a new tab, right-click offers "copy link", correct keyboard/screen-reader link role). `target="_blank"` gets a safe `rel="noopener noreferrer"` default unless you pass your own `rel`. Use this instead of `onClick={() => { window.location.href = url }}` or `window.open(url)` for any CTA that navigates — those are not real links and lose the browser-native affordances above. For in-app routing (react-router-dom), pass `as={Link} to="/path"` instead of `href`. A `disabled` anchor-rendered Button drops `href`, sets `aria-disabled`, and swallows clicks rather than navigating.
