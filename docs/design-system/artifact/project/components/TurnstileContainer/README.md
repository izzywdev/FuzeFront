The chrome around a managed anti-abuse challenge (Cloudflare Turnstile): a status box that reads **loading → ready → verified** or **failed**, with the vendor widget mounted in a slot beneath it. The design system owns the states; the feature owns the widget and passes it as `children`.

```jsx
<TurnstileContainer state="verified" data-turnstile>
  <Turnstile siteKey={siteKey} onSuccess={...} />
</TurnstileContainer>
<TurnstileContainer state="failed" labels={{ error: "Please complete the challenge." }} />
```

Props: `state` (`loading | ready | verified | failed`), `labels` (`loading`, `ready`, `verified`, `failed`, `error`, `brand` — localize them), `children` (the widget; stays mounted in every state so it can keep refreshing its token). `failed` also renders `labels.error` as an `alert`. Root + status box both carry `data-state`. Tokens only.
