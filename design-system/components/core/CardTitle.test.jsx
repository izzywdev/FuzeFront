import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardTitle } from "./CardTitle.jsx";

describe("<CardTitle>", () => {
  it("renders its children", () => {
    render(<CardTitle>Instant onboarding</CardTitle>);
    expect(screen.getByText("Instant onboarding")).toBeInTheDocument();
  });

  it("renders as an h3 by default (a11y heading level)", () => {
    render(<CardTitle>Title</CardTitle>);
    expect(screen.getByRole("heading", { level: 3, name: "Title" })).toBeInTheDocument();
  });

  it("uses the DS --text-lg / --weight-semibold / --text-primary / --space-2 tokens, never a raw value", () => {
    const { container } = render(<CardTitle>Title</CardTitle>);
    const el = container.firstChild;
    expect(el.style.fontSize).toBe("var(--text-lg)");
    expect(el.style.fontWeight).toBe("var(--weight-semibold)");
    expect(el.style.color).toBe("var(--text-primary)");
    expect(el.style.marginBlockEnd).toBe("var(--space-2)");
  });

  it("as switches the rendered heading level", () => {
    render(<CardTitle as="h2">Title</CardTitle>);
    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeInTheDocument();
  });

  it("tone switches the DS text-color token", () => {
    const { container } = render(<CardTitle tone="secondary">Title</CardTitle>);
    expect(container.firstChild.style.color).toBe("var(--text-secondary)");
  });

  it("spacing switches the bottom-margin token", () => {
    const { container } = render(<CardTitle spacing="md">Title</CardTitle>);
    expect(container.firstChild.style.marginBlockEnd).toBe("var(--space-4)");
  });

  it("forwards an extra className (e.g. a group-hover interaction state)", () => {
    render(<CardTitle className="group-hover:text-primary-700">Title</CardTitle>);
    expect(screen.getByText("Title")).toHaveClass("group-hover:text-primary-700");
  });

  it("merges a caller-supplied style without dropping the token values", () => {
    const { container } = render(<CardTitle style={{ marginTop: "var(--space-4)" }}>Title</CardTitle>);
    const el = container.firstChild;
    expect(el.style.marginTop).toBe("var(--space-4)");
    expect(el.style.fontWeight).toBe("var(--weight-semibold)");
  });
});
