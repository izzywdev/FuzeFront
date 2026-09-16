import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeField } from "./CodeField.jsx";

describe("<CodeField>", () => {
  it("renders a single-line input by default, associated with its label", () => {
    render(<CodeField label="Retry backoff" defaultValue="PT5M" />);
    const field = screen.getByLabelText("Retry backoff");
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveValue("PT5M");
  });

  it("renders a textarea when multiline is set", () => {
    render(<CodeField label="Config value (JSON)" multiline defaultValue="{}" />);
    const field = screen.getByLabelText("Config value (JSON)");
    expect(field.tagName).toBe("TEXTAREA");
  });

  it("shows a validation message and marks aria-invalid when error is set", () => {
    render(<CodeField label="Retry backoff" error="Not a valid ISO-8601 duration." defaultValue="5 minutes" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not a valid ISO-8601 duration.");
    expect(screen.getByLabelText("Retry backoff")).toHaveAttribute("aria-invalid", "true");
  });

  it("forwards onChange and native attributes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CodeField label="Value" onChange={onChange} placeholder="PT5M" />);
    await user.type(screen.getByLabelText("Value"), "x");
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText("Value")).toHaveAttribute("placeholder", "PT5M");
  });

  it("disables the field when disabled is set", () => {
    render(<CodeField label="Value" disabled defaultValue="x" />);
    expect(screen.getByLabelText("Value")).toBeDisabled();
  });
});
