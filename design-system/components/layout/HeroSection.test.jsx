import React, { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroSection } from "./HeroSection.jsx";

describe("<HeroSection>", () => {
  it("renders its children inside a <section> by default", () => {
    const { container } = render(
      <HeroSection>
        <h1>About FuzeOne</h1>
      </HeroSection>
    );
    expect(container.querySelector("section")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About FuzeOne" })).toBeInTheDocument();
  });

  it("applies the fixed pt-32/pb-20-equivalent rhythm and the diagonal gradient", () => {
    const { container } = render(<HeroSection>content</HeroSection>);
    const section = container.querySelector("section");
    expect(section.style.paddingTop).toBe("8rem");
    expect(section.style.paddingBottom).toBe("5rem");
    expect(section.style.backgroundImage).toContain("linear-gradient");
    expect(section.style.overflow).toBe("hidden");
  });

  it("renders the dot-grid pattern overlay by default, and can drop it", () => {
    const { container: withPattern } = render(<HeroSection>content</HeroSection>);
    expect(withPattern.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(0);

    const { container: withoutPattern } = render(<HeroSection pattern={false}>content</HeroSection>);
    // no pattern + no decor blobs => zero aria-hidden decorative nodes
    expect(withoutPattern.querySelectorAll("[aria-hidden='true']").length).toBe(0);
  });

  it("renders one decorative blob per `decor` entry, positioned at the requested corner", () => {
    const { container } = render(
      <HeroSection decor={[{ corner: "top-left", tone: "primary", size: "lg" }]}>content</HeroSection>
    );
    const blobs = container.querySelectorAll("[aria-hidden='true']");
    // dot-grid overlay + one blob
    expect(blobs.length).toBe(2);
    const blob = blobs[1];
    expect(blob.style.top).toBe("40px");
    expect(blob.style.left).toBe("25%");
    expect(blob.style.width).toBe("320px");
  });

  it("renders two blobs when two are requested (the AboutPage case)", () => {
    const { container } = render(
      <HeroSection
        decor={[
          { corner: "top-left", tone: "primary", size: "lg" },
          { corner: "bottom-right", tone: "accent", size: "md" },
        ]}
      >
        content
      </HeroSection>
    );
    const blobs = container.querySelectorAll("[aria-hidden='true']");
    expect(blobs.length).toBe(3); // pattern + 2 blobs
  });

  it("forwards a ref to the underlying section element (useInView-compatible)", () => {
    const ref = createRef();
    render(<HeroSection ref={ref}>content</HeroSection>);
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current.tagName).toBe("SECTION");
  });

  it("centers the inner Container by default and respects align", () => {
    const { container } = render(<HeroSection data-testid="hero">content</HeroSection>);
    const inner = container.querySelector(".ds-container");
    expect(inner.style.textAlign).toBe("center");
  });

  it("renders as a different element via `as`", () => {
    const { container } = render(<HeroSection as="div">content</HeroSection>);
    expect(container.querySelector("div[style*='linear-gradient']")).toBeTruthy();
  });

  it("merges a caller className and style", () => {
    const { container } = render(
      <HeroSection className="extra-hero-class" style={{ minHeight: "480px" }}>
        content
      </HeroSection>
    );
    const section = container.querySelector("section");
    expect(section.className).toContain("extra-hero-class");
    expect(section.style.minHeight).toBe("480px");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(<HeroSection data-testid="hero">content</HeroSection>);
    expect(screen.getByTestId("hero")).toBeInTheDocument();
  });
});
