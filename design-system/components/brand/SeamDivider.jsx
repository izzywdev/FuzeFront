import React from "react";

const ORIENTATIONS = {
  horizontal: {
    width: "100%",
    background: "var(--seam)",
  },
  vertical: {
    height: "100%",
    // re-aim the indigo->cyan seam down the vertical axis
    background: "linear-gradient(180deg, var(--accent-color) 0%, var(--accent-2) 100%)",
  },
};

/**
 * The signature glowing "fuse seam" — a thin bar painted with the brand
 * gradient, marking where modules fuse at runtime. Sits under the top bar
 * and atop cards.
 */
export function SeamDivider({
  orientation = "horizontal",
  thickness = 2,
  opacity = 1,
  glow = false,
  style,
  ...rest
}) {
  const isVertical = orientation === "vertical";
  const o = ORIENTATIONS[orientation] || ORIENTATIONS.horizontal;

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      style={{
        flex: "none",
        borderRadius: "var(--radius-pill)",
        height: isVertical ? "100%" : `${thickness}px`,
        width: isVertical ? `${thickness}px` : "100%",
        opacity,
        // the soft halo: a diffuse drop-shadow tinted with the fuse hue
        boxShadow: glow
          ? "0 0 8px var(--accent-color), 0 0 16px var(--accent-soft)"
          : "none",
        transition: "opacity var(--duration-base) var(--ease-standard)",
        ...o,
        ...style,
      }}
      {...rest}
    />
  );
}
