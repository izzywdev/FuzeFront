import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeroTitle } from "./PageHeroTitle.jsx";

describe("<PageHeroTitle>", () => {
  it("renders its children as an <h1> by default", () => {
    render(<PageHeroTitle>Blog &amp; Insights</PageHeroTitle>);
    const node = screen.getByText("Blog & Insights");
    expect(node.tagName).toBe("H1");
  });

  it("renders as the element named by `as` (h2)", () => {
    render(<PageHeroTitle as="h2">Secondary hero title</PageHeroTitle>);
    expect(screen.getByText("Secondary hero title").tagName).toBe("H2");
  });

  it("uses the DS sans font, bold weight, and standard primary text color — never raw values", () => {
    render(<PageHeroTitle>Get in Touch</PageHeroTitle>);
    const node = screen.getByText("Get in Touch");
    expect(node.style.fontFamily).toBe("var(--role-page-hero-title-font)");
    expect(node.style.fontWeight).toBe("var(--role-page-hero-title-weight)");
    expect(node.style.color).toBe("var(--text-primary)");
  });

  it("applies the responsive size class so the breakpoint lives in injected CSS, not inline style", () => {
    render(<PageHeroTitle>Solutions for Every Business</PageHeroTitle>);
    expect(screen.getByText("Solutions for Every Business")).toHaveClass(
      "ds-page-hero-title"
    );
  });

  it("fixes the bottom margin to the DS spacing scale via the logical marginBlockEnd (RTL-safe)", () => {
    render(<PageHeroTitle>Spacing</PageHeroTitle>);
    expect(screen.getByText("Spacing").style.marginBlockEnd).toBe("var(--space-6)");
  });

  it("merges a caller className onto the responsive size class", () => {
    render(<PageHeroTitle className="text-center">Centered</PageHeroTitle>);
    const node = screen.getByText("Centered");
    expect(node).toHaveClass("ds-page-hero-title");
    expect(node).toHaveClass("text-center");
  });

  it("composes an emphasis span (e.g. a gradient-highlighted word) as a child", () => {
    render(
      <PageHeroTitle>
        <span data-testid="emphasis">Blog</span> &amp; Insights
      </PageHeroTitle>
    );
    expect(screen.getByTestId("emphasis")).toHaveTextContent("Blog");
  });

  it("caller style overrides the base style", () => {
    render(<PageHeroTitle style={{ textAlign: "center" }}>Overridden</PageHeroTitle>);
    expect(screen.getByText("Overridden").style.textAlign).toBe("center");
  });

  it("passes through arbitrary attributes (a11y / test hooks)", () => {
    render(<PageHeroTitle data-testid="page-hero-title">Contact</PageHeroTitle>);
    expect(screen.getByTestId("page-hero-title")).toHaveTextContent("Contact");
  });
});
