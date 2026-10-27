A `Textarea` with a live character counter and a limit — for length-limited free text such as a brief (≤ 4000), notes or a reason (≤ 2000). It composes `Textarea`, so label, error, focus ring and disabled behave identically.

```jsx
<TextareaWithCounter
  label="What should it do?"
  maxLength={4000}
  value={brief}
  onChange={(e) => setBrief(e.target.value)}
  rows={6}
/>

// Uncontrolled, optional field, hard-capped at the limit (strict)
<TextareaWithCounter label="Notes for the reviewer" maxLength={2000} strict defaultValue="" />
```

Props: `maxLength` (required — the limit), `strict`, `value` / `defaultValue` / `onChange(event)`, `error`, `locale`, `formatMessage`, `overLimitMessage`, `announceDelay`, `counterProps`, plus every `Textarea` prop (`label`, `rows`, `disabled`, `placeholder`, `name`, `id`, …).

Behaviour:
- **Counter** sits on the label row at the inline-end edge (mirrors under `dir="rtl"`), mono with tabular figures — `412 / 4,000`. It turns to the error colour and semibold when over the limit.
- **Soft limit by default.** The user can type or paste past `maxLength`; the overflow is flagged (counter, `aria-invalid`, a visible error) so the form can block submit and the user can trim. Truncating pasted text silently is worse. Pass `strict` to truncate input to `maxLength` code points instead (enforced in JS on change — the native `maxlength` attribute is not used, as it counts UTF-16 units and would cut an emoji off mid-surrogate).
- **Counted in Unicode code points** — what an OpenAPI/JSON-Schema `maxLength` counts — so an emoji is 1, not 2.
- A caller-supplied `error` (e.g. a server `VALIDATION` message) wins over the built-in over-limit message. It renders in a `role="alert"`; a message that changes every keystroke ("127 over") would be re-announced each time, so prefer a stable string.
- `counterProps` is spread onto the visible counter — use it for test/automation hooks, e.g. `counterProps={{ "data-counter": "brief" }}`.

Accessibility: the visible counter is `aria-hidden`. The field is described (read on focus) by a visually-hidden message — "412 of 4,000 characters remaining" / "127 characters over the limit of 4,000" — and a polite live region announces the updated count only after the user stops typing for `announceDelay` ms (default 1000; `0` = immediately), never per keystroke and never on first render. A caller's `aria-describedby` is kept alongside. Strings are English by default; for another language pass `formatMessage({ count, max, remaining, over })` and `overLimitMessage`, and `locale` for number formatting.
