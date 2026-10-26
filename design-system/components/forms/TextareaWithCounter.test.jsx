import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TextareaWithCounter } from "./TextareaWithCounter.jsx";

afterEach(() => {
  vi.useRealTimers();
});

const field = () => screen.getByRole("textbox");
const counter = (container) => container.querySelector("[data-text-counter]");
const liveRegion = () => screen.getByRole("status");

describe("<TextareaWithCounter> counter", () => {
  it("shows count / max on the label row, outside the <label>", () => {
    const { container } = render(
      <TextareaWithCounter label="Brief" maxLength={4000} defaultValue="hello" />,
    );
    expect(counter(container)).toHaveTextContent("5 / 4,000");
    // The counter must not pollute the field's accessible name.
    expect(screen.getByLabelText("Brief")).toBe(field());
    expect(screen.getByText("Brief").closest("label")).not.toContainElement(counter(container));
    // …and sits in the same row as the label.
    expect(container.querySelector("[data-textarea-label-row]")).toContainElement(counter(container));
  });

  it("updates as the user types (uncontrolled)", () => {
    const { container } = render(<TextareaWithCounter label="Brief" maxLength={10} />);
    expect(counter(container)).toHaveTextContent("0 / 10");
    fireEvent.change(field(), { target: { value: "abcd" } });
    expect(counter(container)).toHaveTextContent("4 / 10");
    expect(field()).toHaveValue("abcd");
  });

  it("follows the value when controlled and still calls onChange", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <TextareaWithCounter label="Brief" maxLength={10} value="abc" onChange={onChange} />,
    );
    expect(counter(container)).toHaveTextContent("3 / 10");
    fireEvent.change(field(), { target: { value: "abcdef" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    // Controlled: nothing changes until the parent re-renders with the new value.
    expect(counter(container)).toHaveTextContent("3 / 10");
    rerender(<TextareaWithCounter label="Brief" maxLength={10} value="abcdef" onChange={onChange} />);
    expect(counter(container)).toHaveTextContent("6 / 10");
  });

  it("counts Unicode code points, not UTF-16 units (an emoji is one character)", () => {
    const { container } = render(
      <TextareaWithCounter label="Brief" maxLength={10} defaultValue={"a😀b"} />,
    );
    expect(counter(container)).toHaveTextContent("3 / 10");
  });

  it("formats numbers for the given locale", () => {
    const { container } = render(
      <TextareaWithCounter label="Brief" maxLength={4000} locale="de-DE" defaultValue={"x".repeat(1234)} />,
    );
    expect(counter(container)).toHaveTextContent("1.234 / 4.000");
  });

  it("forwards counterProps (data hooks) to the visible counter", () => {
    const { container } = render(
      <TextareaWithCounter label="Brief" maxLength={10} counterProps={{ "data-counter": "brief" }} />,
    );
    expect(container.querySelector("[data-counter='brief']")).toBe(counter(container));
  });
});

describe("<TextareaWithCounter> limit", () => {
  it("soft limit (default): allows exceeding and flags the overflow", () => {
    const { container } = render(
      <TextareaWithCounter label="Brief" maxLength={5} defaultValue="abcdefgh" />,
    );
    expect(field()).not.toHaveAttribute("maxlength");
    expect(field()).toHaveValue("abcdefgh");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(counter(container)).toHaveAttribute("data-over", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Too long — the limit is 5 characters");
  });

  it("is not flagged at exactly the limit, only beyond it", () => {
    const { container } = render(
      <TextareaWithCounter label="Brief" maxLength={5} defaultValue="abcde" />,
    );
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(counter(container)).not.toHaveAttribute("data-over");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("strict truncates input to the code-point limit (an emoji counts as one)", () => {
    const onChange = vi.fn();
    render(<TextareaWithCounter label="Brief" maxLength={3} strict onChange={onChange} />);
    // The native maxlength attribute is never set — it counts UTF-16 units and
    // would cut an emoji off mid-surrogate, making the limit unreachable.
    expect(field()).not.toHaveAttribute("maxlength");
    fireEvent.change(field(), { target: { value: "ab😀cd" } });
    // "ab😀cd" is 5 code points; truncated to 3 → "ab😀" (not a broken surrogate).
    expect(field()).toHaveValue("ab😀");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("strict leaves within-limit input untouched", () => {
    render(<TextareaWithCounter label="Brief" maxLength={5} strict />);
    fireEvent.change(field(), { target: { value: "abc" } });
    expect(field()).toHaveValue("abc");
  });

  it("a caller-supplied error wins over the built-in over-limit message", () => {
    render(
      <TextareaWithCounter label="Brief" maxLength={5} defaultValue="abcdefgh" error="The brief is 3 over." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The brief is 3 over.");
    expect(screen.queryByText(/Too long/)).not.toBeInTheDocument();
  });

  it("a caller error marks the field invalid even when under the limit", () => {
    render(<TextareaWithCounter label="Brief" maxLength={50} defaultValue="ok" error="Required" />);
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });

  it("overLimitMessage overrides the default over-limit text", () => {
    render(
      <TextareaWithCounter label="Brief" maxLength={2} defaultValue="abc" overLimitMessage="Trop long" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Trop long");
  });

  it("the visible over-limit error is stable across keystrokes (no per-keystroke re-announce)", () => {
    render(<TextareaWithCounter label="Brief" maxLength={3} defaultValue="abcd" />);
    const before = screen.getByRole("alert").textContent;
    fireEvent.change(field(), { target: { value: "abcdefgh" } });
    expect(screen.getByRole("alert").textContent).toBe(before);
  });
});

describe("<TextareaWithCounter> accessibility", () => {
  it("hides the visual counter from AT and describes the field by a remaining-count message", () => {
    const { container } = render(
      <TextareaWithCounter label="Brief" maxLength={10} defaultValue="abc" />,
    );
    expect(counter(container)).toHaveAttribute("aria-hidden", "true");
    expect(field()).toHaveAccessibleDescription("7 of 10 characters remaining");
  });

  it("describes the over-limit state in words", () => {
    render(<TextareaWithCounter label="Brief" maxLength={3} defaultValue="abcde" />);
    expect(field()).toHaveAccessibleDescription(expect.stringContaining("2 characters over the limit of 3"));
  });

  it("uses singular forms correctly", () => {
    render(<TextareaWithCounter label="Brief" maxLength={3} defaultValue="ab" />);
    expect(field()).toHaveAccessibleDescription("1 of 3 characters remaining");
  });

  it("keeps a caller's aria-describedby alongside the count message", () => {
    render(
      <>
        <p id="hint">Be specific.</p>
        <TextareaWithCounter label="Brief" maxLength={10} aria-describedby="hint" />
      </>,
    );
    expect(field()).toHaveAccessibleDescription(expect.stringContaining("Be specific."));
    expect(field()).toHaveAccessibleDescription(expect.stringContaining("10 of 10 characters remaining"));
  });

  it("formatMessage localises the description", () => {
    render(
      <TextareaWithCounter
        label="Brief"
        maxLength={10}
        defaultValue="abc"
        formatMessage={({ remaining }) => `Noch ${remaining} Zeichen`}
      />,
    );
    expect(field()).toHaveAccessibleDescription("Noch 7 Zeichen");
  });

  it("has a polite live region that is silent on mount", () => {
    render(<TextareaWithCounter label="Brief" maxLength={10} defaultValue="abc" />);
    expect(liveRegion()).toHaveAttribute("aria-live", "polite");
    expect(liveRegion()).toHaveTextContent("");
  });

  it("announces only after the user pauses typing (debounced), not per keystroke", () => {
    vi.useFakeTimers();
    render(<TextareaWithCounter label="Brief" maxLength={10} announceDelay={1000} />);
    fireEvent.change(field(), { target: { value: "a" } });
    fireEvent.change(field(), { target: { value: "ab" } });
    fireEvent.change(field(), { target: { value: "abc" } });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(liveRegion()).toHaveTextContent("");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(liveRegion()).toHaveTextContent("7 of 10 characters remaining");
  });

  it("announceDelay={0} announces immediately", () => {
    render(<TextareaWithCounter label="Brief" maxLength={10} announceDelay={0} />);
    fireEvent.change(field(), { target: { value: "abc" } });
    expect(liveRegion()).toHaveTextContent("7 of 10 characters remaining");
  });

  it("is keyboard-focusable and forwards disabled", () => {
    const { rerender } = render(<TextareaWithCounter label="Brief" maxLength={10} />);
    field().focus();
    expect(field()).toHaveFocus();
    rerender(<TextareaWithCounter label="Brief" maxLength={10} disabled />);
    expect(field()).toBeDisabled();
  });
});

describe("<TextareaWithCounter> RTL", () => {
  it("places the counter with a logical (inline-end) margin, so it mirrors under dir=rtl", () => {
    const { container } = render(
      <div dir="rtl">
        <TextareaWithCounter label="Brief" maxLength={10} />
      </div>,
    );
    const slot = counter(container).parentElement;
    expect(slot.style.marginInlineStart).toBe("auto");
    // No physical left/right positioning anywhere in the counter row.
    const row = container.querySelector("[data-textarea-label-row]");
    expect(row.outerHTML).not.toMatch(/margin-(left|right)|padding-(left|right)|text-align:\s*(left|right)/);
  });
});
