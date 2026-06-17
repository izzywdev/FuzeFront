import React from "react";

const SIZES = {
  sm: { box: 28, font: "var(--text-2xs)" },
  md: { box: 36, font: "var(--text-sm)" },
  lg: { box: 48, font: "var(--text-md)" },
};

// Derive up to two initials: first letters of the first two name words,
// else first letter of name, else first letter of the email local-part.
function deriveInitials(name, email) {
  const n = (name || "").trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }
  const e = (email || "").trim();
  if (e) return e[0].toUpperCase();
  return "?";
}

/**
 * Circular user avatar — initials on the indigo "fuse" gradient.
 * Initials are derived from `name` (falling back to `email`), and the
 * full name/email becomes the title for hover + screen readers.
 * Mirrors the UserMenu avatar button in the host shell's top bar.
 */
export function Avatar({
  name,
  email,
  size = "md",
  interactive = false,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const initials = deriveInitials(name, email);
  const label = name || email || "User";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: s.box,
        height: s.box,
        borderRadius: "var(--radius-pill)",
        background:
          "linear-gradient(45deg, var(--accent-color), var(--accent-hover))",
        color: "#fff",
        fontFamily: "var(--font-sans)",
        fontSize: s.font,
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "var(--tracking-wide)",
        lineHeight: 1,
        userSelect: "none",
        cursor: interactive ? "pointer" : "default",
        boxShadow: "var(--shadow-xs)",
        transition:
          "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={
        interactive
          ? (e) => {
              e.currentTarget.style.transform = "scale(1.05)";
              e.currentTarget.style.boxShadow = "var(--shadow-accent)";
            }
          : undefined
      }
      onMouseLeave={
        interactive
          ? (e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.boxShadow = "var(--shadow-xs)";
            }
          : undefined
      }
      {...rest}
    >
      {initials}
    </span>
  );
}
