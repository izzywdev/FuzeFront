import React, { forwardRef } from "react";

// ds-fp:8e5ef2a49b53 — extracted per issue #949. The centered
// "section opener" — optional icon, a bold heading, an optional lead
// paragraph, then a fixed bottom margin before whatever the section
// renders next — was hand-duplicated across AboutPage (x2), CareersPage,
// HomePage (x3) and the legal pages (Privacy/Terms), each copy repeating
// the same `text-center mb-{12,14,16}` wrapper and heading classes with
// only the copy, the trailing margin and the presence of a description
// actually varying.
//
// Colors/sizes use the DS's own tokens (--text-primary/--text-secondary
// from colors.css, --space-* from spacing.css, --font-sans/--weight-bold
// from typography.css) — all already imported by every consumer of this
// component, including the marketing site (see App.tsx). The heading's
// responsive step (1.875rem -> 2.25rem at the sm breakpoint) mirrors the
// Tailwind `text-3xl sm:text-4xl` every call site used, via one injected
// <style> block, same pattern as Container's responsive gutter.
const SPACING_VAR = {
  12: "var(--space-12)",
  14: "var(--space-14)",
  16: "var(--space-16)",
};

const TITLE_GAP_VAR = {
  0: "0",
  3: "var(--space-3)",
  4: "var(--space-4)",
};

// Tailwind's default `max-w-xl` / `max-w-2xl` — the two prose widths the
// recurring lead paragraphs used (`max-w-xl mx-auto` / `max-w-2xl mx-auto`).
const DESCRIPTION_MAX_WIDTH = {
  xl: "36rem",
  "2xl": "42rem",
};

const TITLE_CLASS = "ds-section-intro__title";

// One injected <style> block per instance, scoped to a stable shared class
// — same dedupe-friendly pattern as Container's GUTTER_CSS (identical
// <style> content across instances costs browsers nothing to coalesce).
const TITLE_CSS = `
  .${TITLE_CLASS} {
    font-size: 1.875rem;
    line-height: 2.25rem;
  }
  @media (min-width: 640px) {
    .${TITLE_CLASS} { font-size: 2.25rem; line-height: 2.5rem; }
  }
`;

/**
 * SectionIntro — the centered heading block used to open a marketing-page
 * section or a simple content page: an optional icon/badge, a bold
 * heading, an optional single-paragraph lede, then a fixed bottom margin
 * before the section's main content.
 *
 * `as` lets a caller render it as `motion.div` (or any component) and
 * forward its own animation props through the rest-spread — every
 * original call site wrapped this block in a `framer-motion` fade/stagger.
 * The ref forwards to the rendered element so `useInView`/`useRef`
 * wiring keeps working exactly as it did on the plain `<div>`/`<motion.div>`.
 *
 * `description` renders the standard lead paragraph; pass arbitrary
 * `children` instead (or alongside) for content that doesn't fit that
 * shape, such as the legal pages' stacked "last updated" meta lines.
 */
export const SectionIntro = forwardRef(function SectionIntro(
  {
    as: As = "div",
    heading = "h2",
    icon,
    title,
    titleGap = 4,
    description,
    descriptionMaxWidth = "2xl",
    spacing = 12,
    className,
    style,
    children,
    ...rest
  },
  ref
) {
  const Heading = heading;

  return (
    <As
      ref={ref}
      className={className}
      style={{
        textAlign: "center",
        marginBottom: SPACING_VAR[spacing] || SPACING_VAR[12],
        ...style,
      }}
      {...rest}
    >
      <style>{TITLE_CSS}</style>
      {icon}
      <Heading
        className={TITLE_CLASS}
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: "var(--weight-bold)",
          color: "var(--text-primary)",
          margin: 0,
          marginBottom: TITLE_GAP_VAR[titleGap] ?? TITLE_GAP_VAR[4],
        }}
      >
        {title}
      </Heading>
      {description && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-lg)",
            color: "var(--text-secondary)",
            maxWidth: DESCRIPTION_MAX_WIDTH[descriptionMaxWidth] || DESCRIPTION_MAX_WIDTH["2xl"],
            margin: "0 auto",
          }}
        >
          {description}
        </p>
      )}
      {children}
    </As>
  );
});

SectionIntro.displayName = "SectionIntro";
