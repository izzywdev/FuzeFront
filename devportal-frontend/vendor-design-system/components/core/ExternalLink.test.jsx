import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExternalLink } from "./ExternalLink.jsx";

describe("<ExternalLink>", () => {
  it("renders a real anchor with target=_blank and rel=noopener noreferrer", () => {
    render(<ExternalLink href="https://portal.northwind.example/">Open portal</ExternalLink>);
    const link = screen.getByRole("link", { name: /open portal/i });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://portal.northwind.example/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("target/rel cannot be overridden by caller props (the safety contract)", () => {
    render(
      <ExternalLink
        href="https://portal.example/"
        target="_self"
        rel="nothing"
      >
        Open portal
      </ExternalLink>
    );
    const link = screen.getByRole("link", { name: /open portal/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("defaults to the link variant (no button chrome)", () => {
    render(<ExternalLink href="https://example.com/">Docs</ExternalLink>);
    const link = screen.getByRole("link", { name: /docs/i });
    expect(link.style.background).toBe("transparent");
  });

  it("variant=button renders the filled accent CTA", () => {
    render(
      <ExternalLink href="https://example.com/" variant="button">
        Open portal
      </ExternalLink>
    );
    const link = screen.getByRole("link", { name: /open portal/i });
    expect(link.style.background).toBe("var(--accent-color)");
  });

  it("forwards data-* test hooks", () => {
    render(
      <ExternalLink href="https://example.com/" data-action="open-portal" data-portal-target="prt_northwind">
        Open portal
      </ExternalLink>
    );
    const link = screen.getByRole("link", { name: /open portal/i });
    expect(link).toHaveAttribute("data-action", "open-portal");
    expect(link).toHaveAttribute("data-portal-target", "prt_northwind");
  });
});
