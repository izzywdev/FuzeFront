import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthCard } from "./AuthCard.jsx";

describe("<AuthCard>", () => {
  it("renders its children", () => {
    render(
      <AuthCard>
        <h2>Sign in</h2>
      </AuthCard>
    );
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("defaults to left-aligned text", () => {
    const { container } = render(
      <AuthCard>
        <p>content</p>
      </AuthCard>
    );
    expect(container.firstChild.style.textAlign).toBe("left");
  });

  it("supports align=center for a confirmation/success state", () => {
    const { container } = render(
      <AuthCard align="center">
        <p>Done</p>
      </AuthCard>
    );
    expect(container.firstChild.style.textAlign).toBe("center");
  });

  it("uses the design-system radius/shadow/seam tokens, never raw values", () => {
    const { container } = render(
      <AuthCard>
        <p>content</p>
      </AuthCard>
    );
    const card = container.firstChild;
    expect(card.style.borderRadius).toBe("var(--radius-xl)");
    expect(card.style.backgroundColor).toBe("var(--bg-tertiary)");
    expect(card.style.boxShadow).toContain("var(--shadow)");
  });

  it("renders the seam accent as a separator at the top of the card", () => {
    render(
      <AuthCard>
        <p>content</p>
      </AuthCard>
    );
    const seam = screen.getByRole("separator");
    expect(seam).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("accepts a custom maxWidth", () => {
    const { container } = render(
      <AuthCard maxWidth="480px">
        <p>content</p>
      </AuthCard>
    );
    expect(container.firstChild.style.maxWidth).toBe("480px");
  });

  it("merges a caller-supplied style without dropping token defaults", () => {
    const { container } = render(
      <AuthCard style={{ marginBlock: "0" }}>
        <p>content</p>
      </AuthCard>
    );
    const card = container.firstChild;
    expect(card.style.marginBlock).toBe("0");
    expect(card.style.borderRadius).toBe("var(--radius-xl)");
  });

  it("forwards arbitrary attributes (e.g. data-testid) to the rendered div", () => {
    render(
      <AuthCard data-testid="auth-card">
        <p>content</p>
      </AuthCard>
    );
    expect(screen.getByTestId("auth-card")).toBeInTheDocument();
  });
});
