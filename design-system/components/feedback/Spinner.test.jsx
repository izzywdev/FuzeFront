import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner.jsx";

describe("<Spinner>", () => {
  it("renders with role=status and a default 'Loading' accessible name", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("supports an explicit label override", () => {
    render(<Spinner label="Checking permissions..." />);
    expect(
      screen.getByRole("status", { name: "Checking permissions..." })
    ).toBeInTheDocument();
  });

  it("defaults to a 32px square sized off the accent token, with currentColor inheritance", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "32px", height: "32px" });
    expect(el).toHaveStyle({ color: "var(--accent-color)" });
  });

  it("accepts a numeric size and derives a proportionate border thickness", () => {
    render(<Spinner size={16} />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "16px", height: "16px" });
    // thickness = max(2, round(size/8)) => 2px for size=16
    expect(el.style.border).toContain("2px solid");
  });

  it("accepts a custom color (e.g. for use inside a colored button)", () => {
    render(<Spinner size={14} color="white" />);
    const el = screen.getByRole("status");
    // jsdom normalizes the named color to its rgb() form
    expect(el).toHaveStyle({ color: "rgb(255, 255, 255)" });
  });

  it("forwards className/style/data-* so it composes inline inside buttons and text", () => {
    render(<Spinner className="-ml-1 mr-2" data-testid="btn-spinner" />);
    const el = screen.getByTestId("btn-spinner");
    expect(el).toHaveClass("-ml-1", "mr-2");
  });
});
