import React from "react";
import { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeroBand } from "./PageHeroBand.jsx";

describe("<PageHeroBand>", () => {
  it("renders its children", () => {
    render(
      <PageHeroBand>
        <h1>Built for every industry</h1>
      </PageHeroBand>
    );
    expect(screen.getByText("Built for every industry")).toBeInTheDocument();
  });

  it("renders a <section> by default", () => {
    const { container } = render(<PageHeroBand>content</PageHeroBand>);
    expect(container.firstChild.tagName).toBe("SECTION");
  });

  it("is positioned relative with overflow hidden (so absolutely-positioned decor clips)", () => {
    const { container } = render(<PageHeroBand>content</PageHeroBand>);
    const el = container.firstChild;
    expect(el.style.position).toBe("relative");
    expect(el.style.overflow).toBe("hidden");
  });

  it("applies the fixed pt-28 top padding token", () => {
    const { container } = render(<PageHeroBand>content</PageHeroBand>);
    expect(container.firstChild.style.paddingTop).toBe("var(--space-28)");
  });

  it("defaults bottom padding to the default (pb-20) token", () => {
    const { container } = render(<PageHeroBand>content</PageHeroBand>);
    expect(container.firstChild.style.paddingBottom).toBe("var(--space-20)");
  });

  it("spacing=compact maps bottom padding to the pb-16 token", () => {
    const { container } = render(<PageHeroBand spacing="compact">content</PageHeroBand>);
    expect(container.firstChild.style.paddingBottom).toBe("var(--space-16)");
  });

  it("applies the default secondary-900 -> secondary-800 diagonal gradient", () => {
    const { container } = render(<PageHeroBand>content</PageHeroBand>);
    expect(container.firstChild.style.backgroundImage).toBe(
      "linear-gradient(to bottom right, #0f172a, #1e293b)"
    );
  });

  it("gradient prop overrides both stops", () => {
    const { container } = render(
      <PageHeroBand gradient={{ from: "#111111", to: "#222222" }}>content</PageHeroBand>
    );
    expect(container.firstChild.style.backgroundImage).toBe(
      "linear-gradient(to bottom right, #111111, #222222)"
    );
  });

  it("as=div renders a different element while keeping the same styling", () => {
    const { container } = render(<PageHeroBand as="div">content</PageHeroBand>);
    expect(container.firstChild.tagName).toBe("DIV");
    expect(container.firstChild.style.position).toBe("relative");
  });

  it("forwards ref to the rendered element", () => {
    const ref = createRef();
    render(<PageHeroBand ref={ref}>content</PageHeroBand>);
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current.tagName).toBe("SECTION");
  });

  it("merges a caller-supplied style without dropping the gradient/padding", () => {
    const { container } = render(
      <PageHeroBand style={{ marginTop: "var(--space-4)" }}>content</PageHeroBand>
    );
    const el = container.firstChild;
    expect(el.style.marginTop).toBe("var(--space-4)");
    expect(el.style.paddingTop).toBe("var(--space-28)");
  });

  it("merges a caller-supplied className", () => {
    const { container } = render(<PageHeroBand className="relative-override">content</PageHeroBand>);
    expect(container.firstChild).toHaveClass("relative-override");
  });

  it("forwards arbitrary data-* attributes (test hooks)", () => {
    const { container } = render(<PageHeroBand data-testid="industries-hero">content</PageHeroBand>);
    expect(container.firstChild).toHaveAttribute("data-testid", "industries-hero");
  });
});
