import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Textarea } from "./Textarea.jsx";

describe("<Textarea>", () => {
  it("associates the label with the field", () => {
    render(<Textarea label="Notes" />);
    expect(screen.getByLabelText("Notes")).toBe(screen.getByRole("textbox"));
  });

  it("renders an error as an alert and marks the field invalid", () => {
    render(<Textarea label="Notes" error="Required" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the original DOM (no label-row wrapper) when no labelAccessory is given", () => {
    const { container } = render(<Textarea label="Notes" />);
    expect(container.querySelector("[data-textarea-label-row]")).toBeNull();
    expect(screen.getByText("Notes").parentElement).toBe(container.firstChild);
  });
});

describe("<Textarea> labelAccessory", () => {
  it("renders the accessory on the label row, outside the <label>", () => {
    const { container } = render(
      <Textarea label="Notes" labelAccessory={<span data-testid="acc">12 / 50</span>} />,
    );
    const row = container.querySelector("[data-textarea-label-row]");
    expect(row).toContainElement(screen.getByTestId("acc"));
    expect(screen.getByText("Notes").closest("label")).not.toContainElement(screen.getByTestId("acc"));
    // The accessory does not leak into the accessible name.
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
  });

  it("pins the accessory to the inline-end edge with a logical margin", () => {
    render(<Textarea label="Notes" labelAccessory={<span data-testid="acc">x</span>} />);
    expect(screen.getByTestId("acc").parentElement.style.marginInlineStart).toBe("auto");
  });

  it("still renders the accessory when there is no label", () => {
    render(<Textarea labelAccessory={<span data-testid="acc">x</span>} aria-label="Notes" />);
    expect(screen.getByTestId("acc")).toBeInTheDocument();
  });
});

describe("<Textarea> focus handlers", () => {
  it("chains a caller's onFocus/onBlur instead of replacing the focus-ring handlers", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<Textarea label="Notes" onFocus={onFocus} onBlur={onBlur} />);
    const el = screen.getByRole("textbox");

    fireEvent.focus(el);
    expect(onFocus).toHaveBeenCalledTimes(1);
    // The accent ring is still applied (previously the caller's handler clobbered it).
    expect(el.style.borderColor).toBe("var(--accent-color)");
    expect(el.style.boxShadow).toContain("var(--accent-soft)");

    fireEvent.blur(el);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(el.style.boxShadow).toBe("none");
  });
});
