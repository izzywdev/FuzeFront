A tinted, icon-led pill that labels a member's role in an organization — the tone carries the meaning, so it reads at a glance in members tables and org panels.

```jsx
<RoleBadge role="owner" />
<RoleBadge role="admin" />
<RoleBadge role="member" />
<RoleBadge role="viewer" showIcon={false} />
```

Roles: `owner` (amber crown), `admin` (indigo shield — the fuse), `member` (cyan user), `viewer` (neutral eye). `showIcon` toggles the leading glyph; spreads any `<span>` props (incl. `style`) and inherits the global focus ring.
