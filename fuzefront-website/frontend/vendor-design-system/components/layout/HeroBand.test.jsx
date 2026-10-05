import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroBand } from "./HeroBand.jsx";

describe("<HeroBand>", () => {
  it("renders its children", () => {
    render(
      <HeroBand>
        <h1>Blog &amp; Insights</h1>
      </HeroBand>
    );
    expect(screen.getByRole("heading", { name: "Blog & Insights" })).toBeInTheDocument();
  });

  it("defaults to a <section> with the lg (--space-24) vertical padding", () => {
    render(<HeroBand data-testid="band">content</HeroBand>);
    const el = screen.getByTestId("band");
    expect(el.tagName).toBe("SECTION");
    expect(el.style.paddingBlock).toBe("var(--space-24)");
  });

  it("carries the ds-hero-band class that supplies the default gradient", () => {
    render(<HeroBand data-testid="band">content</HeroBand>);
    expect(screen.getByTestId("band").className).toContain("ds-hero-band");
  });

  it("maps padding to the matching --space-* token", () => {
    render(
      <HeroBand padding="sm" data-testid="band">
        content
      </HeroBand>
    );
    expect(screen.getByTestId("band").style.paddingBlock).toBe("var(--space-12)");
  });

  it("falls back to lg for an unknown padding", () => {
    render(
      <HeroBand padding="xl" data-testid="band">
        content
      </HeroBand>
    );
    expect(screen.getByTestId("band").style.paddingBlock).toBe("var(--space-24)");
  });

  it("from/to/angle set the --hero-band-* custom properties", () => {
    render(
      <HeroBand from="#fff" to="#000" angle="to right" data-testid="band">
        content
      </HeroBand>
    );
    const el = screen.getByTestId("band");
    expect(el.style.getPropertyValue("--hero-band-from")).toBe("#fff");
    expect(el.style.getPropertyValue("--hero-band-to")).toBe("#000");
    expect(el.style.getPropertyValue("--hero-band-angle")).toBe("to right");
  });

  it("leaves the --hero-band-* custom properties unset when from/to/angle are omitted", () => {
    render(<HeroBand data-testid="band">content</HeroBand>);
    const el = screen.getByTestId("band");
    expect(el.style.getPropertyValue("--hero-band-from")).toBe("");
    expect(el.style.getPropertyValue("--hero-band-to")).toBe("");
    expect(el.style.getPropertyValue("--hero-band-angle")).toBe("");
  });

  it("renders as a different element via `as`, forwarding a ref to it", () => {
    const ref = React.createRef();
    render(
      <HeroBand as="div" ref={ref} data-testid="band">
        content
      </HeroBand>
    );
    const el = screen.getByTestId("band");
    expect(el.tagName).toBe("DIV");
    expect(ref.current).toBe(el);
  });

  it("merges a caller className alongside ds-hero-band", () => {
    render(
      <HeroBand className="relative" data-testid="band">
        content
      </HeroBand>
    );
    const cls = screen.getByTestId("band").className;
    expect(cls).toContain("ds-hero-band");
    expect(cls).toContain("relative");
  });

  it("merges caller style without dropping the computed padding", () => {
    render(
      <HeroBand style={{ overflow: "hidden" }} data-testid="band">
        content
      </HeroBand>
    );
    const el = screen.getByTestId("band");
    expect(el.style.overflow).toBe("hidden");
    expect(el.style.paddingBlock).toBe("var(--space-24)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(
      <HeroBand data-testid="band" aria-label="hero">
        content
      </HeroBand>
    );
    expect(screen.getByTestId("band")).toHaveAttribute("aria-label", "hero");
  });
});
