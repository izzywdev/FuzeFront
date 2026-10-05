import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Lead } from "./Lead.jsx";

describe("<Lead>", () => {
  it("renders its children as a <p> by default", () => {
    render(<Lead>Ready to build something amazing?</Lead>);
    const node = screen.getByText("Ready to build something amazing?");
    expect(node.tagName).toBe("P");
  });

  it("renders as the element named by `as`", () => {
    render(<Lead as="div">Block lead</Lead>);
    expect(screen.getByText("Block lead").tagName).toBe("DIV");
  });

  it("uses the DS text-xl / text-secondary tokens, never a raw value", () => {
    render(<Lead>Styled copy</Lead>);
    const node = screen.getByText("Styled copy");
    expect(node.style.fontSize).toBe("var(--text-xl)");
    expect(node.style.color).toBe("var(--text-secondary)");
  });

  it("defaults maxWidth to 2xl (the most common call site)", () => {
    render(<Lead>Default width</Lead>);
    expect(screen.getByText("Default width").style.maxWidth).toBe(
      "var(--container-2xl)"
    );
  });

  it("resolves every maxWidth step to its DS container-width token", () => {
    const cases = [
      ["2xl", "var(--container-2xl)"],
      ["3xl", "var(--container-3xl)"],
      ["4xl", "var(--container-4xl)"],
      ["none", "none"],
    ];
    cases.forEach(([maxWidth, expected]) => {
      const { unmount } = render(<Lead maxWidth={maxWidth}>{maxWidth}</Lead>);
      expect(screen.getByText(maxWidth).style.maxWidth).toBe(expected);
      unmount();
    });
  });

  it("falls back to 2xl for an unknown maxWidth value", () => {
    render(<Lead maxWidth="not-a-real-size">Fallback</Lead>);
    expect(screen.getByText("Fallback").style.maxWidth).toBe(
      "var(--container-2xl)"
    );
  });

  it("centers via margin-inline: auto by default (RTL-safe)", () => {
    render(<Lead>Centered</Lead>);
    expect(screen.getByText("Centered").style.marginInline).toBe("auto");
  });

  it("centered={false} omits the auto margin for a parent that already centers", () => {
    render(<Lead centered={false}>Not centered</Lead>);
    expect(screen.getByText("Not centered").style.marginInline).toBe("");
  });

  it("caller style merges with (and can override) the base style", () => {
    render(<Lead style={{ fontStyle: "italic" }}>Overridden</Lead>);
    const node = screen.getByText("Overridden");
    expect(node.style.fontStyle).toBe("italic");
    expect(node.style.color).toBe("var(--text-secondary)");
  });

  it("forwards arbitrary attributes (test hooks / a11y)", () => {
    render(<Lead data-testid="hero-lead">Hooked</Lead>);
    expect(screen.getByTestId("hero-lead")).toBeInTheDocument();
  });
});
