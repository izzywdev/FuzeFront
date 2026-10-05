import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionLede } from "./SectionLede.jsx";

describe("<SectionLede>", () => {
  it("renders its children as a <p> by default", () => {
    render(<SectionLede>Everything a growing SaaS product needs.</SectionLede>);
    const node = screen.getByText("Everything a growing SaaS product needs.");
    expect(node.tagName).toBe("P");
  });

  it("renders as the element named by `as`", () => {
    render(<SectionLede as="div">Inline lede</SectionLede>);
    expect(screen.getByText("Inline lede").tagName).toBe("DIV");
  });

  it("sizes text at the DS --text-lg token", () => {
    render(<SectionLede>Sized text</SectionLede>);
    expect(screen.getByText("Sized text").style.fontSize).toBe("var(--text-lg)");
  });

  it("colors text at the DS --text-secondary token, never a raw gray shade", () => {
    render(<SectionLede>Toned text</SectionLede>);
    expect(screen.getByText("Toned text").style.color).toBe(
      "var(--text-secondary)"
    );
  });

  it("caps width at the DS --container-2xl token (matches max-w-2xl)", () => {
    render(<SectionLede>Capped width</SectionLede>);
    expect(screen.getByText("Capped width").style.maxWidth).toBe(
      "var(--container-2xl)"
    );
  });

  it("centers itself horizontally and its text", () => {
    render(<SectionLede>Centered</SectionLede>);
    const node = screen.getByText("Centered");
    expect(node.style.marginInline).toBe("auto");
    expect(node.style.textAlign).toBe("center");
  });

  it("has zero margin by default beyond the centering inline margin", () => {
    render(<SectionLede>No stray margin</SectionLede>);
    const node = screen.getByText("No stray margin");
    expect(node.style.marginTop).toBe("0px");
    expect(node.style.marginBottom).toBe("0px");
  });

  it("passes through arbitrary attributes (a11y labelling / test hooks)", () => {
    render(
      <SectionLede data-testid="lede" aria-live="polite">
        Hello
      </SectionLede>
    );
    const node = screen.getByTestId("lede");
    expect(node).toHaveAttribute("aria-live", "polite");
    expect(node).toHaveTextContent("Hello");
  });

  it("merges a caller className with the base class", () => {
    render(<SectionLede className="mb-10">Classed</SectionLede>);
    const node = screen.getByText("Classed");
    expect(node.className).toContain("ds-section-lede");
    expect(node.className).toContain("mb-10");
  });

  it("caller style overrides the base style", () => {
    render(<SectionLede style={{ color: "red" }}>Overridden</SectionLede>);
    expect(screen.getByText("Overridden").style.color).toBe("red");
  });
});
