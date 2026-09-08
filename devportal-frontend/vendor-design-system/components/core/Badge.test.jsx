import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge.jsx";

describe("<Badge>", () => {
  it("renders its children as text content", () => {
    render(<Badge tone="accent">react</Badge>);
    expect(screen.getByText("react")).toBeInTheDocument();
  });

  it.each(["neutral", "accent", "info", "success", "warning", "error"])(
    "accepts tone=%s without throwing",
    (tone) => {
      render(<Badge tone={tone}>label</Badge>);
      expect(screen.getByText("label")).toBeInTheDocument();
    }
  );

  it("the info tone renders on the cyan accent-2 token (distinct from accent/indigo)", () => {
    render(<Badge tone="info">Soft</Badge>);
    const el = screen.getByText("Soft");
    expect(el.style.color).toBe("var(--accent-2)");
  });

  it("the accent tone renders on the indigo accent-color token", () => {
    render(<Badge tone="accent">Hard</Badge>);
    const el = screen.getByText("Hard");
    expect(el.style.color).toBe("var(--accent-color)");
  });

  it("mono switches to the mono font and skips uppercasing", () => {
    render(<Badge tone="neutral" mono>read:apps</Badge>);
    const el = screen.getByText("read:apps");
    expect(el.style.fontFamily).toBe("var(--font-mono)");
    expect(el.style.textTransform).toBe("none");
  });

  it("dot prepends a decorative status dot", () => {
    const { container } = render(<Badge tone="success" dot>Running</Badge>);
    expect(container.querySelector("svg[aria-hidden='true']")).toBeInTheDocument();
  });

  it("forwards arbitrary data-* attributes (test hooks) to the rendered span", () => {
    render(<Badge tone="info" data-tier="soft">Soft</Badge>);
    expect(screen.getByText("Soft").closest("span")).toHaveAttribute("data-tier", "soft");
  });
});
