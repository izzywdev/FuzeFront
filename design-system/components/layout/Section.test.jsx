import React, { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Section } from "./Section.jsx";

describe("<Section>", () => {
  it("renders its children inside a <section>", () => {
    render(
      <Section data-testid="s">
        <span>content</span>
      </Section>
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.getByTestId("s").tagName).toBe("SECTION");
  });

  it("defaults to tone=muted, spacing=lg (py-24 bg-secondary-50 — the flagged pattern)", () => {
    render(<Section data-testid="s">content</Section>);
    const cls = screen.getByTestId("s").className;
    expect(cls).toContain("py-24");
    expect(cls).toContain("bg-secondary-50");
  });

  it.each([
    ["xs", "py-12"],
    ["sm", "py-16"],
    ["md", "py-20"],
    ["lg", "py-24"],
  ])("spacing=%s maps to %s", (spacing, expected) => {
    render(
      <Section spacing={spacing} data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").className).toContain(expected);
  });

  it.each([
    ["base", "bg-white"],
    ["muted", "bg-secondary-50"],
    ["inverse", "bg-secondary-900"],
    ["inverseMuted", "bg-secondary-800"],
  ])("tone=%s maps to %s", (tone, expected) => {
    render(
      <Section tone={tone} data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").className).toContain(expected);
  });

  it("border=none (default) adds no border classes", () => {
    render(<Section data-testid="s">content</Section>);
    expect(screen.getByTestId("s").className).not.toContain("border");
  });

  it("border=top on a muted tone pairs with border-secondary-100", () => {
    render(
      <Section border="top" tone="muted" data-testid="s">
        content
      </Section>
    );
    const cls = screen.getByTestId("s").className;
    expect(cls).toContain("border-t");
    expect(cls).toContain("border-secondary-100");
  });

  it("border=y on an inverse tone pairs with border-secondary-800", () => {
    render(
      <Section border="y" tone="inverse" data-testid="s">
        content
      </Section>
    );
    const cls = screen.getByTestId("s").className;
    expect(cls).toContain("border-y");
    expect(cls).toContain("border-secondary-800");
  });

  it("renders as a different element via `as`", () => {
    render(
      <Section as="div" data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").tagName).toBe("DIV");
  });

  it("merges a caller className alongside the computed classes", () => {
    render(
      <Section className="relative overflow-hidden" data-testid="s">
        content
      </Section>
    );
    const cls = screen.getByTestId("s").className;
    expect(cls).toContain("bg-secondary-50");
    expect(cls).toContain("relative overflow-hidden");
  });

  it("forwards a ref to the underlying DOM node", () => {
    const ref = createRef();
    render(<Section ref={ref}>content</Section>);
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current.tagName).toBe("SECTION");
  });

  it("forwards arbitrary data-* and aria-* attributes", () => {
    render(
      <Section data-testid="s" aria-label="Customer stats">
        content
      </Section>
    );
    expect(screen.getByTestId("s")).toHaveAttribute("aria-label", "Customer stats");
  });
});
