import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wrap } from "./Wrap.jsx";

describe("<Wrap>", () => {
  it("renders its children", () => {
    render(
      <Wrap>
        <span>one</span>
        <span>two</span>
      </Wrap>
    );
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });

  it("defaults to flex-wrap with the gap-2 spacing token", () => {
    const { container } = render(<Wrap>content</Wrap>);
    const el = container.firstChild;
    expect(el.style.display).toBe("flex");
    expect(el.style.flexWrap).toBe("wrap");
    expect(el.style.gap).toBe("var(--space-2)");
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16])(
    "maps gap=%s to var(--space-%s)",
    (gap) => {
      const { container } = render(<Wrap gap={gap}>content</Wrap>);
      expect(container.firstChild.style.gap).toBe(`var(--space-${gap})`);
    }
  );

  it("falls back to the gap-2 token for an unknown gap value", () => {
    const { container } = render(<Wrap gap={99}>content</Wrap>);
    expect(container.firstChild.style.gap).toBe("var(--space-2)");
  });

  it("accepts align and justify overrides", () => {
    const { container } = render(
      <Wrap align="flex-end" justify="space-between">
        content
      </Wrap>
    );
    const el = container.firstChild;
    expect(el.style.alignItems).toBe("flex-end");
    expect(el.style.justifyContent).toBe("space-between");
  });

  it("renders as a custom element via the `as` prop", () => {
    const { container } = render(<Wrap as="ul">content</Wrap>);
    expect(container.firstChild.tagName).toBe("UL");
  });

  it("mirrors automatically under dir=rtl (no directional styles to flip)", () => {
    render(
      <div dir="rtl">
        <Wrap data-testid="rtl-wrap">
          <span>a</span>
          <span>b</span>
        </Wrap>
      </div>
    );
    const el = screen.getByTestId("rtl-wrap");
    expect(el.style.display).toBe("flex");
    expect(el.style.flexWrap).toBe("wrap");
    expect(el.closest('[dir="rtl"]')).not.toBeNull();
  });

  it("forwards arbitrary data-* attributes (test hooks, a11y roles) to the rendered element", () => {
    render(
      <Wrap role="group" aria-label="Roles" data-testid="role-wrap">
        <span>x</span>
      </Wrap>
    );
    const el = screen.getByTestId("role-wrap");
    expect(el).toHaveAttribute("role", "group");
    expect(el).toHaveAttribute("aria-label", "Roles");
  });

  it("merges a caller-provided style object without dropping layout styles", () => {
    const { container } = render(<Wrap style={{ marginTop: "var(--space-4)" }}>content</Wrap>);
    const el = container.firstChild;
    expect(el.style.marginTop).toBe("var(--space-4)");
    expect(el.style.display).toBe("flex");
  });
});
