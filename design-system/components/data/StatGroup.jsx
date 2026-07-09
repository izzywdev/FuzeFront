import React from "react";

/**
 * Horizontal band of KPI metric tiles — value, optional unit, label, optional delta.
 * Use on dashboards and summary headers (fleet status, billing overview, analytics).
 */
export function StatGroup({ items = [], style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "2px",
        ...style,
      }}
      {...rest}
    >
      {items.map((item, i) => {
        const deltaColor = item.deltaDir === "down"
          ? "var(--error-color)"
          : "var(--success-color)";
        const isFirst = i === 0;
        const isLast = i === items.length - 1;
        return (
          <div
            key={i}
            style={{
              flex: "1 1 120px",
              padding: "16px 20px",
              background: "var(--bg-quaternary)",
              border: "1px solid var(--border-color)",
              borderRadius: isFirst
                ? "var(--radius-lg) 0 0 var(--radius-lg)"
                : isLast
                ? "0 var(--radius-lg) var(--radius-lg) 0"
                : "0",
            }}
          >
            <div style={{
              fontSize: "var(--text-2xl)",
              fontWeight: "var(--weight-black)",
              letterSpacing: "var(--tracking-display)",
              color: "var(--text-primary)",
              lineHeight: 1,
              fontFamily: "var(--font-display)",
            }}>
              {item.value}
              {item.unit && (
                <span style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-medium)",
                  color: "var(--text-tertiary)",
                  marginLeft: "4px",
                }}>
                  {item.unit}
                </span>
              )}
            </div>
            <div style={{
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-medium)",
              color: "var(--text-tertiary)",
              marginTop: "4px",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-wide)",
            }}>
              {item.label}
            </div>
            {item.delta && (
              <div style={{
                fontSize: "var(--text-xs)",
                color: deltaColor,
                marginTop: "4px",
              }}>
                {item.deltaDir === "down" ? "↓" : "↑"} {item.delta}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
