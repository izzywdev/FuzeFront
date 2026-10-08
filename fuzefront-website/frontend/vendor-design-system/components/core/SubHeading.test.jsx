import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubHeading } from "./SubHeading.jsx";

describe("<SubHeading>", () => {
  it("renders its children as an <h3> by default", () => {
    render(<SubHeading>2.1 Information You Provide</SubHeading>);
    const node = screen.getByText("2.1 Information You Provide");
    expect(node.tagName).toBe("H3");
  });

  it("renders as the element named by `as`", () => {
    render(<SubHeading as="h4">Inline subheading</SubHeading>);
    expect(screen.getByText("Inline subheading").tagName).toBe("H4");
  });

  it("always sizes text at the DS --text-base token", () => {
    render(<SubHeading>4.1 Subscription Fees</SubHeading>);
    expect(screen.getByText("4.1 Subscription Fees").style.fontSize).toBe(
      "var(--text-base)"
    );
  });

  it("always weights text at the DS --weight-semibold token", () => {
    render(<SubHeading>4.1 Subscription Fees</SubHeading>);
    expect(screen.getByText("4.1 Subscription Fees").style.fontWeight).toBe(
      "var(--weight-semibold)"
    );
  });

  it("defaults to the primary tone token", () => {
    render(<SubHeading>{"{heading}"}</SubHeading>);
    expect(screen.getByText("{heading}").style.color).toBe(
      "var(--text-primary)"
    );
  });

  it("resolves every tone to its DS token — never a raw gray shade", () => {
    const cases = [
      ["primary", "var(--text-primary)"],
      ["secondary", "var(--text-secondary)"],
      ["muted", "var(--text-tertiary)"],
      ["danger", "var(--error-color)"],
    ];
    cases.forEach(([tone, expected]) => {
      const { unmount } = render(<SubHeading tone={tone}>{tone}</SubHeading>);
      expect(screen.getByText(tone).style.color).toBe(expected);
      unmount();
    });
  });

  it("defaults to no top margin", () => {
    render(<SubHeading>Default top</SubHeading>);
    expect(screen.getByText("Default top").style.marginBlockStart).toBe("0");
  });

  it("resolves every `space` value to its DS spacing token", () => {
    const cases = [
      ["none", "0"],
      ["md", "var(--space-4)"],
      ["lg", "var(--space-5)"],
    ];
    cases.forEach(([space, expected]) => {
      const { unmount } = render(
        <SubHeading space={space}>{space}</SubHeading>
      );
      expect(screen.getByText(space).style.marginBlockStart).toBe(expected);
      unmount();
    });
  });

  it("defaults to the sm spacing token for the bottom margin", () => {
    render(<SubHeading>Default bottom</SubHeading>);
    expect(screen.getByText("Default bottom").style.marginBlockEnd).toBe(
      "var(--space-2)"
    );
  });

  it("resolves every `spacing` value to its DS spacing token", () => {
    const cases = [
      ["none", "0"],
      ["sm", "var(--space-2)"],
    ];
    cases.forEach(([spacing, expected]) => {
      const { unmount } = render(
        <SubHeading spacing={spacing}>{spacing}</SubHeading>
      );
      expect(screen.getByText(spacing).style.marginBlockEnd).toBe(expected);
      unmount();
    });
  });

  it("falls back to the sm bottom-spacing token for an unknown `spacing` value", () => {
    render(<SubHeading spacing="not-a-real-space">Fallback</SubHeading>);
    expect(screen.getByText("Fallback").style.marginBlockEnd).toBe(
      "var(--space-2)"
    );
  });

  it("passes through arbitrary attributes (a11y labelling / test hooks)", () => {
    render(
      <SubHeading data-testid="legal-subheading" id="gdpr-rights">
        6.1 GDPR Rights (EEA Residents)
      </SubHeading>
    );
    const node = screen.getByTestId("legal-subheading");
    expect(node).toHaveAttribute("id", "gdpr-rights");
    expect(node).toHaveTextContent("6.1 GDPR Rights (EEA Residents)");
  });

  it("caller style overrides the base style", () => {
    render(
      <SubHeading tone="muted" style={{ fontStyle: "italic" }}>
        Overridden
      </SubHeading>
    );
    const node = screen.getByText("Overridden");
    expect(node.style.fontStyle).toBe("italic");
    expect(node.style.color).toBe("var(--text-tertiary)");
  });
});
