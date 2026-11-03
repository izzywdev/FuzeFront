import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionIcon } from "./SectionIcon.jsx";

const DummyIcon = (props) => <svg data-testid="dummy-icon" {...props} />;

describe("<SectionIcon>", () => {
  it("renders its children (the icon)", () => {
    render(
      <SectionIcon tone="accent">
        <DummyIcon />
      </SectionIcon>
    );
    expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
  });

  it("is decorative by default (aria-hidden, no accessible name)", () => {
    const { container } = render(
      <SectionIcon tone="accent">
        <DummyIcon />
      </SectionIcon>
    );
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("exposes an accessible name via `label` when the icon is not decorative", () => {
    render(
      <SectionIcon tone="success" label="Verified">
        <DummyIcon />
      </SectionIcon>
    );
    expect(screen.getByRole("img", { name: "Verified" })).toBeInTheDocument();
  });

  it.each(["accent", "info", "success", "warning", "error", "neutral"])(
    "accepts tone=%s without throwing",
    (tone) => {
      render(
        <SectionIcon tone={tone}>
          <DummyIcon />
        </SectionIcon>
      );
      expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
    }
  );

  it("centers the icon via a flex wrapper, justified center", () => {
    const { container } = render(
      <SectionIcon tone="accent">
        <DummyIcon />
      </SectionIcon>
    );
    const wrapper = container.firstChild;
    expect(wrapper.style.display).toBe("flex");
    expect(wrapper.style.justifyContent).toBe("center");
  });

  it("defaults gap to lg (--space-6, the FuzeHubPage/PricingPage CTA spacing)", () => {
    const { container } = render(
      <SectionIcon tone="accent">
        <DummyIcon />
      </SectionIcon>
    );
    expect(container.firstChild.style.marginBottom).toBe("var(--space-6)");
  });

  it("gap=md uses --space-4 (the HomePage newsletter-teaser spacing)", () => {
    const { container } = render(
      <SectionIcon tone="accent" gap="md">
        <DummyIcon />
      </SectionIcon>
    );
    expect(container.firstChild.style.marginBottom).toBe("var(--space-4)");
  });

  it("colors the icon by tone", () => {
    const { container } = render(
      <SectionIcon tone="success">
        <DummyIcon />
      </SectionIcon>
    );
    expect(container.firstChild.style.color).toBe("var(--success-color)");
  });

  it("forwards arbitrary data-* attributes (test hooks) to the rendered span", () => {
    render(
      <SectionIcon tone="accent" data-section-icon="cta">
        <DummyIcon />
      </SectionIcon>
    );
    expect(
      screen.getByTestId("dummy-icon").closest("[data-section-icon='cta']")
    ).toBeInTheDocument();
  });
});
