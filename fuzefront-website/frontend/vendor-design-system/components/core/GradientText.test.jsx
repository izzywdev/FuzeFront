import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GradientText } from "./GradientText.jsx";

describe("<GradientText>", () => {
  it("renders its children as a <span> by default", () => {
    render(<GradientText>FuzeOne</GradientText>);
    const node = screen.getByText("FuzeOne");
    expect(node.tagName).toBe("SPAN");
  });

  it("renders as the element named by `as`", () => {
    render(<GradientText as="div">404</GradientText>);
    expect(screen.getByText("404").tagName).toBe("DIV");
  });

  it("defaults to the DS seam gradient token", () => {
    render(<GradientText>Blog</GradientText>);
    const node = screen.getByText("Blog");
    expect(node.style.backgroundImage).toBe("var(--seam)");
  });

  it("clips the background to the text and hides the glyph fill — never a raw color", () => {
    render(<GradientText>Touch</GradientText>);
    const node = screen.getByText("Touch");
    // jsdom's CSSOM does not recognize the vendor-prefixed
    // `-webkit-background-clip` property at all (it is silently dropped,
    // not merely inaccessible via the camelCase accessor), so only the
    // unprefixed `background-clip` plus the fill/color properties are
    // assertable here; `WebkitBackgroundClip` is still set on the real
    // style object in the component source for Safari/older browsers.
    expect(node.style.backgroundClip).toBe("text");
    expect(node.style.webkitTextFillColor).toBe("transparent");
    expect(node.style.color).toBe("transparent");
  });

  it("accepts a consumer-supplied gradient override (e.g. a marketing site's own brand gradient)", () => {
    render(
      <GradientText gradient="var(--primary-gradient)">Media</GradientText>
    );
    expect(screen.getByText("Media").style.backgroundImage).toBe(
      "var(--primary-gradient)"
    );
  });

  it("merges a caller className for layout utilities (e.g. `block mt-2`)", () => {
    render(
      <GradientText as="div" className="block mt-2">
        for your SaaS
      </GradientText>
    );
    expect(screen.getByText("for your SaaS")).toHaveClass("block", "mt-2");
  });

  it("caller style overrides the base style", () => {
    render(<GradientText style={{ fontWeight: 700 }}>Business</GradientText>);
    const node = screen.getByText("Business");
    expect(node.style.fontWeight).toBe("700");
    expect(node.style.backgroundImage).toBe("var(--seam)");
  });

  it("passes through arbitrary attributes (test hooks / a11y)", () => {
    render(<GradientText data-testid="hero-accent">FuzeOne</GradientText>);
    expect(screen.getByTestId("hero-accent")).toHaveTextContent("FuzeOne");
  });
});
