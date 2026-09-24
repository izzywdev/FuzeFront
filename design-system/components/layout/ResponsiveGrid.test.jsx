import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResponsiveGrid } from "./ResponsiveGrid.jsx";

describe("<ResponsiveGrid>", () => {
  it("renders its children inside a CSS grid container", () => {
    render(
      <ResponsiveGrid data-testid="grid">
        <div>First</div>
        <div>Second</div>
      </ResponsiveGrid>
    );
    const grid = screen.getByTestId("grid");
    expect(grid).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(grid.style.display).toBe("grid");
  });

  it("defaults to 2 columns and the lg (space-6) gap token", () => {
    render(<ResponsiveGrid data-testid="grid">content</ResponsiveGrid>);
    const grid = screen.getByTestId("grid");
    expect(grid.style.gap).toBe("var(--space-6)");
    expect(grid.style.gridTemplateColumns).toContain("var(--space-6)");
    expect(grid.style.gridTemplateColumns).toContain("/ 2");
  });

  it("honors a custom columns count", () => {
    render(
      <ResponsiveGrid columns={3} data-testid="grid">
        content
      </ResponsiveGrid>
    );
    const grid = screen.getByTestId("grid");
    expect(grid.style.gridTemplateColumns).toContain("/ 3");
  });

  it("maps every gap variant to a DS spacing token, never a raw px value", () => {
    const expected = {
      sm: "var(--space-2)",
      md: "var(--space-4)",
      lg: "var(--space-6)",
      xl: "var(--space-8)",
    };
    Object.entries(expected).forEach(([gap, token]) => {
      const { unmount } = render(
        <ResponsiveGrid gap={gap} data-testid="grid">
          content
        </ResponsiveGrid>
      );
      expect(screen.getByTestId("grid").style.gap).toBe(token);
      unmount();
    });
  });

  it("respects a custom minColumnWidth", () => {
    render(
      <ResponsiveGrid minColumnWidth="200px" data-testid="grid">
        content
      </ResponsiveGrid>
    );
    expect(screen.getByTestId("grid").style.gridTemplateColumns).toContain("200px");
  });

  it("is a plain, semantics-free container by default but accepts a role + label for a meaningful group", () => {
    render(
      <ResponsiveGrid role="group" aria-label="Profile fields">
        <div>First name</div>
        <div>Last name</div>
      </ResponsiveGrid>
    );
    expect(
      screen.getByRole("group", { name: "Profile fields" })
    ).toBeInTheDocument();
  });

  it("mirrors layout for RTL contexts — no hard-coded left/right, only flow-relative gap", () => {
    render(<ResponsiveGrid data-testid="grid">content</ResponsiveGrid>);
    const grid = screen.getByTestId("grid");
    expect(grid.style.marginLeft).toBe("");
    expect(grid.style.marginRight).toBe("");
    expect(grid.style.left).toBe("");
    expect(grid.style.right).toBe("");
  });

  it("passes through arbitrary attributes and merges caller style overrides", () => {
    render(
      <ResponsiveGrid
        data-testid="grid"
        align="start"
        style={{ marginTop: "var(--space-4)" }}
      >
        content
      </ResponsiveGrid>
    );
    const grid = screen.getByTestId("grid");
    expect(grid.style.alignItems).toBe("start");
    expect(grid.style.marginTop).toBe("var(--space-4)");
  });
});
