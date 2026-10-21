import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpInput } from "./OtpInput.jsx";

describe("<OtpInput>", () => {
  it("renders a labelled group with one input per digit", () => {
    render(<OtpInput />);
    const group = screen.getByRole("group", { name: "One-time code" });
    expect(group).toHaveAttribute("data-component", "otp-input");
    expect(group.querySelectorAll("input")).toHaveLength(6);
    expect(screen.getByLabelText("digit 1")).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("auto-advances while typing and fires onComplete with the full code", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onChange = vi.fn();
    render(<OtpInput onComplete={onComplete} onChange={onChange} />);
    await user.click(screen.getByLabelText("digit 1"));
    await user.keyboard("492017");
    expect(onComplete).toHaveBeenCalledWith("492017");
    expect(onChange).toHaveBeenLastCalledWith("492017", true);
    expect(screen.getByLabelText("digit 6")).toHaveValue("7");
  });

  it("ignores non-digits by default", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OtpInput onChange={onChange} />);
    await user.click(screen.getByLabelText("digit 1"));
    await user.keyboard("a1b2");
    expect(onChange).toHaveBeenLastCalledWith("12", false);
  });

  it("is paste-aware: a pasted code fills every cell", () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);
    fireEvent.paste(screen.getByLabelText("digit 3"), {
      clipboardData: { getData: () => "123 456" },
    });
    expect(onComplete).toHaveBeenCalledWith("123456");
    expect(screen.getByLabelText("digit 1")).toHaveValue("1");
    expect(screen.getByLabelText("digit 6")).toHaveValue("6");
  });

  it("Backspace on an empty cell clears and focuses the previous cell", async () => {
    const user = userEvent.setup();
    render(<OtpInput defaultValue="12" />);
    await user.click(screen.getByLabelText("digit 3"));
    await user.keyboard("{Backspace}");
    expect(screen.getByLabelText("digit 2")).toHaveValue("");
    expect(screen.getByLabelText("digit 2")).toHaveFocus();
  });

  it("arrow keys move focus between cells", async () => {
    const user = userEvent.setup();
    render(<OtpInput />);
    await user.click(screen.getByLabelText("digit 2"));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByLabelText("digit 3")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByLabelText("digit 1")).toHaveFocus();
  });

  it("marks cells invalid in the error state and disables them when disabled", () => {
    const { rerender } = render(<OtpInput error />);
    expect(screen.getByLabelText("digit 1")).toHaveAttribute("aria-invalid", "true");
    rerender(<OtpInput disabled />);
    expect(screen.getByLabelText("digit 1")).toBeDisabled();
  });

  it("is controlled when value is provided", () => {
    render(<OtpInput value="98" onChange={() => {}} />);
    expect(screen.getByLabelText("digit 1")).toHaveValue("9");
    expect(screen.getByLabelText("digit 2")).toHaveValue("8");
    expect(screen.getByLabelText("digit 3")).toHaveValue("");
  });

  it("keeps digits left-to-right and sizes touch cells to the tap-target token", () => {
    render(<OtpInput size="touch" />);
    expect(screen.getByRole("group")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("digit 1").style.minWidth).toBe("var(--touch-target)");
  });

  it("clearing a MIDDLE cell leaves a blank: onChange reports incomplete and onComplete does not fire", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<OtpInput defaultValue="123456" onChange={onChange} onComplete={onComplete} />);
    await user.click(screen.getByLabelText("digit 3"));
    await user.keyboard("{Backspace}");
    const [value, complete] = onChange.mock.lastCall;
    expect(value).toBe("12 456");
    expect(value).toHaveLength(6); // the trap: length alone looks complete
    expect(complete).toBe(false);
    expect(OtpInput.isComplete(value, 6)).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("isComplete is true only for a fully filled code", () => {
    expect(OtpInput.isComplete("123456", 6)).toBe(true);
    expect(OtpInput.isComplete("12345", 6)).toBe(false);
    expect(OtpInput.isComplete("12 456", 6)).toBe(false);
    expect(OtpInput.isComplete("", 6)).toBe(false);
  });
});
