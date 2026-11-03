import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordStrengthMeter, passwordStrength } from "./PasswordStrengthMeter.jsx";

describe("passwordStrength", () => {
  it("buckets by the share of policy rules met", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abc")).toBe(1);
    expect(passwordStrength("abcdefghijkl")).toBeGreaterThanOrEqual(1);
    expect(passwordStrength("Abcdefghijk1")).toBe(3);
    expect(passwordStrength("Correct-Horse-9!")).toBe(4);
  });
});

describe("<PasswordStrengthMeter>", () => {
  it("exposes the level as data-meter and a role=meter reading", () => {
    render(<PasswordStrengthMeter value="Correct-Horse-9!" labels={{ empty: "", weak: "Weak", fair: "Fair", good: "Good", strong: "Strong" }} />);
    const meter = screen.getByRole("meter", { name: "Password strength" });
    expect(meter).toHaveAttribute("data-meter", "strong");
    expect(meter).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("lights segments proportionally to the score", () => {
    const { container } = render(<PasswordStrengthMeter value="abc" />);
    expect(container.querySelectorAll('[data-on="true"]')).toHaveLength(1);
    expect(container.querySelector("[data-meter]")).toHaveAttribute("data-meter", "weak");
  });

  it("renders an empty meter for an empty value", () => {
    const { container } = render(<PasswordStrengthMeter value="" />);
    expect(container.querySelectorAll('[data-on="true"]')).toHaveLength(0);
    expect(container.querySelector("[data-meter]")).toHaveAttribute("data-meter", "empty");
  });
});
