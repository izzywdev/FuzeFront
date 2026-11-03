The bold, centered heading that opens a marketing-page section — "Leadership", "What we offer", "10 products. One platform. Zero lock-in.", "Ready to build on FuzeOne?". Replaces the recurring ad-hoc `className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-{3,4}"` duplicated across `AboutPage`, `CareersPage`, `HomePage`, `PrivacyPolicyPage` and `TermsPage`.

```jsx
<SectionTitle>Leadership</SectionTitle>

<SectionTitle as="h1" space="sm">Privacy Policy</SectionTitle>

<SectionTitle align="left">Built for every vertical</SectionTitle>
```

`as` picks the heading level — `h2` (default) for an in-page section, `h1` for a page's own title (e.g. a legal page). `align` defaults to `center` since every known call site renders centered; pass `left` for a non-centered page title. `space` picks the bottom-margin step: `md` (default, `mb-4`) or `sm` (`mb-3`, the legal-page variant). Typography (font, weight, color) comes entirely from the `--role-section-title-*` tokens — never style this text directly in feature code.
