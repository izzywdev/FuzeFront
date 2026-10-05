import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroContent } from "./HeroContent.jsx";

describe("<HeroContent>", () => {
  it("renders its children", () => {
    render(
      <HeroContent>
        <h1>About FuzeOne</h1>
      </HeroContent>
    );
    expect(screen.getByRole("heading", { name: "About FuzeOne" })).toBeInTheDocument();
  });

  it("applies position: relative and text-align: center", () => {
    render(<HeroContent data-testid="hc">content</HeroContent>);
    const el = screen.getByTestId("hc");
    expect(el.style.position).toBe("relative");
    expect(el.style.textAlign).toBe("center");
  });

  it("defaults to the Container 7xl width token, centered", () => {
    render(<HeroContent data-testid="hc">content</HeroContent>);
    const el = screen.getByTestId("hc");
    expect(el.style.maxWidth).toBe("var(--container-7xl)");
    expect(el.style.marginInline).toBe("auto");
  });

  it("passes size through to Container's width token", () => {
    render(
      <HeroContent size="4xl" data-testid="hc">
        content
      </HeroContent>
    );
    expect(screen.getByTestId("hc").style.maxWidth).toBe("var(--container-4xl)");
  });

  it("keeps the ds-container gutter class alongside its own marker class", () => {
    render(<HeroContent data-testid="hc">content</HeroContent>);
    const cls = screen.getByTestId("hc").className;
    expect(cls).toContain("ds-container");
    expect(cls).toContain("ds-container--gutter");
    expect(cls).toContain("ds-hero-content");
  });

  it("gutter=false drops the padding class, same as Container", () => {
    render(
      <HeroContent gutter={false} data-testid="hc">
        content
      </HeroContent>
    );
    expect(screen.getByTestId("hc").className).not.toContain("ds-container--gutter");
  });

  it("merges a caller className alongside its own marker class", () => {
    render(
      <HeroContent className="extra" data-testid="hc">
        content
      </HeroContent>
    );
    expect(screen.getByTestId("hc").className).toContain("extra");
    expect(screen.getByTestId("hc").className).toContain("ds-hero-content");
  });

  it("merges a caller style without dropping relative positioning or centering", () => {
    render(
      <HeroContent style={{ marginTop: "var(--space-6)" }} data-testid="hc">
        content
      </HeroContent>
    );
    const el = screen.getByTestId("hc");
    expect(el.style.position).toBe("relative");
    expect(el.style.textAlign).toBe("center");
    expect(el.style.marginTop).toBe("var(--space-6)");
  });

  it("renders as a different element via `as`, passed through to Container", () => {
    render(
      <HeroContent as="section" data-testid="hc">
        content
      </HeroContent>
    );
    expect(screen.getByTestId("hc").tagName).toBe("SECTION");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(
      <HeroContent data-testid="hc" aria-label="hero content">
        content
      </HeroContent>
    );
    expect(screen.getByTestId("hc")).toHaveAttribute("aria-label", "hero content");
  });
});
