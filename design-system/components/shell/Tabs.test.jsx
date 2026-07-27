import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs.jsx";

const TABS = [
  { value: "plans", label: "Plans" },
  { value: "invoices", label: "Invoices" },
  { value: "payments", label: "Payments" },
];

describe("<Tabs> (controlled button mode)", () => {
  it("renders a tablist of buttons and marks the active one", () => {
    render(<Tabs ariaLabel="Billing" value="invoices" tabs={TABS} onChange={() => {}} />);
    expect(screen.getByRole("tablist", { name: "Billing" })).toBeInTheDocument();
    const invoices = screen.getByRole("tab", { name: "Invoices" });
    expect(invoices).toHaveAttribute("aria-selected", "true");
    expect(invoices.tagName).toBe("BUTTON");
    expect(screen.getByRole("tab", { name: "Plans" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange on click", () => {
    const onChange = vi.fn();
    render(<Tabs ariaLabel="Billing" value="plans" tabs={TABS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
    expect(onChange).toHaveBeenCalledWith("payments");
  });

  it("moves focus+selection with ArrowRight/ArrowLeft (WAI-ARIA automatic activation)", () => {
    const onChange = vi.fn();
    render(<Tabs ariaLabel="Billing" value="plans" tabs={TABS} onChange={onChange} />);
    const plans = screen.getByRole("tab", { name: "Plans" });
    plans.focus();
    fireEvent.keyDown(plans, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("invoices");
  });

  it("Home/End jump to the first/last tab", () => {
    const onChange = vi.fn();
    render(<Tabs ariaLabel="Billing" value="invoices" tabs={TABS} onChange={onChange} />);
    const invoices = screen.getByRole("tab", { name: "Invoices" });
    fireEvent.keyDown(invoices, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("payments");
  });
});

describe("<Tabs> (link mode via href)", () => {
  const ROUTE_TABS = [
    { value: "overview", label: "Overview", href: "/portal/admin" },
    { value: "users", label: "Users", href: "/portal/admin/users" },
    { value: "catalog", label: "App catalog", href: "/portal/admin/catalog" },
  ];

  it("renders tabs with an href as <a> instead of <button>", () => {
    render(<Tabs ariaLabel="Portal admin" value="overview" tabs={ROUTE_TABS} />);
    const users = screen.getByRole("tab", { name: "Users" });
    expect(users.tagName).toBe("A");
    expect(users).toHaveAttribute("href", "/portal/admin/users");
  });

  it("marks the tab matching the current route as selected", () => {
    render(<Tabs ariaLabel="Portal admin" value="catalog" tabs={ROUTE_TABS} />);
    expect(screen.getByRole("tab", { name: "App catalog" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false");
  });

  it("does not set a button type on link tabs", () => {
    render(<Tabs ariaLabel="Portal admin" value="overview" tabs={ROUTE_TABS} />);
    expect(screen.getByRole("tab", { name: "Overview" })).not.toHaveAttribute("type");
  });
});
