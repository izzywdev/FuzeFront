import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubsectionHeading } from "./SubsectionHeading.jsx";

describe("<SubsectionHeading>", () => {
  it("renders its children as an <h3> by default", () => {
    render(<SubsectionHeading>2.1 Information You Provide</SubsectionHeading>);
    const node = screen.getByText("2.1 Information You Provide");
    expect(node.tagName).toBe("H3");
  });

  it("renders as the element named by `as`", () => {
    render(<SubsectionHeading as="h4">Inline subheading</SubsectionHeading>);
    expect(screen.getByText("Inline subheading").tagName).toBe("H4");
  });

  it("always sizes text at the DS --text-base token", () => {
    render(<SubsectionHeading>4.1 Subscription Fees</SubsectionHeading>);
    expect(screen.getByText("4.1 Subscription Fees").style.fontSize).toBe(
      "var(--text-base)"
    );
  });

  it("always weights text at the DS --weight-semibold token", () => {
    render(<SubsectionHeading>4.1 Subscription Fees</SubsectionHeading>);
    expect(screen.getByText("4.1 Subscription Fees").style.fontWeight).toBe(
      "var(--weight-semibold)"
    );
  });

  it("defaults to the primary tone token", () => {
    render(<SubsectionHeading>{"{heading}"}</SubsectionHeading>);
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
      const { unmount } = render(<SubsectionHeading tone={tone}>{tone}</SubsectionHeading>);
      expect(screen.getByText(tone).style.color).toBe(expected);
      unmount();
    });
  });

  it("defaults to no top margin", () => {
    render(<SubsectionHeading>Default top</SubsectionHeading>);
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
        <SubsectionHeading space={space}>{space}</SubsectionHeading>
      );
      expect(screen.getByText(space).style.marginBlockStart).toBe(expected);
      unmount();
    });
  });

  it("defaults to the sm spacing token for the bottom margin", () => {
    render(<SubsectionHeading>Default bottom</SubsectionHeading>);
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
        <SubsectionHeading spacing={spacing}>{spacing}</SubsectionHeading>
      );
      expect(screen.getByText(spacing).style.marginBlockEnd).toBe(expected);
      unmount();
    });
  });

  it("falls back to the sm bottom-spacing token for an unknown `spacing` value", () => {
    render(<SubsectionHeading spacing="not-a-real-space">Fallback</SubsectionHeading>);
    expect(screen.getByText("Fallback").style.marginBlockEnd).toBe(
      "var(--space-2)"
    );
  });

  it("passes through arbitrary attributes (a11y labelling / test hooks)", () => {
    render(
      <SubsectionHeading data-testid="legal-subheading" id="gdpr-rights">
        6.1 GDPR Rights (EEA Residents)
      </SubsectionHeading>
    );
    const node = screen.getByTestId("legal-subheading");
    expect(node).toHaveAttribute("id", "gdpr-rights");
    expect(node).toHaveTextContent("6.1 GDPR Rights (EEA Residents)");
  });

  it("caller style overrides the base style", () => {
    render(
      <SubsectionHeading tone="muted" style={{ fontStyle: "italic" }}>
        Overridden
      </SubsectionHeading>
    );
    const node = screen.getByText("Overridden");
    expect(node.style.fontStyle).toBe("italic");
    expect(node.style.color).toBe("var(--text-tertiary)");
  });
});
