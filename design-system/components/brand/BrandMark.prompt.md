The FuzeFront wordmark — "Fuze" filled with the runtime `--seam` gradient and "Front" in solid `--text-primary`, set in the display face; the signature brand lockup for the host shell's top bar.

```jsx
<BrandMark />
<BrandMark size="lg" />
<BrandMark logo="/FrontFuseLogo.png" />
<BrandMark size="sm" logo={logoSrc} alt="FuzeFront" />
```

Sizes `sm | md | lg` scale both the wordmark and the optional left-aligned `logo` image; `alt` names the product for screen readers. Self-contained span, no interactivity.
