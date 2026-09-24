import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavLink } from "./NavLink.jsx";

describe("<NavLink> (plain link, no submenu)", () => {
  it("renders a real anchor with the label and href", () => {
    render(<NavLink label="Pricing" href="/pricing" />);
    const link = screen.getByRole("link", { name: "Pricing" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/pricing");
  });

  it("marks the active link with aria-current, but not an inactive one", () => {
    render(
      <>
        <NavLink label="Pricing" href="/pricing" active />
        <NavLink label="About" href="/about" />
      </>,
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "About" })).not.toHaveAttribute("aria-current");
  });

  it("renders as a router Link (or any component) via the `as` prop", () => {
    const RouterLink = ({ to, children, ...rest }) => (
      <a href={to} data-router-link {...rest}>
        {children}
      </a>
    );
    render(<NavLink as={RouterLink} to="/about" label="About" />);
    const link = screen.getByRole("link", { name: "About" });
    expect(link).toHaveAttribute("data-router-link");
    expect(link).toHaveAttribute("href", "/about");
  });

  it("has no aria-haspopup/aria-expanded when there is no submenu", () => {
    render(<NavLink label="About" href="/about" />);
    const link = screen.getByRole("link", { name: "About" });
    expect(link).not.toHaveAttribute("aria-haspopup");
    expect(link).not.toHaveAttribute("aria-expanded");
  });
});

describe("<NavLink> (with submenu)", () => {
  const SUBMENU = [
    { label: "FuzeFront Platform", href: "/products/fuzefront", description: "Module Federation host shell" },
    { label: "FuzeAgent", href: "/products/fuzeagent", description: "AI team orchestration" },
  ];

  it("declares the disclosure relationship via aria-haspopup/aria-expanded/aria-controls", () => {
    render(<NavLink label="Products" href="/products" submenu={SUBMENU} />);
    const trigger = screen.getByRole("link", { name: /Products/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls");
    // Closed by default — the panel isn't rendered at all.
    expect(screen.queryByText("FuzeFront Platform")).not.toBeInTheDocument();
  });

  it("opens the panel on hover and renders each submenu row", () => {
    render(<NavLink label="Products" href="/products" submenu={SUBMENU} />);
    const trigger = screen.getByRole("link", { name: /Products/ });
    fireEvent.mouseEnter(trigger.parentElement);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("FuzeFront Platform")).toBeInTheDocument();
    expect(screen.getByText("Module Federation host shell")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /FuzeAgent/ })).toHaveAttribute(
      "href",
      "/products/fuzeagent",
    );
  });

  it("opens the panel on focus", () => {
    render(<NavLink label="Products" href="/products" submenu={SUBMENU} />);
    const trigger = screen.getByRole("link", { name: /Products/ });
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<NavLink label="Products" href="/products" submenu={SUBMENU} />);
    const trigger = screen.getByRole("link", { name: /Products/ });
    fireEvent.mouseEnter(trigger.parentElement);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("supports a fully controlled open state via open/onOpenChange", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <NavLink label="Products" href="/products" submenu={SUBMENU} open={false} onOpenChange={onOpenChange} />,
    );
    const trigger = screen.getByRole("link", { name: /Products/ });
    fireEvent.mouseEnter(trigger.parentElement);
    // Controlled: hovering requests open via the callback but does not flip
    // the DOM state itself until the consumer passes open=true back down.
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    rerender(
      <NavLink label="Products" href="/products" submenu={SUBMENU} open onOpenChange={onOpenChange} />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("FuzeFront Platform")).toBeInTheDocument();
  });

  it("the submenu panel is not role=menu (navigation links, not actions)", () => {
    render(<NavLink label="Products" href="/products" submenu={SUBMENU} defaultOpen />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /FuzeAgent/ })).toBeInTheDocument();
  });

  it("renders submenu rows via submenuAs, forwarding non-href fields like `to`", () => {
    const RouterLink = ({ to, children, ...rest }) => (
      <a href={to} data-router-link {...rest}>
        {children}
      </a>
    );
    render(
      <NavLink
        as={RouterLink}
        to="/products"
        label="Products"
        submenuAs={RouterLink}
        submenu={[{ label: "FuzeAgent", to: "/products/fuzeagent" }]}
        defaultOpen
      />,
    );
    const row = screen.getByRole("link", { name: "FuzeAgent" });
    expect(row).toHaveAttribute("data-router-link");
    expect(row).toHaveAttribute("href", "/products/fuzeagent");
  });
});
