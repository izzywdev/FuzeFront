Draws a QR code from a module matrix. The design system ships no QR encoder —
compute the matrix in the caller (e.g. with `qrcode-generator`) and pass it in.
The plate is always light with dark modules (`--paper` / `--ink-900`) in both
themes so authenticator apps can scan it.

```jsx
<QrCode modules={matrix} label="Scan to add an authenticator" />
```

Props: `modules` (boolean[][]), `label`, `size` (CSS length), `quietZone`.
Renders nothing for an empty matrix. Never put the secret in the `label`.
