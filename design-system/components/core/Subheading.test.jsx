import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Subheading } from "./Subheading.jsx";

describe("<Subheading>", () => {
  it("renders its children as an <h2> by default", () => {
    render(<Subheading>1. Introduction</Subheading>);
    const node = screen.getByText("1. Introduction");
    expect(node.tagName).toBe("H2");
  });

  it("renders as the element named by `as`", () => {
    render(
      <Subheading as="h3" space="xs">
        Healthcare
      </Subheading>
    );
    expect(screen.getByText("Healthcare").tagName).toBe("H3");
  });

  it("always sizes text at the DS --text-xl token with bold weight", () => {
    render(<Subheading>6. Your Rights</Subheading>);
    const node = screen.getByText("6. Your Rights");
    expect(node.style.fontSize).toBe("var(--text-xl)");
    expect(node.style.fontWeight).toBe("var(--weight-bold)");
  });

  it("defaults to the primary tone token", () => {
    render(<Subheading>{"{title}"}</Subheading>);
    expect(screen.getByText("{title}").style.color).toBe(
      "var(--text-primary)"
    );
  });

  it("resolves every tone to its DS token — never a raw gray shade", () => {
    const cases = [
      ["primary", "var(--text-primary)"],
      ["secondary", "var(--text-secondary)"],
      ["muted", "var(--text-tertiary)"],
      ["danger", "var(--error-color)"],
    ];
    cases.forEach(([tone, expected]) => {
      const { unmount } = render(<Subheading tone={tone}>{tone}</Subheading>);
      expect(screen.getByText(tone).style.color).toBe(expected);
      unmount();
    });
  });

  it("defaults to the md spacing token for the bottom margin", () => {
    render(<Subheading>Default spacing</Subheading>);
    expect(screen.getByText("Default spacing").style.marginBlockEnd).toBe(
      "var(--space-4)"
    );
  });

  it("resolves every `space` value to its DS spacing token", () => {
    const cases = [
      ["xs", "var(--space-1)"],
      ["sm", "var(--space-3)"],
      ["md", "var(--space-4)"],
    ];
    cases.forEach(([space, expected]) => {
      const { unmount } = render(
        <Subheading space={space}>{space}</Subheading>
      );
      expect(screen.getByText(space).style.marginBlockEnd).toBe(expected);
      unmount();
    });
  });

  it("falls back to the md spacing token for an unknown `space` value", () => {
    render(<Subheading space="not-a-real-space">Fallback</Subheading>);
    expect(screen.getByText("Fallback").style.marginBlockEnd).toBe(
      "var(--space-4)"
    );
  });

  it("passes through arbitrary attributes (a11y labelling / test hooks)", () => {
    render(
      <Subheading data-testid="section-heading" id="intro">
        1. Introduction
      </Subheading>
    );
    const node = screen.getByTestId("section-heading");
    expect(node).toHaveAttribute("id", "intro");
    expect(node).toHaveTextContent("1. Introduction");
  });

  it("caller style overrides the base style", () => {
    render(
      <Subheading tone="muted" style={{ fontStyle: "italic" }}>
        Overridden
      </Subheading>
    );
    const node = screen.getByText("Overridden");
    expect(node.style.fontStyle).toBe("italic");
    expect(node.style.color).toBe("var(--text-tertiary)");
  });
});
