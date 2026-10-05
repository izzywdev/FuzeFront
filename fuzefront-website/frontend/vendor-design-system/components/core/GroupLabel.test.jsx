import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupLabel } from "./GroupLabel.jsx";

describe("<GroupLabel>", () => {
  it("renders its children as an <h4> by default", () => {
    render(<GroupLabel>Responsibilities</GroupLabel>);
    const node = screen.getByText("Responsibilities");
    expect(node.tagName).toBe("H4");
  });

  it("renders as the element named by `as`", () => {
    render(<GroupLabel as="p">Recommended products</GroupLabel>);
    expect(screen.getByText("Recommended products").tagName).toBe("P");
  });

  it("always sizes text at the DS --text-xs token", () => {
    render(<GroupLabel>Qualifications</GroupLabel>);
    expect(screen.getByText("Qualifications").style.fontSize).toBe(
      "var(--text-xs)"
    );
  });

  it("is always semibold, uppercase, and wide-tracked", () => {
    render(<GroupLabel>Key challenges addressed</GroupLabel>);
    const node = screen.getByText("Key challenges addressed");
    expect(node.style.fontWeight).toBe("var(--weight-semibold)");
    expect(node.style.textTransform).toBe("uppercase");
    expect(node.style.letterSpacing).toBe("var(--tracking-wide)");
  });

  it("defaults to the secondary tone token", () => {
    render(<GroupLabel>{"{label}"}</GroupLabel>);
    expect(screen.getByText("{label}").style.color).toBe(
      "var(--text-secondary)"
    );
  });

  it("resolves every tone to its DS token — never a raw gray shade", () => {
    const cases = [
      ["primary", "var(--text-primary)"],
      ["secondary", "var(--text-secondary)"],
      ["muted", "var(--text-tertiary)"],
    ];
    cases.forEach(([tone, expected]) => {
      const { unmount } = render(<GroupLabel tone={tone}>{tone}</GroupLabel>);
      expect(screen.getByText(tone).style.color).toBe(expected);
      unmount();
    });
  });

  it("defaults to the sm spacing token for the bottom margin", () => {
    render(<GroupLabel>Default spacing</GroupLabel>);
    expect(screen.getByText("Default spacing").style.marginBottom).toBe(
      "var(--space-2)"
    );
  });

  it("resolves the md spacing value to its DS spacing token", () => {
    render(<GroupLabel spacing="md">Wider gap</GroupLabel>);
    expect(screen.getByText("Wider gap").style.marginBottom).toBe(
      "var(--space-3)"
    );
  });

  it("falls back to the sm spacing token for an unknown `spacing` value", () => {
    render(<GroupLabel spacing="not-a-real-space">Fallback</GroupLabel>);
    expect(screen.getByText("Fallback").style.marginBottom).toBe(
      "var(--space-2)"
    );
  });

  it("passes through arbitrary attributes (a11y labelling / test hooks)", () => {
    render(
      <GroupLabel data-testid="group-label" id="responsibilities-label">
        Responsibilities
      </GroupLabel>
    );
    const node = screen.getByTestId("group-label");
    expect(node).toHaveAttribute("id", "responsibilities-label");
    expect(node).toHaveTextContent("Responsibilities");
  });

  it("caller style overrides the base style", () => {
    render(
      <GroupLabel tone="muted" style={{ fontStyle: "italic" }}>
        Overridden
      </GroupLabel>
    );
    const node = screen.getByText("Overridden");
    expect(node.style.fontStyle).toBe("italic");
    expect(node.style.color).toBe("var(--text-tertiary)");
  });
});
