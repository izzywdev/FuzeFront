import React from "react";

const SIZES = {
  sm: { box: 24, font: "var(--text-xs)" },
  md: { box: 30, font: "var(--text-md)" },
  lg: { box: 42, font: "var(--text-xl)" },
};

/** First letter of up to the first two words of `name` (e.g. "CorpABC" -> "C",
 * "Northwind Traders" -> "NT"), uppercased. Falls back to "?" for an empty name. */
function initialsOf(name) {
  if (!name || typeof name !== "string") return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const chars = words.slice(0, 2).map((w) => w[0]);
  return chars.join("").toUpperCase();
}

/**
 * A portal/tenant logo slot: renders `src` as an `<img>` when it loads, and
 * falls back to an initials tile (derived from `name`) — NEVER a broken-image
 * icon — when `src` is absent or fails to load. Mirrors `.brand-glyph` from
 * the white-label portal frames: accent-filled tile, on-accent text, display
 * font, `--radius-md`.
 */
export function Logo({
  src,
  name,
  alt,
  size = "md",
  shape = "tile",
  className,
  style,
  ...rest
}) {
  const [failed, setFailed] = React.useState(false);
  // Reset the broken-image flag if a new `src` arrives (e.g. portal switch).
  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const s = SIZES[size] || SIZES.md;
  const showImage = Boolean(src) && !failed;
  const radius = shape === "circle" ? "var(--radius-pill)" : "var(--radius-md)";
  const accessibleName = alt || name || "Logo";

  if (showImage) {
    return (
      <img
        src={src}
        alt={accessibleName}
        data-logo-state="image"
        onError={() => setFailed(true)}
        className={className}
        style={{
          width: s.box,
          height: s.box,
          flex: "none",
          borderRadius: radius,
          objectFit: "cover",
          display: "block",
          background: "var(--bg-quaternary)",
          ...style,
        }}
        {...rest}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={accessibleName}
      data-logo-state={src ? "fallback-error" : "fallback-initials"}
      className={className}
      style={{
        width: s.box,
        height: s.box,
        flex: "none",
        borderRadius: radius,
        display: "grid",
        placeItems: "center",
        background: "var(--accent-color)",
        color: "#fff",
        fontFamily: "var(--font-display)",
        fontWeight: "var(--weight-bold)",
        fontSize: s.font,
        lineHeight: 1,
        userSelect: "none",
        ...style,
      }}
      {...rest}
    >
      {initialsOf(name)}
    </span>
  );
}
