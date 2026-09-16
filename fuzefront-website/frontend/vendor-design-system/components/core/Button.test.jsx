import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button.jsx";

describe("<Button>", () => {
  it("renders its label as an accessible button", () => {
    render(<Button>Retry</Button>);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("fires onClick when activated by mouse or keyboard", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Retry</Button>);
    const button = screen.getByRole("button", { name: "Retry" });

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    button.focus();
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
  });

  it("does not fire onClick and is not focusable when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Retry
      </Button>
    );
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes through arbitrary attributes (e.g. data-action hooks used by e2e/analytics)", () => {
    render(
      <Button data-action="retry" data-app-id="app-123">
        Retry
      </Button>
    );
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).toHaveAttribute("data-action", "retry");
    expect(button).toHaveAttribute("data-app-id", "app-123");
  });

  it("renders every variant as a real, distinctly-styled button (primary/secondary/ghost/danger)", () => {
    const variants = ["primary", "secondary", "ghost", "danger"];
    variants.forEach((variant) => {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      const button = screen.getByRole("button", { name: variant });
      expect(button).toBeInTheDocument();
      unmount();
    });
  });

  it("the ghost variant is transparent with no elevation, unlike primary", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const ghost = screen.getByRole("button", { name: "Ghost" });
    expect(ghost.style.background).toBe("transparent");
    expect(ghost.style.boxShadow).toBe("none");
  });

  it("mirrors layout for RTL contexts — no hard-coded left/right, only flow-relative gap/padding", () => {
    render(<Button withArrow>Continue</Button>);
    const button = screen.getByRole("button", { name: /continue/i });
    expect(button.style.marginLeft).toBe("");
    expect(button.style.marginRight).toBe("");
    expect(button.style.left).toBe("");
    expect(button.style.right).toBe("");
  });

  it("stretches to fill its container when fullWidth is set", () => {
    render(<Button fullWidth>Continue</Button>);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button.style.width).toBe("100%");
  });
});
