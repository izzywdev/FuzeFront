import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Lede } from "./Lede.jsx";

describe("<Lede>", () => {
  it("renders its children inside a <p> by default", () => {
    render(<Lede>Real-time monitoring across every Fuze product.</Lede>);
    const node = screen.getByText("Real-time monitoring across every Fuze product.");
    expect(node.tagName).toBe("P");
  });

  it("defaults to text-lg text-secondary-300 max-w-2xl mx-auto mb-8 (the flagged pattern)", () => {
    render(<Lede data-testid="lede">content</Lede>);
    const cls = screen.getByTestId("lede").className;
    expect(cls).toContain("text-lg");
    expect(cls).toContain("text-secondary-300");
    expect(cls).toContain("max-w-2xl");
    expect(cls).toContain("mx-auto");
    expect(cls).toContain("mb-8");
  });

  it.each([
    ["onDark", "text-secondary-300"],
    ["onLight", "text-gray-600"],
  ])("tone=%s maps to %s", (tone, expected) => {
    render(
      <Lede tone={tone} data-testid="lede">
        content
      </Lede>
    );
    expect(screen.getByTestId("lede").className).toContain(expected);
  });

  it.each([
    ["base", "text-lg"],
    ["responsive", "text-lg sm:text-xl"],
  ])("size=%s maps to %s", (size, expected) => {
    render(
      <Lede size={size} data-testid="lede">
        content
      </Lede>
    );
    expect(screen.getByTestId("lede").className).toContain(expected);
  });

  it.each([
    ["xl", "max-w-xl"],
    ["2xl", "max-w-2xl"],
    ["3xl", "max-w-3xl"],
  ])("maxWidth=%s maps to %s", (maxWidth, expected) => {
    render(
      <Lede maxWidth={maxWidth} data-testid="lede">
        content
      </Lede>
    );
    expect(screen.getByTestId("lede").className).toContain(expected);
  });

  it.each([
    ["none", ""],
    ["sm", "mb-6"],
    ["md", "mb-8"],
    ["lg", "mb-10"],
  ])("spacing=%s maps to %s", (spacing, expected) => {
    render(
      <Lede spacing={spacing} data-testid="lede">
        content
      </Lede>
    );
    const cls = screen.getByTestId("lede").className;
    if (expected) {
      expect(cls).toContain(expected);
    } else {
      expect(cls).not.toMatch(/\bmb-\d+\b/);
    }
  });

  it("leading=true adds leading-relaxed", () => {
    render(
      <Lede leading data-testid="lede">
        content
      </Lede>
    );
    expect(screen.getByTestId("lede").className).toContain("leading-relaxed");
  });

  it("leading=false (default) omits leading-relaxed", () => {
    render(<Lede data-testid="lede">content</Lede>);
    expect(screen.getByTestId("lede").className).not.toContain("leading-relaxed");
  });

  it("renders as a different element via `as`", () => {
    render(
      <Lede as="span" data-testid="lede">
        content
      </Lede>
    );
    expect(screen.getByTestId("lede").tagName).toBe("SPAN");
  });

  it("merges a caller className alongside the computed classes", () => {
    render(
      <Lede className="relative" data-testid="lede">
        content
      </Lede>
    );
    const cls = screen.getByTestId("lede").className;
    expect(cls).toContain("text-secondary-300");
    expect(cls).toContain("relative");
  });

  it("forwards arbitrary data-* and aria-* attributes", () => {
    render(
      <Lede data-testid="lede" aria-live="polite">
        content
      </Lede>
    );
    expect(screen.getByTestId("lede")).toHaveAttribute("aria-live", "polite");
  });
});
