import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill.jsx";

describe("<StatusPill>", () => {
  it("renders with role=status and a default label from the status key", () => {
    render(<StatusPill status="active" />);
    expect(screen.getByRole("status", { name: "Active" })).toBeInTheDocument();
  });

  it("supports an explicit label override", () => {
    render(<StatusPill status="degraded" label="High latency" />);
    expect(screen.getByRole("status", { name: "High latency" })).toBeInTheDocument();
  });

  it.each([
    ["online", "success"],
    ["active", "success"],
    ["verified", "success"],
    ["enabled", "success"],
    ["degraded", "warning"],
    ["pending", "warning"],
    ["in-progress", "warning"],
    ["invited", "warning"],
    ["offline", "error"],
    ["suspended", "error"],
    ["restricted", "error"],
    ["expired", "error"],
    ["disabled", "neutral"],
    ["not-started", "neutral"],
  ])("status=%s exposes data-status and a non-empty accessible name", (status) => {
    render(<StatusPill status={status} />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveAttribute("data-status", status);
    expect(pill.getAttribute("aria-label")).toBeTruthy();
  });

  it("falls back to the online default for an unknown status", () => {
    render(<StatusPill status="not-a-real-status" />);
    expect(screen.getByRole("status", { name: "Online" })).toBeInTheDocument();
  });

  it("keeps back-compat with the original online/degraded/offline service-health API", () => {
    render(<StatusPill status="offline" label="remoteEntry 404" />);
    expect(screen.getByRole("status", { name: "remoteEntry 404" })).toHaveAttribute("data-status", "offline");
  });
});
