import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Section } from "./Section.jsx";

describe("<Section>", () => {
  it("renders children inside a <section> by default", () => {
    render(<Section>content</Section>);
    const el = screen.getByText("content");
    expect(el.tagName).toBe("SECTION");
  });

  it("defaults to padding=lg (--space-24) and tone=surface (--bg-tertiary)", () => {
    render(<Section data-testid="s">content</Section>);
    const el = screen.getByTestId("s");
    expect(el.style.paddingBlock).toBe("var(--space-24)");
    expect(el.style.background).toBe("var(--bg-tertiary)");
  });

  it.each([
    ["sm", "var(--space-16)"],
    ["md", "var(--space-20)"],
    ["lg", "var(--space-24)"],
  ])("padding=%s maps to the %s spacing token", (padding, token) => {
    render(
      <Section padding={padding} data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").style.paddingBlock).toBe(token);
  });

  it.each([
    ["surface", "var(--bg-tertiary)"],
    ["muted", "var(--bg-primary)"],
  ])("tone=%s maps to the %s surface token", (tone, token) => {
    render(
      <Section tone={tone} data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").style.background).toBe(token);
  });

  it("tone=transparent sets no background", () => {
    render(
      <Section tone="transparent" data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").style.background).toBe("");
  });

  it("divider defaults to off (no top border)", () => {
    render(<Section data-testid="s">content</Section>);
    expect(screen.getByTestId("s").style.borderBlockStart).toBe("");
  });

  it("divider=true adds a top border using the border-color token, via the logical property (mirrors under RTL)", () => {
    render(
      <Section divider data-testid="s">
        content
      </Section>
    );
    const el = screen.getByTestId("s");
    expect(el.style.borderBlockStart).toBe("var(--border-width) solid var(--border-color)");
    expect(el.style.borderTop).toBe("");
  });

  it("renders as a different element via `as`", () => {
    render(
      <Section as="div" data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").tagName).toBe("DIV");
  });

  it("forwards className alongside the computed style", () => {
    render(
      <Section className="relative" data-testid="s">
        content
      </Section>
    );
    expect(screen.getByTestId("s").className).toBe("relative");
  });

  it("merges a caller-supplied style without dropping the computed padding/tone", () => {
    render(
      <Section style={{ marginTop: "var(--space-4)" }} data-testid="s">
        content
      </Section>
    );
    const el = screen.getByTestId("s");
    expect(el.style.marginTop).toBe("var(--space-4)");
    expect(el.style.paddingBlock).toBe("var(--space-24)");
  });

  it("forwards data-* and aria-* attributes (test hooks, a11y)", () => {
    render(
      <Section data-testid="s" aria-label="Leadership">
        content
      </Section>
    );
    expect(screen.getByTestId("s")).toHaveAttribute("aria-label", "Leadership");
  });
});
