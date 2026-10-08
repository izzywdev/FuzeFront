import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CtaHeading } from "./CtaHeading.jsx";

describe("<CtaHeading>", () => {
  it("renders its children", () => {
    render(<CtaHeading>Don't see your industry?</CtaHeading>);
    expect(screen.getByText("Don't see your industry?")).toBeInTheDocument();
  });

  it("renders an h2 by default (a11y heading level)", () => {
    render(<CtaHeading>Title</CtaHeading>);
    expect(
      screen.getByRole("heading", { level: 2, name: "Title" })
    ).toBeInTheDocument();
  });

  it("renders as a different heading level via `as`", () => {
    render(<CtaHeading as="h1">Title</CtaHeading>);
    expect(
      screen.getByRole("heading", { level: 1, name: "Title" })
    ).toBeInTheDocument();
  });

  it("centers by default", () => {
    render(<CtaHeading>Title</CtaHeading>);
    expect(screen.getByText("Title").style.textAlign).toBe("center");
  });

  it("supports left alignment", () => {
    render(<CtaHeading align="left">Title</CtaHeading>);
    expect(screen.getByText("Title").style.textAlign).toBe("left");
  });

  it("uses the DS CTA-heading font/size/weight/color tokens, never a raw value", () => {
    render(<CtaHeading>Title</CtaHeading>);
    const el = screen.getByText("Title");
    expect(el.style.fontFamily).toBe("var(--role-cta-heading-font)");
    expect(el.style.fontSize).toBe("var(--role-cta-heading-size)");
    expect(el.style.fontWeight).toBe("var(--role-cta-heading-weight)");
    expect(el.style.color).toBe("var(--text-primary)");
  });

  it("defaults to the md (mb-4) bottom-margin token", () => {
    render(<CtaHeading>Title</CtaHeading>);
    expect(screen.getByText("Title").style.marginBlockEnd).toBe(
      "var(--space-4)"
    );
  });

  it("supports the sm bottom-margin step", () => {
    render(<CtaHeading space="sm">Title</CtaHeading>);
    expect(screen.getByText("Title").style.marginBlockEnd).toBe(
      "var(--space-2)"
    );
  });

  it("space=none removes the bottom margin", () => {
    render(<CtaHeading space="none">Title</CtaHeading>);
    expect(screen.getByText("Title").style.marginBlockEnd).toBe("0");
  });

  it("forwards an extra className", () => {
    render(<CtaHeading className="gradient-text">Title</CtaHeading>);
    expect(screen.getByText("Title")).toHaveClass("gradient-text");
  });

  it("merges a caller-supplied style without dropping the token values", () => {
    render(
      <CtaHeading style={{ maxWidth: "40rem" }}>Title</CtaHeading>
    );
    const el = screen.getByText("Title");
    expect(el.style.maxWidth).toBe("40rem");
    expect(el.style.fontWeight).toBe("var(--role-cta-heading-weight)");
  });

  it("passes through arbitrary attributes (test hooks / a11y)", () => {
    render(<CtaHeading data-testid="cta-heading">Title</CtaHeading>);
    expect(screen.getByTestId("cta-heading")).toHaveTextContent("Title");
  });
});
