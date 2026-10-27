import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockHeading } from "./BlockHeading.jsx";

describe("<BlockHeading>", () => {
  it("renders its children", () => {
    render(<BlockHeading>Blog Coming Soon</BlockHeading>);
    expect(screen.getByText("Blog Coming Soon")).toBeInTheDocument();
  });

  it("renders as an h2 by default (a11y heading level)", () => {
    render(<BlockHeading>Title</BlockHeading>);
    expect(
      screen.getByRole("heading", { level: 2, name: "Title" })
    ).toBeInTheDocument();
  });

  it("as switches the rendered heading level", () => {
    render(<BlockHeading as="h3">Title</BlockHeading>);
    expect(
      screen.getByRole("heading", { level: 3, name: "Title" })
    ).toBeInTheDocument();
  });

  it("uses the DS --text-2xl / --weight-bold / --text-primary / --space-4 tokens, never a raw value", () => {
    const { container } = render(<BlockHeading>Title</BlockHeading>);
    const el = container.firstChild;
    expect(el.style.fontSize).toBe("var(--text-2xl)");
    expect(el.style.fontWeight).toBe("var(--weight-bold)");
    expect(el.style.color).toBe("var(--text-primary)");
    expect(el.style.marginBlockEnd).toBe("var(--space-4)");
  });

  it("tone switches the DS text-color token", () => {
    const { container } = render(
      <BlockHeading tone="secondary">Title</BlockHeading>
    );
    expect(container.firstChild.style.color).toBe("var(--text-secondary)");
  });

  it("space switches the bottom-margin token", () => {
    const { container } = render(<BlockHeading space="sm">Title</BlockHeading>);
    expect(container.firstChild.style.marginBlockEnd).toBe("var(--space-2)");
  });

  it("space=none removes the bottom margin", () => {
    const { container } = render(<BlockHeading space="none">Title</BlockHeading>);
    expect(container.firstChild.style.marginBlockEnd).toBe("0");
  });

  it("forwards an extra className", () => {
    render(<BlockHeading className="gradient-text">Title</BlockHeading>);
    expect(screen.getByText("Title")).toHaveClass("gradient-text");
  });

  it("merges a caller-supplied style without dropping the token values", () => {
    const { container } = render(
      <BlockHeading style={{ marginTop: "var(--space-4)" }}>Title</BlockHeading>
    );
    const el = container.firstChild;
    expect(el.style.marginTop).toBe("var(--space-4)");
    expect(el.style.fontWeight).toBe("var(--weight-bold)");
  });

  it("passes through arbitrary attributes (test hooks / a11y)", () => {
    render(<BlockHeading data-testid="block-heading">Title</BlockHeading>);
    expect(screen.getByTestId("block-heading")).toHaveTextContent("Title");
  });
});
