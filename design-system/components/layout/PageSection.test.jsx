import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageSection } from "./PageSection.jsx";

describe("<PageSection>", () => {
  it("renders children inside a section by default", () => {
    render(<PageSection>content</PageSection>);
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders a <section> element by default", () => {
    render(<PageSection data-testid="s">content</PageSection>);
    expect(screen.getByTestId("s").tagName).toBe("SECTION");
  });

  it("defaults to lg spacing (--space-24) and white background (var(--paper))", () => {
    render(<PageSection data-testid="s">content</PageSection>);
    const el = screen.getByTestId("s");
    expect(el.style.paddingBlock).toBe("var(--space-24)");
    expect(el.style.backgroundColor).toBe("var(--paper)");
  });

  it("maps spacing=sm to --space-16", () => {
    render(
      <PageSection spacing="sm" data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").style.paddingBlock).toBe("var(--space-16)");
  });

  it("maps spacing=md to --space-20", () => {
    render(
      <PageSection spacing="md" data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").style.paddingBlock).toBe("var(--space-20)");
  });

  it("falls back to lg for an unknown spacing", () => {
    render(
      <PageSection spacing="xl" data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").style.paddingBlock).toBe("var(--space-24)");
  });

  it("maps background=muted to var(--paper-tint)", () => {
    render(
      <PageSection background="muted" data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").style.backgroundColor).toBe("var(--paper-tint)");
  });

  it("maps background=transparent to transparent", () => {
    render(
      <PageSection background="transparent" data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").style.backgroundColor).toBe("transparent");
  });

  it("uses the logical paddingBlock property, not physical padding-top/bottom — mirrors under RTL", () => {
    render(<PageSection data-testid="s">content</PageSection>);
    const el = screen.getByTestId("s");
    expect(el.style.paddingTop).toBe("");
    expect(el.style.paddingBottom).toBe("");
    expect(el.style.paddingBlock).toBe("var(--space-24)");
  });

  it("renders as a different element via `as`", () => {
    render(
      <PageSection as="div" data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").tagName).toBe("DIV");
  });

  it("forwards a caller className", () => {
    render(
      <PageSection className="relative overflow-hidden" data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").className).toBe("relative overflow-hidden");
  });

  it("merges caller style without dropping the computed padding/background", () => {
    render(
      <PageSection style={{ position: "relative" }} data-testid="s">
        content
      </PageSection>
    );
    const el = screen.getByTestId("s");
    expect(el.style.position).toBe("relative");
    expect(el.style.paddingBlock).toBe("var(--space-24)");
  });

  it("a caller style can override the computed background", () => {
    render(
      <PageSection style={{ backgroundColor: "var(--bg-secondary)" }} data-testid="s">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s").style.backgroundColor).toBe("var(--bg-secondary)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(
      <PageSection data-testid="s" aria-label="section">
        content
      </PageSection>
    );
    expect(screen.getByTestId("s")).toHaveAttribute("aria-label", "section");
  });
});
