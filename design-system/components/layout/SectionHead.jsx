import React from "react";
import { Eyebrow } from "./Eyebrow.jsx";

const ArrowRight = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/**
 * Standard section opener — eyebrow pill + heading + optional description + optional "view all" link.
 * Use at the top of any major content section in dashboards, landing pages, or management views.
 */
export function SectionHead({
  kicker,
  title,
  description,
  viewAllLabel,
  viewAllHref = "#",
  onViewAll,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {kicker && <Eyebrow>{kicker}</Eyebrow>}
        <h2 style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontWeight: "var(--role-heading-weight)",
          letterSpacing: "var(--tracking-display)",
          color: "var(--text-primary)",
          lineHeight: "var(--leading-snug)",
          margin: 0,
          textWrap: "balance",
        }}>
          {title}
        </h2>
        {description && (
          <p style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-base)",
            color: "var(--text-secondary)",
            lineHeight: "var(--leading-relaxed)",
            margin: 0,
            maxWidth: "560px",
          }}>
            {description}
          </p>
        )}
      </div>
      {viewAllLabel && (
        <a
          href={viewAllHref}
          onClick={onViewAll}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            color: "var(--accent-color)",
            textDecoration: "none",
            flexShrink: 0,
            alignSelf: "center",
            transition: "opacity var(--duration-fast) var(--ease-standard)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.75"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          {viewAllLabel} <ArrowRight />
        </a>
      )}
    </div>
  );
}
