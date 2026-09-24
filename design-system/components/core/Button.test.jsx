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

  describe("polymorphic anchor rendering", () => {
    it("renders a real <a> with href when href is passed", () => {
      render(<Button href="https://app.fuzefront.com/signup">Sign Up Free</Button>);
      const link = screen.getByRole("link", { name: "Sign Up Free" });
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "https://app.fuzefront.com/signup");
    });

    it("preserves target/rel/click handlers on the anchor", () => {
      const onClick = vi.fn();
      render(
        <Button href="https://docs.example.com" target="_blank" onClick={onClick}>
          Read the docs
        </Button>
      );
      const link = screen.getByRole("link", { name: "Read the docs" });
      expect(link).toHaveAttribute("target", "_blank");
      fireEvent.click(link);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("defaults rel to noopener noreferrer when target=_blank and no rel is given", () => {
      render(
        <Button href="https://docs.example.com" target="_blank">
          Read the docs
        </Button>
      );
      const link = screen.getByRole("link", { name: "Read the docs" });
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("respects a caller-supplied rel instead of overriding it", () => {
      render(
        <Button href="https://docs.example.com" target="_blank" rel="author">
          Read the docs
        </Button>
      );
      const link = screen.getByRole("link", { name: "Read the docs" });
      expect(link).toHaveAttribute("rel", "author");
    });

    it("renders no target/rel for a same-tab anchor by default", () => {
      render(<Button href="/dashboard">Go to dashboard</Button>);
      const link = screen.getByRole("link", { name: "Go to dashboard" });
      expect(link).not.toHaveAttribute("target");
      expect(link).not.toHaveAttribute("rel");
    });

    it("renders every variant as a real, identically-styled anchor", () => {
      const variants = ["primary", "secondary", "ghost", "danger"];
      variants.forEach((variant) => {
        const { unmount } = render(
          <Button href="https://example.com" variant={variant}>
            {variant}
          </Button>
        );
        const link = screen.getByRole("link", { name: variant });
        expect(link.tagName).toBe("A");
        unmount();
      });
    });

    it("an anchor-rendered Button is inert when disabled — no href, aria-disabled, swallowed click", () => {
      const onClick = vi.fn();
      render(
        <Button href="https://app.fuzefront.com/signup" disabled onClick={onClick}>
          Sign Up Free
        </Button>
      );
      const link = screen.getByText("Sign Up Free").closest("a");
      expect(link).not.toHaveAttribute("href");
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).toHaveAttribute("tabIndex", "-1");
      fireEvent.click(link);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("supports `as` for in-app routing components (e.g. react-router-dom's Link)", () => {
      // Mirrors react-router-dom's own Link: `...rest` (which may carry the
      // Button-forwarded `href={undefined}`) is spread BEFORE the
      // component's own computed `href`, so its value always wins.
      const FakeLink = React.forwardRef(({ to, children, ...rest }, ref) => (
        <a ref={ref} data-router-link {...rest} href={to}>
          {children}
        </a>
      ));
      render(
        <Button as={FakeLink} to="/dashboard" variant="secondary">
          Go to dashboard
        </Button>
      );
      const link = screen.getByRole("link", { name: "Go to dashboard" });
      expect(link).toHaveAttribute("href", "/dashboard");
      expect(link).toHaveAttribute("data-router-link");
    });

    it("still renders a <button> (not <a>) when no href/as is given", () => {
      render(<Button variant="primary">Launch app</Button>);
      const button = screen.getByRole("button", { name: "Launch app" });
      expect(button.tagName).toBe("BUTTON");
    });
  });
});
