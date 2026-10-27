import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordChecklist, passwordMeetsPolicy } from "./PasswordChecklist.jsx";

describe("<PasswordChecklist>", () => {
  it("marks each rule met/unmet and exposes data-req / data-met hooks", () => {
    const { container } = render(<PasswordChecklist value="abc" title="" />);
    const row = (id) => container.querySelector(`[data-req="${id}"]`);
    expect(row("lower")).toHaveAttribute("data-met", "true");
    expect(row("length")).toHaveAttribute("data-met", "false");
    expect(row("upper")).toHaveAttribute("data-met", "false");
    expect(container.querySelector("[data-pwreq]")).not.toBeNull();
  });

  it("flips every rule to met for a policy-passing password", () => {
    const { container } = render(<PasswordChecklist value="Corr3ct-Horse!Batt" title="" />);
    const met = container.querySelectorAll('[data-met="true"]');
    expect(met.length).toBe(5);
    expect(passwordMeetsPolicy("Corr3ct-Horse!Batt")).toBe(true);
    expect(passwordMeetsPolicy("short")).toBe(false);
  });

  it("announces met/unmet with localizable visually-hidden suffixes", () => {
    render(<PasswordChecklist value="a" title="" metLabel=" — تم" unmetLabel=" — لم يتم" />);
    expect(screen.getAllByText("— تم").length).toBe(1);
    expect(screen.getAllByText("— لم يتم").length).toBe(4);
  });

  it("accepts custom rules (e.g. from an authoritative policy) with their own labels", () => {
    const rules = [{ id: "len8", label: "8+", test: (v) => v.length >= 8 }];
    const { container } = render(<PasswordChecklist value="12345678" rules={rules} title="" columns={2} />);
    expect(container.querySelector('[data-req="len8"]')).toHaveAttribute("data-met", "true");
    expect(container.querySelector("[data-pwreq]").style.gridTemplateColumns).toBe("repeat(2, 1fr)");
  });

  it("highlightUnmet tints only the still-unmet rules with the error colour", () => {
    const { container } = render(<PasswordChecklist value="abc" title="" highlightUnmet />);
    expect(container.querySelector('[data-req="length"]').style.color).toBe("var(--error-color)");
    expect(container.querySelector('[data-req="lower"]').style.color).toBe("var(--success-color)");
    const { container: c2 } = render(<PasswordChecklist value="abc" title="" />);
    expect(c2.querySelector('[data-req="length"]').style.color).toBe("var(--text-tertiary)");
  });

  it("is a polite live region", () => {
    const { container } = render(<PasswordChecklist value="" />);
    expect(container.firstChild).toHaveAttribute("aria-live", "polite");
  });
});
