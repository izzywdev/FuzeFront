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

  it("defaults `size` to inherit (unchanged pre-`size` behavior)", () => {
    render(<Text>Default size</Text>);
    expect(screen.getByText("Default size").style.fontSize).toBe("inherit");
  });

  it("resolves every `size` step to its DS type-scale token — never a raw px value", () => {
    const cases = [
      ["xs", "var(--text-xs)"],
      ["sm", "var(--text-sm)"],
      ["base", "var(--text-base)"],
      ["md", "var(--text-md)"],
    ];
    cases.forEach(([size, expected]) => {
      const { unmount } = render(<Text size={size}>{size}</Text>);
      expect(screen.getByText(size).style.fontSize).toBe(expected);
      unmount();
    });
  });

  it("falls back to inherit for an unknown size value", () => {
    render(<Text size="not-a-real-size">Fallback size</Text>);
    expect(screen.getByText("Fallback size").style.fontSize).toBe("inherit");
  });

  it("defaults `spacing` to none — zero margin-block-end (unchanged pre-`spacing` behavior)", () => {
    render(<Text>Default spacing</Text>);
    expect(screen.getByText("Default spacing").style.marginBlockEnd).toBe("0");
  });

  it("resolves every `spacing` step to its DS spacing-scale token via the logical marginBlockEnd (RTL-safe)", () => {
    const cases = [
      ["sm", "var(--space-2)"],
      ["md", "var(--space-4)"],
    ];
    cases.forEach(([spacing, expected]) => {
      const { unmount } = render(<Text spacing={spacing}>{spacing}</Text>);
      expect(screen.getByText(spacing).style.marginBlockEnd).toBe(expected);
      unmount();
    });
  });

  it("covers the recurring `text-sm text-gray-{500,600} mb-{2,4}` block-caption pattern via tone+size+spacing", () => {
    render(
      <Text tone="secondary" size="sm" spacing="md">
        You don&apos;t have the required permissions to access this page.
      </Text>
    );
    const node = screen.getByText(
      "You don't have the required permissions to access this page."
    );
    expect(node.style.color).toBe("var(--text-secondary)");
    expect(node.style.fontSize).toBe("var(--text-sm)");
    expect(node.style.marginBlockEnd).toBe("var(--space-4)");
  });
});
