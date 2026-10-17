A small bold subsection heading inside a block of body copy — a numbered legal-document subsection ("6.1 GDPR Rights (EEA Residents)", "4.1 Subscription Fees"), or any similar sub-topic heading nested under an `<h2>` section title. Replaces the recurring ad-hoc `className="text-base font-semibold text-gray-800 mb-2[ mt-{4,5}]"` pattern duplicated across the legal pages (`PrivacyPolicyPage`, `TermsPage`). Composes `Text` for its tone/type scale (never forks it — `tone="primary"` reads `--text-primary`, `size="base"` reads `--text-base`) and adds the two things `Text` deliberately leaves to the caller: the DS `--weight-semibold` font weight, and a `space` prop for the gap before a subheading that follows a preceding paragraph in the same section.

```jsx
<SubHeading>2.1 Information You Provide</SubHeading>
<SubHeading space="lg">2.2 Information Collected Automatically</SubHeading>
<SubHeading space="md">4.2 Price Changes</SubHeading>
```

Tones (delegated to `Text`): `primary` (default), `secondary`, `muted`, `danger`. `space` (top-margin gap): `none` (default) | `md` (`--space-4`) | `lg` (`--space-5`). `spacing` (bottom-margin gap): `none` | `sm` (default, `--space-2`). `as` (`h3` default, or `h4` | `p` | `div`) picks the rendered element.
