import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InverseHeading } from "./InverseHeading.jsx";

describe("<InverseHeading>", () => {
  it("renders children", () => {
    render(<InverseHeading>Simple pricing for every stage</InverseHeading>);
    expect(screen.getByText("Simple pricing for every stage")).toBeInTheDocument();
  });

  it("defaults to an h2", () => {
    render(<InverseHeading>Heading</InverseHeading>);
    expect(screen.getByText("Heading").tagName).toBe("H2");
  });

  it("renders as a different element via `as`", () => {
    render(<InverseHeading as="h1">This page doesn't exist</InverseHeading>);
    expect(screen.getByText("This page doesn't exist").tagName).toBe("H1");
  });

  it("defaults to the lg size class", () => {
    render(<InverseHeading data-testid="h">Heading</InverseHeading>);
    expect(screen.getByTestId("h").className).toContain("ds-inverse-heading--lg");
  });

  it("applies the md size class when size=\"md\"", () => {
    render(
      <InverseHeading size="md" data-testid="h">
        Heading
      </InverseHeading>
    );
    const cls = screen.getByTestId("h").className;
    expect(cls).toContain("ds-inverse-heading--md");
    expect(cls).not.toContain("ds-inverse-heading--lg");
  });

  it("always renders the base ds-inverse-heading class", () => {
    render(<InverseHeading data-testid="h">Heading</InverseHeading>);
    expect(screen.getByTestId("h").className).toContain("ds-inverse-heading");
  });

  it("uses DS tokens for font, weight and color — never a raw value", () => {
    render(<InverseHeading data-testid="h">Heading</InverseHeading>);
    const el = screen.getByTestId("h");
    expect(el.style.fontFamily).toBe("var(--font-display)");
    expect(el.style.fontWeight).toBe("var(--weight-bold)");
    expect(el.style.color).toBe("var(--paper)");
  });

  it("defaults spacing to the md bottom-margin token (mb-4 equivalent)", () => {
    render(<InverseHeading data-testid="h">Heading</InverseHeading>);
    expect(screen.getByTestId("h").style.marginBlockEnd).toBe("var(--space-4)");
  });

  it("spacing=\"none\" removes the bottom margin", () => {
    render(
      <InverseHeading spacing="none" data-testid="h">
        Heading
      </InverseHeading>
    );
    expect(screen.getByTestId("h").style.marginBlockEnd).toBe("0");
  });

  it("spacing=\"sm\" uses the smaller spacing token", () => {
    render(
      <InverseHeading spacing="sm" data-testid="h">
        Heading
      </InverseHeading>
    );
    expect(screen.getByTestId("h").style.marginBlockEnd).toBe("var(--space-2)");
  });

  it("merges a caller className alongside ds-inverse-heading", () => {
    render(
      <InverseHeading className="relative" data-testid="h">
        Heading
      </InverseHeading>
    );
    const cls = screen.getByTestId("h").className;
    expect(cls).toContain("ds-inverse-heading");
    expect(cls).toContain("relative");
  });

  it("merges caller style without dropping the computed color/weight", () => {
    render(
      <InverseHeading style={{ textAlign: "center" }} data-testid="h">
        Heading
      </InverseHeading>
    );
    const el = screen.getByTestId("h");
    expect(el.style.textAlign).toBe("center");
    expect(el.style.color).toBe("var(--paper)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(
      <InverseHeading data-testid="h" aria-label="section heading">
        Heading
      </InverseHeading>
    );
    expect(screen.getByTestId("h")).toHaveAttribute("aria-label", "section heading");
  });

  it("injects the responsive size <style> with the sm(640px) breakpoint", () => {
    const { container } = render(<InverseHeading>Heading</InverseHeading>);
    const styleTag = container.querySelector("style");
    expect(styleTag).not.toBeNull();
    expect(styleTag.textContent).toContain("640px");
    expect(styleTag.textContent).toContain("ds-inverse-heading--lg");
    expect(styleTag.textContent).toContain("ds-inverse-heading--md");
  });
});
