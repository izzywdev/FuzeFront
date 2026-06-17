import React from "react";

// Each integration type reads by hue, tuned to the cool runtime palette.
const TYPES = {
  "module-federation": {
    emoji: "🔗",
    gradient: "linear-gradient(135deg, #15414f, var(--accent-2))",
  },
  iframe: {
    emoji: "🖼️",
    gradient: "linear-gradient(135deg, #4a3a12, var(--warning-color))",
  },
  "web-component": {
    emoji: "🧩",
    gradient: "linear-gradient(135deg, #2f1f4f, var(--accent-color))",
  },
  other: {
    emoji: "📱",
    gradient: "linear-gradient(135deg, #2f1f4f, var(--accent-color))",
  },
};

// The small status dot that pins the icon's corner.
const HealthDot = ({ isHealthy }) => (
  <span
    aria-hidden="true"
    style={{
      position: "absolute",
      bottom: "-2px",
      right: "-2px",
      width: "12px",
      height: "12px",
      borderRadius: "var(--radius-pill)",
      background: isHealthy ? "var(--success-color)" : "var(--error-color)",
      border: "2px solid var(--bg-tertiary)",
    }}
  />
);

// The mono pill naming the runtime integration strategy.
const IntegrationBadge = ({ integrationType }) => (
  <span
    style={{
      display: "inline-block",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-2xs)",
      fontWeight: "var(--weight-medium)",
      lineHeight: 1,
      padding: "var(--space-1) var(--space-2)",
      borderRadius: "var(--radius-sm)",
      background: "var(--accent-soft)",
      color: "var(--accent-color)",
      textTransform: "lowercase",
      whiteSpace: "nowrap",
    }}
  >
    {integrationType}
  </span>
);

/**
 * The dashboard launcher card — the primary surface of the runtime fabric.
 * Lifts and reveals the --seam along its top edge on hover; an offline app
 * is grayscaled, dimmed and inert.
 */
export function AppCard({
  name,
  description,
  integrationType = "other",
  iconUrl,
  isHealthy = true,
  onClick,
  style,
  ...rest
}) {
  const type = TYPES[integrationType] || TYPES.other;

  const lift = (e) => {
    if (!isHealthy) return;
    e.currentTarget.style.transform = "translateY(-2px)";
    e.currentTarget.style.boxShadow = "var(--shadow-md)";
    e.currentTarget.style.borderColor = "transparent";
    const seam = e.currentTarget.querySelector("[data-seam]");
    if (seam) seam.style.opacity = "1";
  };

  const settle = (e) => {
    e.currentTarget.style.transform = "translateY(0)";
    e.currentTarget.style.boxShadow = "none";
    e.currentTarget.style.borderColor = "var(--border-color)";
    const seam = e.currentTarget.querySelector("[data-seam]");
    if (seam) seam.style.opacity = "0";
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
      onMouseEnter={lift}
      onMouseLeave={settle}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-6)",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-lg)",
        cursor: isHealthy ? "pointer" : "not-allowed",
        opacity: isHealthy ? 1 : 0.6,
        filter: isHealthy ? "none" : "grayscale(0.5)",
        transition:
          "transform var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)",
        ...style,
      }}
      {...rest}
    >
      {/* The fuse seam, revealed along the top edge as the card lifts. */}
      <span
        data-seam
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "2px",
          background: "var(--seam)",
          opacity: 0,
          transition: "opacity var(--duration-base) var(--ease-standard)",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          marginBottom: "var(--space-4)",
        }}
      >
        <div style={{ position: "relative", width: "40px", height: "40px", flex: "none" }}>
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                objectFit: "cover",
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div
              aria-hidden="true"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-2xl)",
                background: type.gradient,
              }}
            >
              {type.emoji}
            </div>
          )}
          <HealthDot isHealthy={isHealthy} />
        </div>

        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-lg)",
              fontWeight: "var(--weight-semibold)",
              color: isHealthy ? "var(--text-primary)" : "var(--text-tertiary)",
              lineHeight: 1.2,
            }}
          >
            {name}
            {!isHealthy && (
              <span
                style={{
                  marginLeft: "var(--space-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-regular)",
                  color: "var(--error-color)",
                }}
              >
                (Offline)
              </span>
            )}
          </h3>
          <div style={{ marginTop: "var(--space-1)" }}>
            <IntegrationBadge integrationType={integrationType} />
          </div>
        </div>
      </div>

      {description && (
        <p
          style={{
            margin: 0,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.4,
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}
