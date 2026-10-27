import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineValidatedInput } from "./InlineValidatedInput.jsx";

describe("<InlineValidatedInput>", () => {
  it("associates the label with the field and renders the accessory as a polite status", () => {
    render(<InlineValidatedInput label="Work email" accessory="Available" state="valid" />);
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Available");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("valid: success ring, not aria-invalid", () => {
    render(<InlineValidatedInput label="Email" state="valid" />);
    const input = screen.getByLabelText("Email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.style.border).toContain("var(--success-color)");
    expect(input.getAttribute("data-state")).toBe("valid");
  });

  it("invalid: error ring + aria-invalid without needing an error message", () => {
    render(<InlineValidatedInput label="Email" state="invalid" help="That email has an account." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.style.border).toContain("var(--error-color)");
    expect(input).toHaveAccessibleDescription("That email has an account.");
  });

  it("checking: marks the field aria-busy and stays neutral", () => {
    render(<InlineValidatedInput label="Email" state="checking" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("idle: no status region without an accessory and no busy flag", () => {
    render(<InlineValidatedInput label="Email" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-busy");
  });

  it("pads the field's logical end when an adornment is present (RTL-safe)", () => {
    render(<InlineValidatedInput label="Email" state="valid" />);
    expect(screen.getByLabelText("Email").style.paddingInlineEnd).toBe("var(--space-10)");
  });

  it("surfaces an explicit error message via role=alert", () => {
    render(<InlineValidatedInput label="Email" error="Bad email" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bad email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });
});
