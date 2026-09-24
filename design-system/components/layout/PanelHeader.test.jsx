import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PanelHeader } from "./PanelHeader.jsx";

describe("<PanelHeader>", () => {
  it("renders the title as a heading", () => {
    render(<PanelHeader title="Subscription" />);
    expect(screen.getByRole("heading", { name: "Subscription" })).toBeInTheDocument();
  });

  it("puts the given id on the heading, so a panel's aria-labelledby can target it", () => {
    render(<PanelHeader id="ffb-sub-title" title="Subscription" />);
    const heading = screen.getByRole("heading", { name: "Subscription" });
    expect(heading).toHaveAttribute("id", "ffb-sub-title");

    const { container } = render(
      <section aria-labelledby="ffb-sub-title-2">
        <PanelHeader id="ffb-sub-title-2" title="Usage" />
      </section>
    );
    const section = container.querySelector("section");
    const labelledBy = section.getAttribute("aria-labelledby");
    expect(container.querySelector(`#${labelledBy}`)).toHaveTextContent("Usage");
  });

  it("renders no trailing node when children are omitted", () => {
    const { container } = render(<PanelHeader title="Payment method" />);
    // only the heading is rendered — no empty trailing wrapper
    expect(container.firstChild.children).toHaveLength(1);
  });

  it("renders trailing content (e.g. a status pill or action) flush to the end", () => {
    render(
      <PanelHeader title="Subscription">
        <span data-testid="trailing">active</span>
      </PanelHeader>
    );
    expect(screen.getByTestId("trailing")).toBeInTheDocument();
  });

  it("lays out with flow-relative flex properties only — no hard-coded left/right (RTL mirrors automatically)", () => {
    const { container } = render(<PanelHeader title="Subscription" />);
    const root = container.firstChild;
    expect(root.style.display).toBe("flex");
    expect(root.style.justifyContent).toBe("space-between");
    expect(root.style.marginLeft).toBe("");
    expect(root.style.marginRight).toBe("");
    expect(root.style.left).toBe("");
    expect(root.style.right).toBe("");
  });

  it("uses design-system tokens only for the title, not raw values", () => {
    render(<PanelHeader title="Subscription" />);
    const heading = screen.getByRole("heading", { name: "Subscription" });
    expect(heading.style.fontSize).toBe("var(--text-base)");
    expect(heading.style.fontWeight).toBe("var(--weight-semibold)");
    expect(heading.style.color).toBe("var(--text-primary)");
  });

  it("forwards arbitrary attributes (e.g. data-* test hooks) to the root element", () => {
    render(<PanelHeader title="Subscription" data-testid="panel-header" />);
    expect(screen.getByTestId("panel-header")).toBeInTheDocument();
  });
});
