import React, { useState } from "react";
import { HealthDot } from "./HealthDot.jsx";

// The per-integration-type icon fallback, tuned to the cool runtime palette —
// mirrors <AppCard> so the launcher grid and the dashboard cards agree.
const TYPE_GRADIENT = {
  "module-federation": "linear-gradient(135deg, #15414f, var(--accent-2))",
  iframe: "linear-gradient(135deg, #4a3a12, var(--warning-color))",
  "web-component": "linear-gradient(135deg, #2f1f4f, var(--accent-color))",
  other: "linear-gradient(135deg, #2f1f4f, var(--accent-color))",
};
const TYPE_EMOJI = {
  "module-federation": "🔗",
  iframe: "🖼️",
  "web-component": "🧩",
  other: "📱",
};

/**
 * The launcher app tile — a compact icon + name cell for the 9-dots app grid,
 * modeled on the Google app launcher: no description and no integration badge,
 * just the manifest icon and menu label. Offline apps are grayscaled, dimmed
 * and inert (a corner health dot marks the state). Use <AppCard> instead for
 * the full-detail dashboard / management surfaces.
 */
export function AppTile({
  name,
  integrationType = "other",
  iconUrl,
  iconGlyph,
  isHealthy = true,
  onClick,
  style,
  ...rest
}) {
  // A manifest may declare an emoji glyph (Icon.kind = "emoji"); it takes
  // precedence over the per-integration-type fallback emoji.
  const glyph = iconGlyph || TYPE_EMOJI[integrationType] || TYPE_EMOJI.other;
  const gradient = TYPE_GRADIENT[integrationType] || TYPE_GRADIENT.other;
  // A broken icon URL falls back to the emoji glyph, per the documented
  // contract — swap the whole node, don't just hide the <img>.
  const [iconFailed, setIconFailed] = useState(false);
  const showImage = Boolean(iconUrl) && !iconFailed;

  const highlight = (e) => {
    if (!isHealthy) return;
    e.currentTarget.style.backgroundColor = "var(--bg-quaternary)";
  };
  const settle = (e) => {
    e.currentTarget.style.backgroundColor = "transparent";
  };

  return (
    <div
      role="button"
      tabIndex={isHealthy ? 0 : -1}
      aria-disabled={!isHealthy}
      title={isHealthy ? name : `${name} (offline)`}
      onClick={isHealthy ? onClick : undefined}
      onKeyDown={(e) => {
        if (!isHealthy || !onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e);
        }
      }}
      onMouseEnter={highlight}
      onMouseLeave={settle}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-3) var(--space-2)",
        borderRadius: "var(--radius-md)",
        background: "transparent",
        cursor: isHealthy ? "pointer" : "not-allowed",
        opacity: isHealthy ? 1 : 0.6,
        filter: isHealthy ? "none" : "grayscale(0.5)",
        transition: "background-color var(--duration-base) var(--ease-standard)",
        textAlign: "center",
        ...style,
      }}
      {...rest}
    >
      <div style={{ position: "relative", width: "48px", height: "48px", flex: "none" }}>
        {showImage ? (
          <img
            src={iconUrl}
            alt=""
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              objectFit: "cover",
            }}
            onError={() => setIconFailed(true)}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--text-2xl)",
              background: gradient,
            }}
          >
            {glyph}
          </div>
        )}
        <HealthDot healthy={isHealthy} size="sm" overlay />
      </div>

      <span
        style={{
          maxWidth: "100%",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--weight-medium)",
          color: isHealthy ? "var(--text-primary)" : "var(--text-tertiary)",
          lineHeight: "var(--leading-snug)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {name}
      </span>
    </div>
  );
}
