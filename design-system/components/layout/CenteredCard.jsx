import React from "react";

/**
 * CenteredCard — replaces the `containerStyle + cardStyle` pair used in full-page
 * auth/invite/status views. Centers a card in the viewport both axes.
 */
export function CenteredCard({
  maxWidth = "440px",
  align = "center",
  children,
  style,
  containerStyle,
  ...rest
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "var(--bg-primary)",
        padding: "var(--space-6)",
        ...containerStyle,
      }}
    >
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-6)",
          maxWidth,
          width: "100%",
          textAlign: align,
          ...style,
        }}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}
