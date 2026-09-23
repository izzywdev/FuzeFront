import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stack } from "./Stack.jsx";

describe("<Stack>", () => {
  it("renders its children", () => {
    render(
      <Stack>
        <p>First</p>
        <p>Second</p>
      </Stack>
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("lays children out as a column flex with a gap (default md)", () => {
    render(
      <Stack data-testid="stack">
        <p>First</p>
      </Stack>
    );
    const stack = screen.getByTestId("stack");
    expect(stack.style.display).toBe("flex");
    expect(stack.style.flexDirection).toBe("column");
    expect(stack.style.gap).toBe("var(--space-4)");
  });

  it("maps every gap variant to its spacing token", () => {
    const expected = {
      xs: "var(--space-1)",
      sm: "var(--space-2)",
      md: "var(--space-4)",
      lg: "var(--space-6)",
      xl: "var(--space-8)",
    };
    Object.entries(expected).forEach(([gap, token]) => {
      const { unmount, getByTestId } = render(<Stack gap={gap} data-testid="s" />);
      expect(getByTestId("s").style.gap).toBe(token);
      unmount();
    });
  });

  it("falls back to the md gap token for an unknown gap value", () => {
    render(<Stack gap="huge" data-testid="stack" />);
    expect(screen.getByTestId("stack").style.gap).toBe("var(--space-4)");
  });

  it("renders as a plain div by default", () => {
    render(<Stack data-testid="stack">content</Stack>);
    expect(screen.getByTestId("stack").tagName).toBe("DIV");
  });

  it("supports polymorphic `as` rendering with a real accessible role (a11y)", () => {
    render(
      <Stack as="section" aria-label="Notification preferences">
        <p>Email notifications</p>
      </Stack>
    );
    const region = screen.getByRole("region", { name: "Notification preferences" });
    expect(region).toBeInTheDocument();
    expect(region.tagName).toBe("SECTION");
  });

  it("mirrors layout for RTL contexts — gap-based column flex, no directional margins", () => {
    render(<Stack data-testid="stack">content</Stack>);
    const stack = screen.getByTestId("stack");
    expect(stack.style.marginLeft).toBe("");
    expect(stack.style.marginRight).toBe("");
    expect(stack.style.left).toBe("");
    expect(stack.style.right).toBe("");
  });

  it("passes through arbitrary attributes and custom style", () => {
    render(
      <Stack data-testid="stack" style={{ maxWidth: "560px" }}>
        content
      </Stack>
    );
    const stack = screen.getByTestId("stack");
    expect(stack.style.maxWidth).toBe("560px");
  });
});
