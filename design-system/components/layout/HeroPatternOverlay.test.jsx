import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HeroPatternOverlay } from "./HeroPatternOverlay.jsx";

describe("<HeroPatternOverlay>", () => {
  it("renders an absolutely-positioned, inset-0 div", () => {
    const { container } = render(<HeroPatternOverlay />);
    const el = container.firstChild;
    expect(el.style.position).toBe("absolute");
    expect(el.style.inset).toBe("0");
  });

  it("defaults opacity to 0.1", () => {
    const { container } = render(<HeroPatternOverlay />);
    expect(container.firstChild.style.opacity).toBe("0.1");
  });

  it.each([
    [0.1],
    [0.2],
    [0.3],
  ])("opacity=%s is applied verbatim", (opacity) => {
    const { container } = render(<HeroPatternOverlay opacity={opacity} />);
    expect(Number(container.firstChild.style.opacity)).toBeCloseTo(opacity);
  });

  it("is purely decorative: aria-hidden and no pointer events", () => {
    const { container } = render(<HeroPatternOverlay />);
    const el = container.firstChild;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.style.pointerEvents).toBe("none");
  });

  it("paints the dot grid from the accent color token, not a raw value", () => {
    const { container } = render(<HeroPatternOverlay />);
    expect(container.firstChild.style.backgroundImage).toMatch(/var\(--accent-color\)/);
  });

  it("merges a caller-supplied style without dropping the overlay properties", () => {
    const { container } = render(<HeroPatternOverlay style={{ zIndex: 0 }} />);
    const el = container.firstChild;
    expect(el.style.zIndex).toBe("0");
    expect(el.style.position).toBe("absolute");
  });

  it("forwards arbitrary data-* attributes (test hooks)", () => {
    const { container } = render(<HeroPatternOverlay data-testid="hero-pattern" />);
    expect(container.firstChild).toHaveAttribute("data-testid", "hero-pattern");
  });
});
