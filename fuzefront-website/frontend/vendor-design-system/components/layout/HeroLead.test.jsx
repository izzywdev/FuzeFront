import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroLead } from "./HeroLead.jsx";

describe("<HeroLead>", () => {
  it("renders children inside a <p> by default", () => {
    render(<HeroLead>Hero copy</HeroLead>);
    const el = screen.getByText("Hero copy");
    expect(el.tagName).toBe("P");
  });

  it("pins data-theme=dark so the color token ignores the ambient theme", () => {
    render(<HeroLead data-testid="lead">Hero copy</HeroLead>);
    expect(screen.getByTestId("lead")).toHaveAttribute("data-theme", "dark");
  });

  it("uses the DS secondary text token, tokens only", () => {
    render(<HeroLead data-testid="lead">Hero copy</HeroLead>);
    expect(screen.getByTestId("lead").style.color).toBe("var(--text-secondary)");
  });

  it("caps width at the DS 2xl container token and centers it", () => {
    render(<HeroLead data-testid="lead">Hero copy</HeroLead>);
    const el = screen.getByTestId("lead");
    expect(el.style.maxWidth).toBe("var(--container-2xl)");
    expect(el.style.marginInline).toBe("auto");
  });

  it("uses the DS relaxed line-height token", () => {
    render(<HeroLead data-testid="lead">Hero copy</HeroLead>);
    expect(screen.getByTestId("lead").style.lineHeight).toBe("var(--leading-relaxed)");
  });

  it("applies the responsive font-size class and injects its scoped style", () => {
    const { container } = render(<HeroLead data-testid="lead">Hero copy</HeroLead>);
    expect(screen.getByTestId("lead").className).toContain("ds-hero-lead");
    expect(container.querySelector("style")?.textContent).toContain("var(--text-xl)");
  });

  it("renders as a different element via `as`", () => {
    render(
      <HeroLead as="div" data-testid="lead">
        Hero copy
      </HeroLead>
    );
    expect(screen.getByTestId("lead").tagName).toBe("DIV");
  });

  it("merges a caller className alongside ds-hero-lead", () => {
    render(
      <HeroLead className="relative" data-testid="lead">
        Hero copy
      </HeroLead>
    );
    const cls = screen.getByTestId("lead").className;
    expect(cls).toContain("ds-hero-lead");
    expect(cls).toContain("relative");
  });

  it("merges caller style without dropping the computed tokens", () => {
    render(
      <HeroLead style={{ textAlign: "center" }} data-testid="lead">
        Hero copy
      </HeroLead>
    );
    const el = screen.getByTestId("lead");
    expect(el.style.textAlign).toBe("center");
    expect(el.style.maxWidth).toBe("var(--container-2xl)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(
      <HeroLead data-testid="lead" aria-label="hero subtitle">
        Hero copy
      </HeroLead>
    );
    expect(screen.getByTestId("lead")).toHaveAttribute("aria-label", "hero subtitle");
  });
});
