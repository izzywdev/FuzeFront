import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CtaBand } from "./CtaBand.jsx";

describe("<CtaBand>", () => {
  it("renders as a <section> by default, with its children", () => {
    render(
      <CtaBand data-testid="band">
        <h2>Ready to get started?</h2>
      </CtaBand>
    );
    const band = screen.getByTestId("band");
    expect(band.tagName).toBe("SECTION");
    expect(screen.getByText("Ready to get started?")).toBeInTheDocument();
  });

  it("applies the band surface via tokens only — top border, padding, background", () => {
    render(<CtaBand data-testid="band">content</CtaBand>);
    const band = screen.getByTestId("band");
    expect(band.style.paddingBlock).toBe("var(--space-20)");
    expect(band.style.background).toBe("var(--bg-tertiary)");
    expect(band.style.borderBlockStart).toBe("var(--border-width) solid var(--border-color)");
  });

  it("defaults the inner content column to the 3xl width token", () => {
    render(<CtaBand data-testid="band">content</CtaBand>);
    const band = screen.getByTestId("band");
    // Container renders a <style> (gutter CSS) alongside its own div, so the
    // width-capped element is the band's <div> child, not its first child.
    const inner = band.querySelector("div");
    expect(inner.style.maxWidth).toBe("var(--container-3xl)");
  });

  it("honors a custom maxWidth (e.g. the narrower product-detail CTA)", () => {
    render(
      <CtaBand maxWidth="2xl" data-testid="band">
        content
      </CtaBand>
    );
    const inner = screen.getByTestId("band").querySelector("div");
    expect(inner.style.maxWidth).toBe("var(--container-2xl)");
  });

  it("centers the content column — text-align: center on the innermost wrapper", () => {
    render(
      <CtaBand data-testid="band">
        <p>Talk to our team.</p>
      </CtaBand>
    );
    const innerMost = screen.getByText("Talk to our team.").parentElement;
    expect(innerMost.style.textAlign).toBe("center");
  });

  it("renders as a different element via `as`", () => {
    render(
      <CtaBand as="div" data-testid="band">
        content
      </CtaBand>
    );
    expect(screen.getByTestId("band").tagName).toBe("DIV");
  });

  it("merges a caller className and style without dropping the computed surface", () => {
    render(
      <CtaBand
        className="marketing-cta"
        style={{ marginBlockStart: "var(--space-8)" }}
        data-testid="band"
      >
        content
      </CtaBand>
    );
    const band = screen.getByTestId("band");
    expect(band.className).toBe("marketing-cta");
    expect(band.style.marginBlockStart).toBe("var(--space-8)");
    expect(band.style.paddingBlock).toBe("var(--space-20)");
  });

  it("uses CSS logical properties, not physical top/bottom — mirrors under RTL", () => {
    render(<CtaBand data-testid="band">content</CtaBand>);
    const band = screen.getByTestId("band");
    expect(band.style.borderTop).toBe("");
    expect(band.style.paddingTop).toBe("");
    expect(band.style.paddingBottom).toBe("");
  });

  it("forwards data-* and other DOM attributes", () => {
    render(
      <CtaBand data-testid="band" aria-label="Get started">
        content
      </CtaBand>
    );
    expect(screen.getByTestId("band")).toHaveAttribute("aria-label", "Get started");
  });
});
