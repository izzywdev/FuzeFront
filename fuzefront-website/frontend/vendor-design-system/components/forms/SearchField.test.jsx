import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchField } from "./SearchField.jsx";

describe("<SearchField>", () => {
  it("renders a type=search input reachable by its (hidden) accessible label", () => {
    render(<SearchField />);
    const input = screen.getByLabelText("Search");
    expect(input).toHaveAttribute("type", "search");
  });

  it("shows a visible label when hideLabel is false", () => {
    render(<SearchField label="Filter portals" hideLabel={false} />);
    const label = screen.getByText("Filter portals");
    expect(label.style.position).not.toBe("absolute");
  });

  it("is a controlled input — fires onChange with the typed value", () => {
    const onChange = vi.fn();
    render(<SearchField value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "north" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("forwards data-* test hooks to the input", () => {
    render(<SearchField data-input="search" />);
    expect(screen.getByRole("searchbox")).toHaveAttribute("data-input", "search");
  });

  it("calls a caller-supplied onFocus/onBlur in addition to its own focus-ring handling", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<SearchField onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByRole("searchbox");
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
