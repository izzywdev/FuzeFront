import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Panel } from "./Panel.jsx";

describe("<Panel>", () => {
  it("renders the title as a heading and associates it via aria-labelledby", () => {
    render(<Panel title="Subscription">body</Panel>);
    const heading = screen.getByRole("heading", { name: "Subscription" });
    expect(heading).toBeInTheDocument();
    const section = screen.getByText("body").closest("section");
    expect(section).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("renders children when no title is given, with no heading and no aria-labelledby", () => {
    render(<Panel>plain body</Panel>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    const section = screen.getByText("plain body").closest("section");
    expect(section).not.toHaveAttribute("aria-labelledby");
  });

  it("honors an explicit titleId instead of generating one", () => {
    render(
      <Panel title="Usage" titleId="ffb-usage-title">
        body
      </Panel>
    );
    const heading = screen.getByRole("heading", { name: "Usage" });
    expect(heading).toHaveAttribute("id", "ffb-usage-title");
    expect(screen.getByText("body").closest("section")).toHaveAttribute(
      "aria-labelledby",
      "ffb-usage-title"
    );
  });

  it("renders headerAction next to the title", () => {
    render(
      <Panel title="Subscription" headerAction={<span>Active</span>}>
        body
      </Panel>
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders the empty message instead of children, token-styled", () => {
    render(<Panel title="Usage" empty="No usage data yet.">{"should not render"}</Panel>);
    expect(screen.queryByText("should not render")).not.toBeInTheDocument();
    const empty = screen.getByText("No usage data yet.");
    expect(empty.tagName).toBe("P");
    expect(empty.style.color).toBe("var(--text-secondary)");
    expect(empty.style.fontSize).toBe("var(--text-sm)");
  });

  it("renders children when empty is not given", () => {
    render(<Panel title="Subscription">the real content</Panel>);
    expect(screen.getByText("the real content")).toBeInTheDocument();
  });

  it("renders an actions footer row when given", () => {
    render(
      <Panel title="Subscription" actions={<button>Cancel</button>}>
        body
      </Panel>
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("omits the actions row entirely when not given", () => {
    const { container } = render(<Panel title="Subscription">body</Panel>);
    expect(container.querySelectorAll("section > div").length).toBe(1); // just the header row
  });

  it("uses DS tokens only for surface styling — no raw hex/px", () => {
    render(<Panel title="Subscription">body</Panel>);
    const section = screen.getByText("body").closest("section");
    expect(section.style.background).toBe("var(--bg-tertiary)");
    expect(section.style.border).toBe("var(--border-width) solid var(--border-color)");
    expect(section.style.borderRadius).toBe("var(--radius-lg)");
    expect(section.style.padding).toBe("var(--space-5)");
    expect(section.style.gap).toBe("var(--space-4)");
  });

  it("mirrors layout for RTL — actions row uses flow-relative marginBlockStart, no left/right", () => {
    render(
      <Panel title="Subscription" actions={<button>Go</button>}>
        body
      </Panel>
    );
    const actionsRow = screen.getByRole("button", { name: "Go" }).closest("div");
    expect(actionsRow.style.marginBlockStart).toBe("var(--space-1)");
    expect(actionsRow.style.marginLeft).toBe("");
    expect(actionsRow.style.marginRight).toBe("");
  });

  it("forwards arbitrary attributes and merges caller style overrides onto the section", () => {
    render(
      <Panel title="Subscription" data-testid="panel" style={{ marginTop: "var(--space-4)" }}>
        body
      </Panel>
    );
    const section = screen.getByTestId("panel");
    expect(section.style.marginTop).toBe("var(--space-4)");
  });
});
