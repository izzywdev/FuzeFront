import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "./Alert.jsx";

describe("<Alert>", () => {
  it.each(["error", "warning", "success", "info"])("renders the %s tone as an alert region", (tone) => {
    render(<Alert tone={tone}>Heads up</Alert>);
    const el = screen.getByRole("alert");
    expect(el).toHaveTextContent("Heads up");
    expect(el.style.border).toContain(`var(--${tone === "info" ? "accent-2" : `${tone}-color`})`);
  });

  it("renders an optional decorative icon on the logical start, hidden from AT", () => {
    render(<Alert tone="info" icon={<svg data-testid="ic" />}>Body</Alert>);
    const ic = screen.getByTestId("ic");
    expect(ic.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("renders no icon wrapper when none is given", () => {
    const { container } = render(<Alert>Body</Alert>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("can be re-roled to a status for non-urgent messages", () => {
    render(<Alert tone="success" role="status">Saved</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});
