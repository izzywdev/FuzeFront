A segmented one-time-code field: one input per digit. Use it for TOTP / SMS /
email / recovery-style codes anywhere a user types a short code. Pasting a full
code fills every cell; entry auto-advances; Backspace and the arrow keys move
between cells; the first cell carries `autocomplete="one-time-code"` so the OS
can offer an SMS code. Cells always lay out left-to-right, even in RTL.

```jsx
<OtpInput onComplete={(code) => verify(code)} />
<OtpInput value={code} onChange={setCode} error={!!err} />
<OtpInput size="touch" />   {/* >= 44px cells for mobile / TWA */}
```

Props: `length` (6), `value` / `defaultValue` / `onChange` / `onComplete`,
`disabled`, `error` (red cells + `aria-invalid`), `size` (`md` | `touch`),
`numeric` (true), `autoFocus`, `aria-label`, `cellLabel`. Pair it with a visible
label and an error message (`role="alert"`) rendered by the caller.
