import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroHeading } from "./HeroHeading.jsx";

describe("<HeroHeading>", () => {
  it("renders its children as an <h1> by default", () => {
    render(<HeroHeading>About FuzeOne</HeroHeading>);
    const node = screen.getByText("About FuzeOne");
    expect(node.tagName).toBe("H1");
  });

  it("renders as the element named by `as` (h2)", () => {
    render(<HeroHeading as="h2">Secondary hero title</HeroHeading>);
    expect(screen.getByText("Secondary hero title").tagName).toBe("H2");
  });

  it("uses the DS display font, extrabold weight, and fixed on-dark white — never raw values", () => {
    render(<HeroHeading>Join FuzeOne</HeroHeading>);
    const node = screen.getByText("Join FuzeOne");
    expect(node.style.fontFamily).toBe("var(--role-marketing-hero-font)");
    expect(node.style.fontWeight).toBe("var(--role-marketing-hero-weight)");
    expect(node.style.color).toBe("var(--primary-foreground)");
  });

  it("applies the responsive size class so the breakpoint lives in injected CSS, not inline style", () => {
    render(<HeroHeading>Press &amp; Media</HeroHeading>);
    expect(screen.getByText("Press & Media")).toHaveClass("ds-hero-heading");
  });

  it("defaults `spacing` to lg — 24px via the DS spacing scale", () => {
    render(<HeroHeading>Default spacing</HeroHeading>);
    expect(screen.getByText("Default spacing").style.marginBlockEnd).toBe(
      "var(--space-6)"
    );
  });

  it("resolves every `spacing` step to its DS spacing-scale token via the logical marginBlockEnd (RTL-safe)", () => {
    const cases = [
      ["none", "0"],
      ["md", "var(--space-4)"],
      ["lg", "var(--space-6)"],
    ];
    cases.forEach(([spacing, expected]) => {
      const { unmount } = render(
        <HeroHeading spacing={spacing}>{spacing}</HeroHeading>
      );
      expect(screen.getByText(spacing).style.marginBlockEnd).toBe(expected);
      unmount();
    });
  });

  it("falls back to lg for an unknown spacing value", () => {
    render(<HeroHeading spacing="not-a-real-step">Fallback</HeroHeading>);
    expect(screen.getByText("Fallback").style.marginBlockEnd).toBe(
      "var(--space-6)"
    );
  });

  it("merges a caller className onto the responsive size class", () => {
    render(<HeroHeading className="text-center">Centered</HeroHeading>);
    const node = screen.getByText("Centered");
    expect(node).toHaveClass("ds-hero-heading");
    expect(node).toHaveClass("text-center");
  });

  it("composes an emphasis span (e.g. GradientText) as a child", () => {
    render(
      <HeroHeading>
        About <span data-testid="emphasis">FuzeOne</span>
      </HeroHeading>
    );
    expect(screen.getByTestId("emphasis")).toHaveTextContent("FuzeOne");
  });

  it("caller style overrides the base style", () => {
    render(<HeroHeading style={{ textAlign: "center" }}>Overridden</HeroHeading>);
    expect(screen.getByText("Overridden").style.textAlign).toBe("center");
  });

  it("passes through arbitrary attributes (a11y / test hooks)", () => {
    render(<HeroHeading data-testid="page-hero-title">Careers</HeroHeading>);
    expect(screen.getByTestId("page-hero-title")).toHaveTextContent("Careers");
  });
});
