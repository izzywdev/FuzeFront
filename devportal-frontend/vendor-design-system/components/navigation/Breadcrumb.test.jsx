import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Breadcrumb } from "./Breadcrumb.jsx";

describe("<Breadcrumb>", () => {
  it("renders a nav with an accessible name and one step per item", () => {
    render(
      <Breadcrumb
        items={[
          { key: "orgs", label: "Organizations", href: "/organizations" },
          { key: "acme", label: "Acme Corp", current: true },
        ]}
      />
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organizations" })).toHaveAttribute("href", "/organizations");
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("marks exactly the current step with aria-current", () => {
    render(
      <Breadcrumb
        items={[
          { key: "platform", kind: "platform", label: "FuzeFront" },
          { key: "org", kind: "org", label: "Acme Corp", current: true },
        ]}
      />
    );
    const current = screen.getByText("Acme Corp").closest("[data-breadcrumb-step]");
    expect(current).toHaveAttribute("aria-current", "true");
    const notCurrent = screen.getByText("FuzeFront").closest("[data-breadcrumb-step]");
    expect(notCurrent).not.toHaveAttribute("aria-current");
  });

  it("renders a non-interactive step (no href/onClick) as plain text, not a link or button", () => {
    render(<Breadcrumb items={[{ key: "user", kind: "user", label: "You" }]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("calls onClick for a button step", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Breadcrumb items={[{ key: "org", label: "Acme Corp", onClick }]} />);
    await user.click(screen.getByRole("button", { name: "Acme Corp" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the kind label alongside the step label", () => {
    render(<Breadcrumb items={[{ key: "org", kind: "org", label: "Acme Corp", current: true }]} />);
    expect(screen.getByText("org")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });
});
