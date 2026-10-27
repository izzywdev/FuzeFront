The big, bold `<h1>` page title at the top of a marketing-site hero section (dark gradient background) — replaces the ad-hoc `className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-{4,6}"` pattern duplicated across the fuzefront-website marketing pages (About, Careers, Industries, Press, Pricing, Products).

```jsx
<HeroHeading>
  About <GradientText>FuzeOne</GradientText>
</HeroHeading>

<HeroHeading spacing="md">
  Built for every <GradientText>industry</GradientText>
</HeroHeading>
```

`as` (`h1` default, or `h2` for a secondary hero-style title lower on the same page) picks the rendered element. `spacing` (`lg` default — 24px via `--space-6`, or `md` — 16px via `--space-4`, or `none`) picks the bottom margin from the DS spacing scale as the logical `margin-block-end` (mirrors under RTL). Font family, weight and color are fixed to the DS marketing-hero role tokens (`--role-marketing-hero-font`, `--role-marketing-hero-weight` = `--weight-extrabold`, `--primary-foreground` for the on-dark white) — never a raw value. The responsive size step (`--role-marketing-hero-size` below 640px, `--role-marketing-hero-size-lg` at 640px+) is applied via an injected `<style>` block, the same pattern `Container` uses for its gutter, since a breakpoint can't be expressed as an inline style.
