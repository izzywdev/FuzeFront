A quiet accent-colored link that sits INSIDE a sentence or paragraph — a `mailto:` contact address in legal/contact copy, an in-text reference. No underline by default; underline appears on hover and keyboard focus. Does NOT force `target="_blank"` and does NOT append an external-arrow glyph.

```jsx
<p>
  Contact us at <InlineLink href="mailto:privacy@fuzefront.com">privacy@fuzefront.com</InlineLink>.
</p>

<InlineLink href="mailto:hr@fuzefront.com" emphasis>
  hr@fuzefront.com
</InlineLink>
```

`emphasis` bolds the link text (the handful of call sites that additionally wanted `font-medium`). For a link to ANOTHER host that should open in a new tab, use `ExternalLink` instead — that is a different affordance (launch away) from this one (a reference inline with the surrounding text).
