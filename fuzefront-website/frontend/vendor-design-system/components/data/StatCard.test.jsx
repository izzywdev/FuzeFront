import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "./StatCard.jsx";

describe("<StatCard>", () => {
  it("renders label, value, and meta", () => {
    render(<StatCard label="Users" value={18} meta="3 admins, 2 invites pending" />);
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("3 admins, 2 invites pending")).toBeInTheDocument();
  });

  it("renders an optional unit suffix", () => {
    render(<StatCard label="Storage" value={4.2} unit="GB" />);
    expect(screen.getByText("GB")).toBeInTheDocument();
  });

  it("renders as a <div> with no href/onClick", () => {
    render(<StatCard label="Plan" value="Pro" data-testid="card" />);
    expect(screen.getByTestId("card").tagName).toBe("DIV");
  });

  it("renders as an <a> when href is given", () => {
    render(<StatCard label="Users" value={18} href="/portal/admin/users" data-testid="card" />);
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("A");
    expect(card).toHaveAttribute("href", "/portal/admin/users");
  });

  it("fires onClick when provided", () => {
    const onClick = vi.fn();
    render(<StatCard label="Plan" value="Pro" onClick={onClick} data-testid="card" />);
    screen.getByTestId("card").click();
    expect(onClick).toHaveBeenCalled();
  });
});
