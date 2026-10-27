import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionTitle } from "./SectionTitle.jsx";

describe("<SectionTitle>", () => {
  it("renders an h2 by default", () => {
    render(<SectionTitle>Leadership</SectionTitle>);
    const el = screen.getByText("Leadership");
    expect(el.tagName).toBe("H2");
  });

  it("renders as a different heading level via `as`", () => {
    render(<SectionTitle as="h1">Privacy Policy</SectionTitle>);
    expect(screen.getByText("Privacy Policy").tagName).toBe("H1");
  });

  it("centers by default", () => {
    render(<SectionTitle>Open positions</SectionTitle>);
    expect(screen.getByText("Open positions").style.textAlign).toBe("center");
  });

  it("supports left alignment", () => {
    render(<SectionTitle align="left">Left title</SectionTitle>);
    expect(screen.getByText("Left title").style.textAlign).toBe("left");
  });

  it("defaults to the md (mb-4) bottom-margin token", () => {
    render(<SectionTitle>Built for every vertical</SectionTitle>);
    expect(screen.getByText("Built for every vertical").style.marginBlockEnd).toBe(
      "var(--space-4)"
    );
  });

  it("supports the sm (mb-3) bottom-margin step", () => {
    render(<SectionTitle space="sm">Privacy Policy</SectionTitle>);
    expect(screen.getByText("Privacy Policy").style.marginBlockEnd).toBe("var(--space-3)");
  });

  it("uses DS type-scale, weight, and color tokens — never a raw value", () => {
    render(<SectionTitle>Ready to build on FuzeOne?</SectionTitle>);
    const el = screen.getByText("Ready to build on FuzeOne?");
    expect(el.style.fontFamily).toBe("var(--role-section-title-font)");
    expect(el.style.fontWeight).toBe("var(--role-section-title-weight)");
    expect(el.style.color).toBe("var(--text-primary)");
  });

  it("applies the responsive size class that steps at the sm breakpoint", () => {
    render(<SectionTitle data-testid="t">10 products. One platform.</SectionTitle>);
    expect(screen.getByTestId("t").className).toContain("ds-section-title");
  });

  it("merges a caller className alongside ds-section-title", () => {
    render(
      <SectionTitle className="extra" data-testid="t">
        content
      </SectionTitle>
    );
    const cls = screen.getByTestId("t").className;
    expect(cls).toContain("ds-section-title");
    expect(cls).toContain("extra");
  });

  it("merges caller style without dropping the computed typography", () => {
    render(
      <SectionTitle style={{ maxWidth: "40rem" }} data-testid="t">
        content
      </SectionTitle>
    );
    const el = screen.getByTestId("t");
    expect(el.style.maxWidth).toBe("40rem");
    expect(el.style.fontFamily).toBe("var(--role-section-title-font)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(<SectionTitle data-testid="t" aria-level={2}>content</SectionTitle>);
    expect(screen.getByTestId("t")).toHaveAttribute("aria-level", "2");
  });
});
