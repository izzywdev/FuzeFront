import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageShell } from "./PageShell.jsx";

describe("<PageShell>", () => {
  it("renders children inside a div by default", () => {
    render(<PageShell>content</PageShell>);
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("applies the page background token and the header-offset top padding", () => {
    render(<PageShell data-testid="shell">content</PageShell>);
    const el = screen.getByTestId("shell");
    expect(el.style.background).toBe("var(--bg-secondary)");
    expect(el.style.paddingBlockStart).toBe("var(--space-16)");
  });

  it("uses a logical property (padding-block-start), not a physical padding-top", () => {
    render(<PageShell data-testid="shell">content</PageShell>);
    const el = screen.getByTestId("shell");
    expect(el.style.paddingTop).toBe("");
    expect(el.style.paddingBlockStart).toBe("var(--space-16)");
  });

  it("renders as a different element via `as`", () => {
    render(
      <PageShell as="main" data-testid="shell">
        content
      </PageShell>
    );
    expect(screen.getByTestId("shell").tagName).toBe("MAIN");
  });

  it("merges a caller className", () => {
    render(
      <PageShell className="relative" data-testid="shell">
        content
      </PageShell>
    );
    expect(screen.getByTestId("shell").className).toContain("relative");
  });

  it("merges caller style without dropping the computed background/padding", () => {
    render(
      <PageShell style={{ minHeight: "100vh" }} data-testid="shell">
        content
      </PageShell>
    );
    const el = screen.getByTestId("shell");
    expect(el.style.minHeight).toBe("100vh");
    expect(el.style.background).toBe("var(--bg-secondary)");
    expect(el.style.paddingBlockStart).toBe("var(--space-16)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(
      <PageShell data-testid="shell" aria-label="page">
        content
      </PageShell>
    );
    expect(screen.getByTestId("shell")).toHaveAttribute("aria-label", "page");
  });
});
