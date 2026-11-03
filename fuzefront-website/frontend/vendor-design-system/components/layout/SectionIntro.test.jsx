import React, { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionIntro } from "./SectionIntro.jsx";

describe("<SectionIntro>", () => {
  it("renders the title inside an h2 by default, centered", () => {
    const { container } = render(<SectionIntro title="Leadership" data-testid="wrap" />);
    expect(screen.getByRole("heading", { level: 2, name: "Leadership" })).toBeInTheDocument();
    expect(screen.getByTestId("wrap").style.textAlign).toBe("center");
  });

  it("renders the title as an h1 when heading='h1'", () => {
    render(<SectionIntro heading="h1" title="Privacy Policy" />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
  });

  it("defaults the wrapper bottom margin to --space-12", () => {
    render(<SectionIntro title="x" data-testid="wrap" />);
    expect(screen.getByTestId("wrap").style.marginBottom).toBe("var(--space-12)");
  });

  it("maps spacing to the matching --space-* token (the CareersPage mb-14 / HomePage mb-16 cases)", () => {
    const { rerender } = render(<SectionIntro title="x" spacing={14} data-testid="wrap" />);
    expect(screen.getByTestId("wrap").style.marginBottom).toBe("var(--space-14)");

    rerender(<SectionIntro title="x" spacing={16} data-testid="wrap" />);
    expect(screen.getByTestId("wrap").style.marginBottom).toBe("var(--space-16)");
  });

  it("does not render a description paragraph when none is given", () => {
    const { container } = render(<SectionIntro title="Leadership" />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders the description as a centered lead paragraph when given", () => {
    render(<SectionIntro title="What we offer" description="Everything a growing SaaS needs." />);
    const p = screen.getByText("Everything a growing SaaS needs.");
    expect(p.tagName).toBe("P");
    expect(p.style.margin).toBe("0px auto");
    expect(p.style.maxWidth).toBe("42rem");
  });

  it("maps descriptionMaxWidth='xl' to 36rem (the HomePage industries-section case)", () => {
    render(<SectionIntro title="x" description="lede" descriptionMaxWidth="xl" />);
    expect(screen.getByText("lede").style.maxWidth).toBe("36rem");
  });

  it("renders an icon slot above the title (the Privacy/Terms IconTile case)", () => {
    render(
      <SectionIntro
        title="Privacy Policy"
        icon={<span data-testid="icon">shield</span>}
      />
    );
    const icon = screen.getByTestId("icon");
    const heading = screen.getByRole("heading");
    // icon precedes the heading in document order
    expect(
      icon.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders children after the description (the legal pages' meta lines)", () => {
    render(
      <SectionIntro title="Terms of Service" description="lede">
        <p data-testid="meta">Last updated: September 2026</p>
      </SectionIntro>
    );
    expect(screen.getByTestId("meta")).toBeInTheDocument();
  });

  it("defaults titleGap to --space-4 and can be overridden (the legal-page mb-3 case)", () => {
    const { rerender } = render(<SectionIntro title="x" />);
    expect(screen.getByRole("heading").style.marginBottom).toBe("var(--space-4)");

    rerender(<SectionIntro title="x" titleGap={3} />);
    expect(screen.getByRole("heading").style.marginBottom).toBe("var(--space-3)");

    rerender(<SectionIntro title="x" titleGap={0} />);
    expect(screen.getByRole("heading").style.marginBottom).toBe("0px");
  });

  it("forwards a ref to the underlying element (useInView-compatible)", () => {
    const ref = createRef();
    render(<SectionIntro ref={ref} title="x" />);
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current.tagName).toBe("DIV");
  });

  it("renders as a different element via `as`, forwarding extra props (e.g. framer-motion's motion.div)", () => {
    const FakeMotionDiv = React.forwardRef(({ variants, ...rest }, ref) => (
      <div ref={ref} data-variants={variants ? "yes" : "no"} {...rest} />
    ));
    const ref = createRef();
    render(
      <SectionIntro as={FakeMotionDiv} ref={ref} title="x" variants={{}} data-testid="wrap" />
    );
    expect(screen.getByTestId("wrap")).toHaveAttribute("data-variants", "yes");
  });

  it("merges a caller className and style", () => {
    render(
      <SectionIntro
        title="x"
        className="extra-class"
        style={{ background: "var(--bg-secondary)" }}
        data-testid="wrap"
      />
    );
    const el = screen.getByTestId("wrap");
    expect(el.className).toContain("extra-class");
    expect(el.style.background).toBe("var(--bg-secondary)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(<SectionIntro title="x" data-testid="wrap" aria-label="intro" />);
    expect(screen.getByTestId("wrap")).toHaveAttribute("aria-label", "intro");
  });
});
