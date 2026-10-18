An international phone field: a country calling-code picker beside a national-number input, controlled by a single **E.164 string** so the form never joins a dial code and digits by hand. Use it wherever a number must be reachable over WhatsApp/SMS (an invitation to an external person, a recovery phone).

```jsx
const [phone, setPhone] = useState("");

<PhoneNumberInput
  label="WhatsApp number"
  required
  value={phone}
  onChange={(e164, { valid }) => setPhone(e164)}
  hint="Full international format, e.g. +15550104477."
/>
```

`onChange(e164, { valid, iso })` fires on every edit with the composed number (`""` when the digits are cleared). Validation is the E.164 envelope only (`+`, non-zero first digit, 7-15 digits) via the exported `isValidE164`; whether a number is actually reachable is the delivering service's call. The built-in message appears after blur when a non-empty value is invalid; pass `error` to override it (e.g. a server `INVALID_PHONE`). Override `countryLabel` / `invalidMessage` / `placeholder` to localize. The digits stay left-to-right under RTL; the picker sits at the inline-start edge.
