import React from "react";
import { SeamDivider } from "../brand/SeamDivider.jsx";

/**
 * AuthCard — the elevated, seam-topped card chrome shared by every
 * standalone auth-style form (sign in / sign up, create-organization,
 * provisioning). Extracted from the repeated `className="auth-form"`
 * (frontend/src/index.css) that CreateOrganizationPage and LoginPage each
 * hand-rolled (ds-fp:9f908f97503d).
 *
 * Distinct from `CenteredCard`: CenteredCard owns full-viewport centering
 * (`minHeight: 100vh` flex wrapper) for a page with no other chrome around
 * it; AuthCard is the card itself, meant to sit inside a page's existing
 * content area (it centers itself horizontally via `margin-inline: auto`,
 * not the viewport) and carries the signature top "fuse seam" accent that
 * CenteredCard does not.
 */
export function AuthCard({
  align = "left",
  maxWidth = "400px",
  children,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        position: "relative",
        maxWidth,
        marginBlock: "var(--space-8)",
        marginInline: "auto",
        padding: "var(--space-8)",
        textAlign: align,
        backgroundColor: "var(--bg-tertiary)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--border-color)",
        boxShadow: "0 24px 60px -24px var(--shadow)",
        overflow: "hidden",
        transition:
          "background-color var(--duration-base) var(--ease-standard), " +
          "border-color var(--duration-base) var(--ease-standard)",
        ...style,
      }}
      {...rest}
    >
      <SeamDivider
        thickness={2}
        style={{ position: "absolute", top: 0, insetInline: 0, width: "auto" }}
      />
      {children}
    </div>
  );
}
