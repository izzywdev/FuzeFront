import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineLink } from "./InlineLink.jsx";

describe("<InlineLink>", () => {
  it("renders a real anchor with the accent color and no underline by default", () => {
    render(<InlineLink href="mailto:privacy@fuzefront.com">privacy@fuzefront.com</InlineLink>);
    const link = screen.getByRole("link", { name: /privacy@fuzefront.com/i });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "mailto:privacy@fuzefront.com");
    expect(link.style.color).toBe("var(--accent-color)");
    expect(link.style.textDecoration).toBe("none");
  });

  it("does not force target=_blank or rel (not an external-navigation link)", () => {
    render(<InlineLink href="mailto:hr@fuzefront.com">hr@fuzefront.com</InlineLink>);
    const link = screen.getByRole("link", { name: /hr@fuzefront.com/i });
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });

  it("underlines on hover and removes it on mouse leave", () => {
    render(<InlineLink href="mailto:legal@fuzefront.com">legal@fuzefront.com</InlineLink>);
    const link = screen.getByRole("link", { name: /legal@fuzefront.com/i });
    fireEvent.mouseEnter(link);
    expect(link.style.textDecoration).toBe("underline");
    fireEvent.mouseLeave(link);
    expect(link.style.textDecoration).toBe("none");
  });

  it("underlines on keyboard focus (not just hover) and shows an outline", () => {
    render(<InlineLink href="mailto:legal@fuzefront.com">legal@fuzefront.com</InlineLink>);
    const link = screen.getByRole("link", { name: /legal@fuzefront.com/i });
    link.focus();
    expect(link.style.textDecoration).toBe("underline");
    expect(link.style.outline).toContain("var(--accent-color)");
    link.blur();
    expect(link.style.textDecoration).toBe("none");
    expect(link.style.outline).toBe("none");
  });

  it("defaults to regular weight, and emphasis=true bolds the text", () => {
    const { rerender } = render(<InlineLink href="mailto:a@b.com">a@b.com</InlineLink>);
    expect(screen.getByRole("link").style.fontWeight).toBe("inherit");

    rerender(
      <InlineLink href="mailto:a@b.com" emphasis>
        a@b.com
      </InlineLink>
    );
    expect(screen.getByRole("link").style.fontWeight).toBe("var(--weight-medium)");
  });

  it("forwards arbitrary anchor props", () => {
    render(
      <InlineLink href="mailto:a@b.com" data-testid="contact-link">
        a@b.com
      </InlineLink>
    );
    expect(screen.getByTestId("contact-link")).toBeInTheDocument();
  });
});
