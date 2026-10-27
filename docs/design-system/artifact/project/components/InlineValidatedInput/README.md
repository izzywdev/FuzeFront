A text field with a live validation state — the shape of an "is this email free?" or "does this match?" field. The label row can carry an inline status (`accessory`) on its logical end; the field gets a success ring + check adornment when `state="valid"`, an error ring + `aria-invalid` when `state="invalid"`, and `aria-busy` while `checking`.

```jsx
<InlineValidatedInput
  id="email"
  type="email"
  label="Work email"
  state="valid"
  accessory="Available"
  help="We check this as you type."
/>
<InlineValidatedInput
  id="email2"
  label="Work email"
  state="invalid"
  accessory="Already registered"
  help={<>That email has an account. <a href="/login">Sign in instead?</a></>}
/>
```

Props: everything `Input` takes (except `label`/`valid`/`invalid`/`adornment`), plus `label`, `accessory`, `state` (`idle | checking | valid | invalid`), `help`, `required`. Tokens only; positioned with logical properties so it mirrors under RTL.
