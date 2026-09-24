import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Caption } from "./Caption.jsx";

describe("<Caption>", () => {
  it("renders its children as a <p> by default", () => {
    render(<Caption>Checking permissions...</Caption>);
    const node = screen.getByText("Checking permissions...");
    expect(node.tagName).toBe("P");
  });

  it("renders as the element named by `as`", () => {
    render(<Caption as="span">Inline caption</Caption>);
    expect(screen.getByText("Inline caption").tagName).toBe("SPAN");
  });

  it("always sizes text at the DS --text-sm token", () => {
    render(<Caption>No credit card required</Caption>);
    expect(screen.getByText("No credit card required").style.fontSize).toBe(
      "var(--text-sm)"
    );
  });

  it("defaults to the secondary tone token", () => {
    render(<Caption>{"{message}"}</Caption>);
    expect(screen.getByText("{message}").style.color).toBe(
      "var(--text-secondary)"
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
      const { unmount } = render(<Caption tone={tone}>{tone}</Caption>);
      expect(screen.getByText(tone).style.color).toBe(expected);
      unmount();
    });
  });

  it("defaults to the sm spacing token for the top margin", () => {
    render(<Caption>Default spacing</Caption>);
    expect(screen.getByText("Default spacing").style.marginTop).toBe(
      "var(--space-2)"
    );
  });

  it("resolves every `space` value to its DS spacing token", () => {
    const cases = [
      ["none", "0px"],
      ["xs", "var(--space-1)"],
      ["sm", "var(--space-2)"],
      ["md", "var(--space-4)"],
      ["lg", "var(--space-6)"],
    ];
    cases.forEach(([space, expected]) => {
      const { unmount } = render(<Caption space={space}>{space}</Caption>);
      expect(screen.getByText(space).style.marginTop).toBe(expected);
      unmount();
    });
  });

  it("falls back to the sm spacing token for an unknown `space` value", () => {
    render(<Caption space="not-a-real-space">Fallback</Caption>);
    expect(screen.getByText("Fallback").style.marginTop).toBe(
      "var(--space-2)"
    );
  });

  it("passes through arbitrary attributes (a11y labelling / test hooks)", () => {
    render(
      <Caption data-testid="status-caption" aria-live="polite">
        Checking permissions...
      </Caption>
    );
    const node = screen.getByTestId("status-caption");
    expect(node).toHaveAttribute("aria-live", "polite");
    expect(node).toHaveTextContent("Checking permissions...");
  });

  it("caller style overrides the base style", () => {
    render(
      <Caption tone="muted" style={{ fontStyle: "italic" }}>
        Overridden
      </Caption>
    );
    const node = screen.getByText("Overridden");
    expect(node.style.fontStyle).toBe("italic");
    expect(node.style.color).toBe("var(--text-tertiary)");
  });
});
