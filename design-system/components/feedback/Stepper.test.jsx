import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./Stepper.jsx";

const STEPS = [
  { id: "business", title: "Business details", status: "done" },
  { id: "bank", title: "Bank account", description: "Add a payout account", status: "current" },
  { id: "review", title: "Review & submit", status: "pending" },
];

const PIPELINE = [
  { id: "launching", title: "Launching", status: "done" },
  { id: "building", title: "Building", status: "done" },
  { id: "deploying", title: "Deploying — failed", status: "failed" },
  { id: "deployed", title: "Deployed", status: "pending" },
];

describe("<Stepper>", () => {
  it("renders every step's title", () => {
    render(<Stepper steps={STEPS} />);
    expect(screen.getByText("Business details")).toBeInTheDocument();
    expect(screen.getByText("Bank account")).toBeInTheDocument();
    expect(screen.getByText("Review & submit")).toBeInTheDocument();
  });

  it("renders an optional description", () => {
    render(<Stepper steps={STEPS} />);
    expect(screen.getByText("Add a payout account")).toBeInTheDocument();
  });

  it("marks exactly the current step with aria-current=step", () => {
    render(<Stepper steps={STEPS} />);
    const current = screen.getByText("Bank account").closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
    const done = screen.getByText("Business details").closest("li");
    expect(done).not.toHaveAttribute("aria-current");
    expect(document.querySelectorAll("[aria-current='step']")).toHaveLength(1);
  });

  it("exposes data-step-status per item", () => {
    render(<Stepper steps={STEPS} />);
    expect(screen.getByText("Business details").closest("li")).toHaveAttribute("data-step-status", "done");
    expect(screen.getByText("Review & submit").closest("li")).toHaveAttribute("data-step-status", "pending");
  });

  it("defaults an item with no status to pending", () => {
    render(<Stepper steps={[{ id: "x", title: "No status given" }]} />);
    expect(screen.getByText("No status given").closest("li")).toHaveAttribute("data-step-status", "pending");
  });

  it("treats an unrecognised status as pending rather than rendering undefined styles", () => {
    render(<Stepper steps={[{ id: "x", title: "Odd", status: "bogus" }]} />);
    expect(screen.getByText("Odd").closest("li")).toHaveAttribute("data-step-status", "pending");
  });

  it("is an ordered list of list items", () => {
    render(<Stepper steps={STEPS} />);
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("defaults to the vertical layout", () => {
    render(<Stepper steps={STEPS} />);
    expect(screen.getByRole("list")).toHaveAttribute("data-orientation", "vertical");
  });
});

describe("<Stepper> failed / cancelled", () => {
  it("supports failed and cancelled statuses", () => {
    render(
      <Stepper
        steps={[
          { id: "a", title: "A", status: "failed" },
          { id: "b", title: "B", status: "cancelled" },
        ]}
      />,
    );
    expect(screen.getByText("A").closest("li")).toHaveAttribute("data-step-status", "failed");
    expect(screen.getByText("B").closest("li")).toHaveAttribute("data-step-status", "cancelled");
  });

  it("never marks a failed or cancelled step as the current step", () => {
    render(
      <Stepper
        steps={[
          { id: "a", title: "A", status: "failed" },
          { id: "b", title: "B", status: "cancelled" },
        ]}
      />,
    );
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
  });

  it("uses the error tokens for failed and a neutral token for cancelled (vertical)", () => {
    render(
      <Stepper
        steps={[
          { id: "a", title: "A", status: "failed" },
          { id: "b", title: "B", status: "cancelled" },
        ]}
      />,
    );
    expect(screen.getByText("A").closest("li").style.borderColor).toBe("var(--error-color)");
    expect(screen.getByText("B").closest("li").style.borderColor).toBe("var(--border-strong)");
  });

  it("uses a different glyph for each terminal state (not colour alone)", () => {
    render(
      <Stepper
        steps={[
          { id: "d", title: "D", status: "done" },
          { id: "f", title: "F", status: "failed" },
          { id: "c", title: "C", status: "cancelled" },
        ]}
      />,
    );
    const glyph = (title) => screen.getByText(title).closest("li").querySelector("[aria-hidden='true']").textContent;
    expect(new Set([glyph("D"), glyph("F"), glyph("C")]).size).toBe(3);
  });
});

describe("<Stepper> status as text (a11y)", () => {
  it("exposes each step's status as visually-hidden text, in both orientations", () => {
    for (const orientation of ["vertical", "horizontal"]) {
      const { unmount } = render(
        <Stepper
          orientation={orientation}
          steps={[
            { id: "a", title: "A", status: "done" },
            { id: "b", title: "B", status: "current" },
            { id: "c", title: "C", status: "failed" },
            { id: "d", title: "D", status: "cancelled" },
            { id: "e", title: "E", status: "pending" },
          ]}
        />,
      );
      const text = (t) => screen.getByText(t).closest("li").textContent;
      expect(text("A")).toContain("Completed");
      expect(text("B")).toContain("Current step");
      expect(text("C")).toContain("Failed");
      expect(text("D")).toContain("Cancelled");
      expect(text("E")).toContain("Not started");
      unmount();
    }
  });

  it("lets the status words be localised", () => {
    render(
      <Stepper
        statusLabels={{ done: "Erledigt", pending: "Offen" }}
        steps={[
          { id: "a", title: "A", status: "done" },
          { id: "b", title: "B", status: "pending" },
          { id: "c", title: "C", status: "failed" },
        ]}
      />,
    );
    expect(screen.getByText("A").closest("li").textContent).toContain("Erledigt");
    expect(screen.getByText("B").closest("li").textContent).toContain("Offen");
    // Un-overridden words fall back to the defaults.
    expect(screen.getByText("C").closest("li").textContent).toContain("Failed");
  });

  it("passes aria-label / aria-live through to the list", () => {
    render(<Stepper steps={STEPS} aria-label="Build progress" aria-live="polite" />);
    const list = screen.getByRole("list", { name: "Build progress" });
    expect(list).toHaveAttribute("aria-live", "polite");
  });
});

describe("<Stepper orientation=horizontal>", () => {
  it("renders a segmented grid with a status bar per step", () => {
    const { container } = render(<Stepper orientation="horizontal" steps={PIPELINE} aria-label="Build progress" />);
    const list = screen.getByRole("list", { name: "Build progress" });
    expect(list).toHaveAttribute("data-orientation", "horizontal");
    expect(list.style.display).toBe("grid");
    expect(container.querySelectorAll("[data-step-bar]")).toHaveLength(4);
  });

  it("colours the bar from the status token", () => {
    const { container } = render(<Stepper orientation="horizontal" steps={PIPELINE} />);
    const bar = (id) => container.querySelector(`[data-step='${id}'] [data-step-bar]`).style.background;
    expect(bar("launching")).toBe("var(--success-color)");
    expect(bar("deploying")).toBe("var(--error-color)");
    expect(bar("deployed")).toBe("var(--bg-quaternary)");
  });

  it("uses the seam gradient for the current step and marks it aria-current", () => {
    const { container } = render(
      <Stepper
        orientation="horizontal"
        steps={[
          { id: "launching", title: "Launching", status: "done" },
          { id: "building", title: "Building", status: "current" },
        ]}
      />,
    );
    expect(container.querySelector("[data-step='building'] [data-step-bar]").style.background).toBe("var(--seam)");
    expect(container.querySelector("[data-step='building']")).toHaveAttribute("aria-current", "step");
  });

  it("cancelled steps use the neutral-strong bar", () => {
    const { container } = render(
      <Stepper orientation="horizontal" steps={[{ id: "x", title: "X", status: "cancelled" }]} />,
    );
    expect(container.querySelector("[data-step-bar]").style.background).toBe("var(--border-strong)");
  });

  it("exposes the frames' vocabulary: data-step id and data-step-state (todo for pending)", () => {
    const { container } = render(<Stepper orientation="horizontal" steps={PIPELINE} />);
    expect(container.querySelector("[data-step='deployed']")).toHaveAttribute("data-step-state", "todo");
    expect(container.querySelector("[data-step='deploying']")).toHaveAttribute("data-step-state", "failed");
    expect(container.querySelector("[data-step='launching']")).toHaveAttribute("data-step-state", "done");
  });

  it("collapses columns on narrow screens via auto-fit (no media query / no physical sides)", () => {
    render(<Stepper orientation="horizontal" steps={PIPELINE} />);
    const list = screen.getByRole("list");
    expect(list.style.gridTemplateColumns).toContain("auto-fit");
    expect(list.outerHTML).not.toMatch(/margin-(left|right)|padding-(left|right)|text-align:\s*(left|right)/);
  });

  it("does not emit React key warnings", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Stepper orientation="horizontal" steps={PIPELINE} />);
    render(<Stepper steps={PIPELINE} />);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
