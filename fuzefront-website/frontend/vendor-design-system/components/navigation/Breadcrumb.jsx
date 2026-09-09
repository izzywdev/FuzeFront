import React from "react";

const SEP = "›"; // ›

/**
 * A trail of steps in a hierarchy — a generic breadcrumb, or (with `kind` set
 * per item) a labeled resolution/scope chain such as
 * platform › portal › org › user. Each step is a pill; the active step
 * carries `aria-current="true"` and the accent treatment. A step with `onClick`
 * or `href` is interactive (clickable breadcrumb); one with neither renders as
 * plain text (e.g. a chain step that exists only to be read, not navigated).
 */
export function Breadcrumb({ items = [], style, ...rest }) {
  return (
    <nav aria-label="Breadcrumb" style={style} {...rest}>
      <ol
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--space-1)",
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {items.map((item, i) => {
          const interactive = Boolean(item.onClick || item.href);
          const Tag = item.href ? "a" : interactive ? "button" : "span";
          return (
            <React.Fragment key={item.key ?? i}>
              {i > 0 && (
                <li
                  aria-hidden="true"
                  style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}
                >
                  {SEP}
                </li>
              )}
              <li>
                <Tag
                  href={item.href}
                  onClick={item.onClick}
                  aria-current={item.current ? "true" : undefined}
                  data-breadcrumb-step={item.key ?? undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-1) var(--space-3)",
                    borderRadius: "var(--radius-pill)",
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--text-xs)",
                    fontWeight: "var(--weight-medium)",
                    border: "1px solid",
                    borderColor: item.current ? "var(--accent-color)" : "var(--border-color)",
                    background: item.current ? "var(--accent-soft)" : "var(--bg-quaternary)",
                    color: item.current ? "var(--text-primary)" : "var(--text-tertiary)",
                    textDecoration: "none",
                    cursor: interactive ? "pointer" : "default",
                  }}
                >
                  {item.kind && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-2xs)",
                        textTransform: "uppercase",
                        letterSpacing: "var(--tracking-wide)",
                        opacity: 0.75,
                      }}
                    >
                      {item.kind}
                    </span>
                  )}
                  {item.label}
                </Tag>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
