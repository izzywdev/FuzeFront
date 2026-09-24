import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stack } from "./Stack.jsx";

describe("<Stack>", () => {
  it("renders its children", () => {
    render(
      <Stack>
        <span>one</span>
        <span>two</span>
      </Stack>
    );
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });

  it("defaults to a horizontal row, center-aligned (the items-center half of the pattern)", () => {
    const { container } = render(<Stack>content</Stack>);
    const el = container.firstChild;
    expect(el.style.display).toBe("flex");
    expect(el.style.flexDirection).toBe("row");
    expect(el.style.alignItems).toBe("center");
  });

  it("defaults gap to sm (--space-2, 8px)", () => {
    const { container } = render(<Stack>content</Stack>);
    expect(container.firstChild.style.gap).toBe("var(--space-2)");
  });

  it.each([
    ["xs", "var(--space-1)"],
    ["sm", "var(--space-2)"],
    ["md", "var(--space-4)"],
    ["lg", "var(--space-6)"],
    ["xl", "var(--space-8)"],
  ])("gap=%s maps to the %s spacing token", (gap, token) => {
    const { container } = render(<Stack gap={gap}>content</Stack>);
    expect(container.firstChild.style.gap).toBe(token);
  });

  it("direction=column switches the main axis and keeps no raw gap value", () => {
    const { container } = render(<Stack direction="column">content</Stack>);
    const el = container.firstChild;
    expect(el.style.flexDirection).toBe("column");
    expect(el.style.gap).toMatch(/^var\(--space-/);
  });

  it("justify=between maps to space-between", () => {
    const { container } = render(<Stack justify="between">content</Stack>);
    expect(container.firstChild.style.justifyContent).toBe("space-between");
  });

  it("wrap=true allows children to flow onto multiple lines", () => {
    const { container } = render(<Stack wrap>content</Stack>);
    expect(container.firstChild.style.flexWrap).toBe("wrap");
  });

  it("wrap defaults to nowrap", () => {
    const { container } = render(<Stack>content</Stack>);
    expect(container.firstChild.style.flexWrap).toBe("nowrap");
  });

  it("forwards role/aria attributes to the rendered div (a11y passthrough)", () => {
    render(
      <Stack role="group" aria-label="Organization actions">
        <button type="button">Edit</button>
      </Stack>
    );
    expect(screen.getByRole("group", { name: "Organization actions" })).toBeInTheDocument();
  });

  it("forwards arbitrary data-* attributes (test hooks)", () => {
    const { container } = render(<Stack data-testid="badge-row">content</Stack>);
    expect(container.firstChild).toHaveAttribute("data-testid", "badge-row");
  });

  it("merges a caller-supplied style without dropping the layout properties", () => {
    const { container } = render(<Stack style={{ marginTop: "var(--space-4)" }}>content</Stack>);
    const el = container.firstChild;
    expect(el.style.marginTop).toBe("var(--space-4)");
    expect(el.style.display).toBe("flex");
  });
});
