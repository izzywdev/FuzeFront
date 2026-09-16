import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressMeter } from "./ProgressMeter.jsx";

describe("<ProgressMeter>", () => {
  it("renders an accessible progressbar with correct aria values", () => {
    render(<ProgressMeter value={30} max={100} label="Seats used" />);
    const bar = screen.getByRole("progressbar", { name: "Seats used" });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps the fill percentage within [0, 100] for out-of-range values", () => {
    const { rerender } = render(<ProgressMeter value={150} max={100} label="Over" />);
    let bar = screen.getByRole("progressbar");
    expect(bar.firstChild).toHaveStyle({ inlineSize: "100%" });

    rerender(<ProgressMeter value={-10} max={100} label="Under" />);
    bar = screen.getByRole("progressbar");
    expect(bar.firstChild).toHaveStyle({ inlineSize: "0%" });
  });

  it("falls back to a safe max when max is 0 or negative", () => {
    render(<ProgressMeter value={5} max={0} label="Zero max" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemax", "1");
  });

  it("renders an optional valueLabel alongside the label", () => {
    render(<ProgressMeter value={4} max={5} label="Usage" valueLabel="4 / 5" />);
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
  });

  it("falls back to a generic aria-label when no label is given", () => {
    render(<ProgressMeter value={1} max={2} />);
    expect(screen.getByRole("progressbar", { name: "progress" })).toBeInTheDocument();
  });

  it.each([
    ["seam", "var(--seam)"],
    ["warning", "var(--warning-color)"],
    ["danger", "var(--error-color)"],
  ])("tone=%s applies the matching fill token", (tone, expected) => {
    render(<ProgressMeter value={5} max={10} tone={tone} label="Tone check" />);
    const fill = screen.getByRole("progressbar").firstChild;
    expect(fill).toHaveStyle({ background: expected });
  });
});
