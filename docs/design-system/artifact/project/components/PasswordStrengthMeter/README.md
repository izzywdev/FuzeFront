A 4-segment strength bar for a password field, driven by the same policy rules
as `PasswordChecklist` (so the bar and the checklist never disagree). Place it
directly under the new-password `Input`; pair with `PasswordChecklist` for the
requirement list. Exposes `data-meter="empty|weak|fair|good|strong"` and an
accessible `role="meter"`.

```jsx
<Input type="password" label="New password" value={pw} onChange={...} />
<PasswordStrengthMeter value={pw} labels={{ empty: "", weak: "Weak", fair: "Fair", good: "Good", strong: "Strong" }} />
<PasswordChecklist value={pw} />
```

Props: `value`, `rules` (default policy), `labels` (translated level text), `label`
(accessible name). `passwordStrength(value, rules)` is exported for gating logic.
