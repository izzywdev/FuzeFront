import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl.jsx";

const OPTIONS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
];

describe("<SegmentedControl>", () => {
  it("renders a labelled group of buttons and marks the selected one", () => {
    render(<SegmentedControl ariaLabel="Channel" value="email" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Channel" })).toBeInTheDocument();
    const email = screen.getByRole("button", { name: "Email" });
    expect(email).toHaveAttribute("aria-pressed", "true");
    expect(email).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("button", { name: "WhatsApp" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with the new value, and not when re-selecting the active segment", () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Channel" value="email" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Email" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    expect(onChange).toHaveBeenCalledWith("whatsapp");
  });

  it("moves focus with the arrow keys without changing the value", () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Channel" value="email" options={OPTIONS} onChange={onChange} />);
    const email = screen.getByRole("button", { name: "Email" });
    email.focus();
    fireEvent.keyDown(email, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "WhatsApp" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("inerts every segment and sets aria-disabled when disabled", () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Member type" value="email" options={OPTIONS} onChange={onChange} disabled />);
    expect(screen.getByRole("group", { name: "Member type" })).toHaveAttribute("aria-disabled", "true");
    const wa = screen.getByRole("button", { name: "WhatsApp" });
    expect(wa).toBeDisabled();
    fireEvent.click(wa);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("skips a disabled option and uses logical properties only (RTL-safe)", () => {
    const { container } = render(
      <SegmentedControl
        ariaLabel="Kind"
        value="email"
        options={[...OPTIONS, { value: "x", label: "Other", disabled: true }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Other" })).toBeDisabled();
    const html = container.innerHTML;
    expect(html).not.toMatch(/margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/);
  });
});
