import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandTokenScope, resolveBrandAccent } from "./BrandTokenScope.jsx";

describe("resolveBrandAccent", () => {
  it("applies a valid, AA-passing hex accent (CorpABC blue)", () => {
    const result = resolveBrandAccent("#2f6df6");
    expect(result.applied).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.accentColor).toBe("#2f6df6");
    expect(result.accentSoft).toMatch(/^rgba\(/);
  });

  it("applies a valid rgb() accent", () => {
    const result = resolveBrandAccent("rgb(22, 36, 74)");
    expect(result.applied).toBe(true);
  });

  it("applies a valid hsl() accent", () => {
    // Same CorpABC blue expressed as hsl().
    const result = resolveBrandAccent("hsl(219, 90%, 54%)");
    expect(result.applied).toBe(true);
  });

  it("rejects a malformed color string (fail-closed)", () => {
    const result = resolveBrandAccent("not-a-color");
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("rejects an out-of-range rgb() value", () => {
    const result = resolveBrandAccent("rgb(300, 0, 0)");
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("rejects a script-injection-shaped string", () => {
    const result = resolveBrandAccent("javascript:alert(1)");
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("rejects a syntactically valid color that fails WCAG AA contrast", () => {
    // Near-white pastel — parses fine, but unreadable as on-accent text.
    const result = resolveBrandAccent("#f5f5f5");
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("contrast");
    expect(result.ratio).toBeLessThan(4.5);
  });

  it("treats an absent accent as 'none', not a rejection", () => {
    expect(resolveBrandAccent(undefined)).toEqual({ applied: false, reason: "none" });
    expect(resolveBrandAccent(null)).toEqual({ applied: false, reason: "none" });
    expect(resolveBrandAccent("")).toEqual({ applied: false, reason: "none" });
  });
});

describe("<BrandTokenScope>", () => {
  it("renders children", () => {
    render(
      <BrandTokenScope accent="#2f6df6">
        <span>Portal content</span>
      </BrandTokenScope>
    );
    expect(screen.getByText("Portal content")).toBeInTheDocument();
  });

  it("applies scoped --accent-* overrides for a valid, AA-passing accent", () => {
    render(
      <BrandTokenScope accent="#2f6df6" data-testid="scope">
        <span>x</span>
      </BrandTokenScope>
    );
    const scope = screen.getByTestId("scope");
    expect(scope).toHaveAttribute("data-brand-accent-status", "applied");
    expect(scope).not.toHaveAttribute("data-brand-fallback-reason");
    expect(scope.style.getPropertyValue("--accent-color")).toBe("#2f6df6");
    expect(scope.style.getPropertyValue("--accent-soft")).toMatch(/^rgba\(/);
  });

  it("falls back to base tokens (no override) on a malformed accent", () => {
    render(
      <BrandTokenScope accent="not-a-color" data-testid="scope">
        <span>x</span>
      </BrandTokenScope>
    );
    const scope = screen.getByTestId("scope");
    expect(scope).toHaveAttribute("data-brand-accent-status", "fallback");
    expect(scope).toHaveAttribute("data-brand-fallback-reason", "invalid");
    expect(scope.style.getPropertyValue("--accent-color")).toBe("");
  });

  it("falls back to base tokens on a contrast-failing accent", () => {
    render(
      <BrandTokenScope accent="#fef9c3" data-testid="scope">
        <span>x</span>
      </BrandTokenScope>
    );
    const scope = screen.getByTestId("scope");
    expect(scope).toHaveAttribute("data-brand-accent-status", "fallback");
    expect(scope).toHaveAttribute("data-brand-fallback-reason", "contrast");
    expect(scope.style.getPropertyValue("--accent-color")).toBe("");
  });

  it("calls onAccentRejected with the reason for a rejected accent", () => {
    const onAccentRejected = vi.fn();
    render(
      <BrandTokenScope accent="not-a-color" onAccentRejected={onAccentRejected}>
        <span>x</span>
      </BrandTokenScope>
    );
    expect(onAccentRejected).toHaveBeenCalledWith(
      expect.objectContaining({ accent: "not-a-color", reason: "invalid" })
    );
  });

  it("does not call onAccentRejected when no accent is provided", () => {
    const onAccentRejected = vi.fn();
    render(
      <BrandTokenScope onAccentRejected={onAccentRejected}>
        <span>x</span>
      </BrandTokenScope>
    );
    expect(onAccentRejected).not.toHaveBeenCalled();
  });

  it("renders with no override when no accent is given (inherits base tokens)", () => {
    render(
      <BrandTokenScope data-testid="scope">
        <span>x</span>
      </BrandTokenScope>
    );
    const scope = screen.getByTestId("scope");
    expect(scope).toHaveAttribute("data-brand-accent-status", "fallback");
    expect(scope.style.getPropertyValue("--accent-color")).toBe("");
  });

  it("passes through a valid secondary accent2", () => {
    render(
      <BrandTokenScope accent="#2f6df6" accent2="#17b0a0" data-testid="scope">
        <span>x</span>
      </BrandTokenScope>
    );
    expect(screen.getByTestId("scope").style.getPropertyValue("--accent-2")).toBe("#17b0a0");
  });

  it("ignores a malformed secondary accent2 (no crash, no override)", () => {
    render(
      <BrandTokenScope accent="#2f6df6" accent2="not-a-color" data-testid="scope">
        <span>x</span>
      </BrandTokenScope>
    );
    expect(screen.getByTestId("scope").style.getPropertyValue("--accent-2")).toBe("");
  });

  it("honors the `as` prop", () => {
    render(
      <BrandTokenScope accent="#2f6df6" as="main" data-testid="scope">
        <span>x</span>
      </BrandTokenScope>
    );
    expect(screen.getByTestId("scope").tagName).toBe("MAIN");
  });
});
