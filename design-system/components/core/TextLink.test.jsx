import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextLink } from "./TextLink.jsx";

describe("<TextLink>", () => {
  it("renders a real anchor by default, no target/rel forced", () => {
    render(<TextLink href="/contact">Contact Us</TextLink>);
    const link = screen.getByRole("link", { name: /contact us/i });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/contact");
    expect(link).not.toHaveAttribute("target");
  });

  it("uses the DS accent token for color, not a raw Tailwind shade", () => {
    render(<TextLink href="/contact">Contact Us</TextLink>);
    const link = screen.getByRole("link", { name: /contact us/i });
    expect(link.style.color).toBe("var(--accent-color)");
    expect(link.className).toBe("");
  });

  it("darkens to --accent-hover on hover and reverts on leave", () => {
    render(<TextLink href="/contact">Contact Us</TextLink>);
    const link = screen.getByRole("link", { name: /contact us/i });
    fireEvent.mouseEnter(link);
    expect(link.style.color).toBe("var(--accent-hover)");
    fireEvent.mouseLeave(link);
    expect(link.style.color).toBe("var(--accent-color)");
  });

  it("darkens to --accent-hover on focus and reverts on blur", () => {
    render(<TextLink href="/contact">Contact Us</TextLink>);
    const link = screen.getByRole("link", { name: /contact us/i });
    fireEvent.focus(link);
    expect(link.style.color).toBe("var(--accent-hover)");
    expect(link.style.outline).toBe("2px solid var(--accent-color)");
    fireEvent.blur(link);
    expect(link.style.color).toBe("var(--accent-color)");
    expect(link.style.outline).toBe("none");
  });

  it("is polymorphic via `as`, e.g. a router Link", () => {
    const RouterLinkStub = React.forwardRef(({ to, children, ...rest }, ref) => (
      <a ref={ref} href={to} data-router-link="true" {...rest}>
        {children}
      </a>
    ));
    render(
      <TextLink as={RouterLinkStub} to="/terms">
        Terms of Service
      </TextLink>
    );
    const link = screen.getByRole("link", { name: /terms of service/i });
    expect(link).toHaveAttribute("href", "/terms");
    expect(link).toHaveAttribute("data-router-link", "true");
  });

  it("forwards caller onMouseEnter/onFocus without breaking the DS hover/focus behavior", () => {
    let entered = false;
    let focused = false;
    render(
      <TextLink
        href="/contact"
        onMouseEnter={() => {
          entered = true;
        }}
        onFocus={() => {
          focused = true;
        }}
      >
        Contact Us
      </TextLink>
    );
    const link = screen.getByRole("link", { name: /contact us/i });
    fireEvent.mouseEnter(link);
    fireEvent.focus(link);
    expect(entered).toBe(true);
    expect(focused).toBe(true);
    expect(link.style.color).toBe("var(--accent-hover)");
  });
});
