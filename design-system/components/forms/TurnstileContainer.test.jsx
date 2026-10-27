import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TurnstileContainer } from "./TurnstileContainer.jsx";

describe("<TurnstileContainer>", () => {
  it("loading: spinner + loading copy, state hooks on root and box", () => {
    const { container } = render(<TurnstileContainer state="loading" data-turnstile />);
    expect(container.firstChild).toHaveAttribute("data-state", "loading");
    expect(container.firstChild).toHaveAttribute("data-turnstile");
    expect(screen.getAllByText("Loading challenge…").length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-state="loading"]').length).toBe(2);
  });

  it("verified: shows the verified copy, no alert", () => {
    render(<TurnstileContainer state="verified" />);
    expect(screen.getByText("Verified — you're human")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("failed: shows the failure + an alert with the retry message", () => {
    render(<TurnstileContainer state="failed" />);
    expect(screen.getByText("Verification failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please complete the challenge to continue.");
  });

  it("ready: prompts the user to complete the challenge", () => {
    render(<TurnstileContainer state="ready" />);
    expect(screen.getByText("Complete the challenge")).toBeInTheDocument();
  });

  it("keeps the widget slot mounted in every state", () => {
    const { rerender } = render(
      <TurnstileContainer state="loading"><div data-testid="widget" /></TurnstileContainer>,
    );
    const el = screen.getByTestId("widget");
    for (const state of ["ready", "verified", "failed"]) {
      rerender(<TurnstileContainer state={state}><div data-testid="widget" /></TurnstileContainer>);
      expect(screen.getByTestId("widget")).toBe(el);
    }
  });

  it("localizes every string via labels and keeps the vendor brand label", () => {
    render(
      <TurnstileContainer
        state="failed"
        labels={{ failed: "فشل التحقق", error: "أكمل التحدي", brand: "Cloudflare Turnstile" }}
      />,
    );
    expect(screen.getByText("فشل التحقق")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("أكمل التحدي");
    expect(screen.getByText("Cloudflare Turnstile")).toBeInTheDocument();
  });
});
