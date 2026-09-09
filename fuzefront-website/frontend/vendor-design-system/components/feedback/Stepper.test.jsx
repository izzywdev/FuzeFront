import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./Stepper.jsx";

const STEPS = [
  { id: "business", title: "Business details", status: "done" },
  { id: "bank", title: "Bank account", description: "Add a payout account", status: "current" },
  { id: "review", title: "Review & submit", status: "pending" },
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
});
