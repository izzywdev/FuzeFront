import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Panel } from "./Panel.jsx";

describe("<Panel>", () => {
  it("renders as a labelled region with the title as its accessible name", () => {
    render(<Panel title="Subscription">Body content</Panel>);
    const region = screen.getByRole("region", { name: "Subscription" });
    expect(region).toBeInTheDocument();
    expect(region.tagName).toBe("SECTION");
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("renders children when no empty state is given", () => {
    render(<Panel title="Usage">42 seats</Panel>);
    expect(screen.getByText("42 seats")).toBeInTheDocument();
  });

  it("renders the empty-state message instead of children when `empty` is given", () => {
    render(
      <Panel title="Payment method" empty="No card on file">
        Card details that should not render
      </Panel>
    );
    expect(screen.getByText("No card on file")).toBeInTheDocument();
    expect(screen.queryByText("Card details that should not render")).not.toBeInTheDocument();
  });

  it("renders trailing content beside the title", () => {
    render(
      <Panel title="Subscription" trailing={<span data-testid="status">Active</span>}>
        Body
      </Panel>
    );
    expect(screen.getByTestId("status")).toBeInTheDocument();
  });

  it("renders an actions row when provided", () => {
    render(
      <Panel title="Subscription" actions={<button type="button">Cancel</button>}>
        Body
      </Panel>
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("omits the actions row when not provided", () => {
    render(<Panel title="Usage">Body</Panel>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses an explicit titleId when given, for a caller that needs to reference it elsewhere", () => {
    render(
      <Panel title="Subscription" titleId="ffb-sub-title">
        Body
      </Panel>
    );
    expect(document.getElementById("ffb-sub-title")).toHaveTextContent("Subscription");
    expect(screen.getByRole("region")).toHaveAttribute("aria-labelledby", "ffb-sub-title");
  });

  it("generates a stable titleId when none is given, so aria-labelledby always resolves", () => {
    render(<Panel title="Usage">Body</Panel>);
    const region = screen.getByRole("region", { name: "Usage" });
    const labelledBy = region.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy)).toHaveTextContent("Usage");
  });

  it("mirrors in RTL via logical properties only (no left/right in inline styles)", () => {
    const { container } = render(
      <div dir="rtl">
        <Panel title="Subscription" actions={<button type="button">Cancel</button>}>
          Body
        </Panel>
      </div>
    );
    const region = container.querySelector("section");
    // Symmetric padding/gap + logical margin only — never a physical left/right.
    expect(region.style.marginLeft).toBe("");
    expect(region.style.marginRight).toBe("");
    expect(region.style.left).toBe("");
    expect(region.style.right).toBe("");
  });
});
