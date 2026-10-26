import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrengthMeter } from "./StrengthMeter.jsx";

const onCount = (container) =>
  container.querySelectorAll('[data-on="true"]').length;

describe("<StrengthMeter>", () => {
  it.each([
    ["empty", 0],
    ["weak", 1],
    ["fair", 2],
    ["good", 3],
    ["strong", 4],
  ])("lights %s -> %i bars", (strength, n) => {
    const { container } = render(<StrengthMeter strength={strength} />);
    expect(onCount(container)).toBe(n);
    expect(container.firstChild).toHaveAttribute("data-strength", strength);
  });

  it("clamps to the configured bar count", () => {
    const { container } = render(<StrengthMeter strength="strong" bars={3} />);
    expect(container.querySelectorAll("[data-on]").length).toBe(3);
    expect(onCount(container)).toBe(3);
  });

  it("renders the caption row as a polite live region with a tinted value word", () => {
    render(<StrengthMeter strength="weak" label="Password strength" valueLabel="Weak" />);
    const word = screen.getByText("Weak");
    expect(word.style.color).toBe("var(--error-color)");
    expect(word.parentElement).toHaveAttribute("aria-live", "polite");
  });

  it("keeps the decorative bars out of the accessibility tree", () => {
    const { container } = render(<StrengthMeter strength="good" label="Strength" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("renders children below the meter and forwards data-* hooks", () => {
    render(
      <StrengthMeter strength="fair" data-pwmeter>
        <ul data-testid="rules" />
      </StrengthMeter>,
    );
    expect(screen.getByTestId("rules")).toBeInTheDocument();
    expect(document.querySelector("[data-pwmeter]")).not.toBeNull();
  });
});
