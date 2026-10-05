The big, bold `<h1>` page title at the top of a marketing-site hero section that sits on a light gradient background — replaces the ad-hoc `className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6"` pattern duplicated across the fuzefront-website marketing pages (Blog, Contact, Solutions).

```jsx
<PageHeroTitle>
  <span className="gradient-text">Blog</span> &amp; Insights
</PageHeroTitle>

<PageHeroTitle as="h2">
  Secondary hero-style title
</PageHeroTitle>
```

`as` (`h1` default, or `h2` for a secondary hero-style title lower on the same page) picks the rendered element. Font family, weight and color are fixed to the DS page-hero-title role tokens (`--role-page-hero-title-font` = `--font-sans`, `--role-page-hero-title-weight` = `--weight-bold`, `--text-primary` for the standard on-light reading-text color). The bottom margin is fixed to `--space-6` (24px), matching every call site. The responsive size step (`--role-page-hero-title-size` below 640px, `--role-page-hero-title-size-lg` at 640px+) is applied via an injected `<style>` block, the same pattern `Container`/`HeroHeading` use for a breakpoint that can't be expressed as an inline style.

This is the light-background sibling of `HeroHeading` (the dark-gradient-hero `<h1>`, extrabold + on-dark white) — same shape, different hero treatment. Use `PageHeroTitle` on a light gradient hero section, `HeroHeading` on a dark one.
