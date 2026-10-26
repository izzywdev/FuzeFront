A segmented strength meter: four bars lit to a level (`weak` → `strong`), tinted by tone, with a caption row and a child slot for a per-rule requirements checklist. The parent scores the value — the meter only renders it.

```jsx
<StrengthMeter strength="weak" label="Password strength" valueLabel="Weak" />
<StrengthMeter strength="strong" label="Password strength" valueLabel="Strong">
  <PasswordChecklist value={pw} title="" />
</StrengthMeter>
```

Props: `strength` (`empty | weak | fair | good | strong`), `label`, `valueLabel`, `bars` (default 4), `children`, plus native div attributes (pass `data-*` hooks through). Bars are decorative (`aria-hidden`); the caption row is a polite live region. Tokens only; logical grid so the bars read in writing order under RTL.
