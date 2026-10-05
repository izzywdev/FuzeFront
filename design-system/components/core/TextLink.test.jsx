import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextLink } from "./TextLink.jsx";

describe("<TextLink>", () => {
  it("renders a plain anchor by default", () => {
    render(<TextLink href="/privacy">Privacy Policy</TextLink>);
    const link = screen.getByRole("link", { name: /privacy policy/i });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/privacy");
  });

  it("uses the DS accent token for color, and the hover token on hover", () => {
    render(<TextLink href="/cookies">Cookie Policy</TextLink>);
    const link = screen.getByRole("link", { name: /cookie policy/i });
    expect(link.style.color).toBe("var(--accent-color)");
    fireEvent.mouseEnter(link);
    expect(link.style.color).toBe("var(--accent-hover)");
    fireEvent.mouseLeave(link);
    expect(link.style.color).toBe("var(--accent-color)");
  });

  it("swaps to the hover token on keyboard focus too (not hover-only)", () => {
    render(<TextLink href="/cookies">Cookie Policy</TextLink>);
    const link = screen.getByRole("link", { name: /cookie policy/i });
    fireEvent.focus(link);
    expect(link.style.color).toBe("var(--accent-hover)");
    fireEvent.blur(link);
    expect(link.style.color).toBe("var(--accent-color)");
  });

  it("is polymorphic via `as` — renders a button for a text-styled inline action", () => {
    render(
      <TextLink as="button" type="button">
        Retry
      </TextLink>
    );
    const btn = screen.getByRole("button", { name: /retry/i });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("forwards target/rel/aria-label/data-* without altering them (no forced navigation contract)", () => {
    render(
      <TextLink
        href="https://linkedin.com/in/jane"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Jane Doe on LinkedIn"
        data-action="social-link"
      >
        LI
      </TextLink>
    );
    const link = screen.getByRole("link", { name: /jane doe on linkedin/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-action", "social-link");
  });

  it("merges a caller className for layout (color stays token-driven, not class-driven)", () => {
    render(
      <TextLink href="/x" className="inline-flex items-center gap-2 text-sm font-medium">
        Learn more
      </TextLink>
    );
    const link = screen.getByRole("link", { name: /learn more/i });
    expect(link).toHaveClass("inline-flex", "items-center", "gap-2", "text-sm", "font-medium");
    expect(link.style.color).toBe("var(--accent-color)");
  });

  it("a caller style prop can override the default color (explicit opt-out escape hatch)", () => {
    render(
      <TextLink href="/x" style={{ color: "var(--error-color)" }}>
        Danger link
      </TextLink>
    );
    const link = screen.getByRole("link", { name: /danger link/i });
    expect(link.style.color).toBe("var(--error-color)");
  });
});
