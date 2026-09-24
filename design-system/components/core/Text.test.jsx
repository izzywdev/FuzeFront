import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Text } from "./Text.jsx";

describe("<Text>", () => {
  it("renders its children as a <p> by default", () => {
    render(<Text>Select organization</Text>);
    const node = screen.getByText("Select organization");
    expect(node.tagName).toBe("P");
  });

  it("renders as the element named by `as` (span/div/label)", () => {
    const { rerender } = render(<Text as="span">Inline</Text>);
    expect(screen.getByText("Inline").tagName).toBe("SPAN");

    rerender(<Text as="div">Block</Text>);
    expect(screen.getByText("Block").tagName).toBe("DIV");

    rerender(<Text as="label">Field label</Text>);
    expect(screen.getByText("Field label").tagName).toBe("LABEL");
  });

  it("defaults to the primary tone token", () => {
    render(<Text>Not set</Text>);
    expect(screen.getByText("Not set").style.color).toBe("var(--text-primary)");
  });

  it("resolves every tone to its DS token — never a raw color", () => {
    const cases = [
      ["primary", "var(--text-primary)"],
      ["secondary", "var(--text-secondary)"],
      ["muted", "var(--text-tertiary)"],
      ["danger", "var(--error-color)"],
    ];
    cases.forEach(([tone, expected]) => {
      const { unmount } = render(<Text tone={tone}>{tone}</Text>);
      expect(screen.getByText(tone).style.color).toBe(expected);
      unmount();
    });
  });

  it("falls back to the primary tone for an unknown tone value", () => {
    render(<Text tone="not-a-real-tone">Fallback</Text>);
    expect(screen.getByText("Fallback").style.color).toBe("var(--text-primary)");
  });

  it("passes through arbitrary attributes (a11y labelling / test hooks)", () => {
    render(
      <Text data-testid="email-caption" aria-label="Account email">
        user@example.com
      </Text>
    );
    const node = screen.getByTestId("email-caption");
    expect(node).toHaveAttribute("aria-label", "Account email");
    expect(node).toHaveTextContent("user@example.com");
  });

  it("is accessible as a form label associated to its control via htmlFor", () => {
    render(
      <>
        <Text as="label" htmlFor="bio">
          Bio
        </Text>
        <textarea id="bio" />
      </>
    );
    expect(screen.getByLabelText("Bio")).toBeInTheDocument();
  });

  it("caller style overrides the base style (e.g. inheriting a size utility class)", () => {
    render(
      <Text tone="muted" style={{ fontStyle: "italic" }}>
        Placeholder
      </Text>
    );
    const node = screen.getByText("Placeholder");
    expect(node.style.fontStyle).toBe("italic");
    expect(node.style.color).toBe("var(--text-tertiary)");
  });
});
