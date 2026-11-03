A tone-colored decorative icon, centered on its own line above a heading, with a token-driven bottom gap — extracted from the recurring CTA-icon block duplicated across fuzefront-website (issue #968, `ds-fp:ca4dadd873c1`). The icon itself is passed as `children`; SectionIcon only centers, colors, and spaces it.

```jsx
<SectionIcon tone="accent"><Crown size={40} /></SectionIcon>
<SectionIcon tone="accent" gap="md"><Users size={32} /></SectionIcon>
<SectionIcon tone="success" label="Verified"><CheckCircle size={32} /></SectionIcon>
```

Tones: `accent | info | success | warning | error | neutral`. Gap (the margin between the icon and whatever follows it, mapped to the spacing scale): `lg` (default, `--space-6`, 24px) for the FuzeHubPage/PricingPage CTA spacing; `md` (`--space-4`, 16px) for the tighter HomePage newsletter-teaser spacing. Decorative by default (`aria-hidden`); pass `label` when the icon carries meaning with no adjacent heading.
