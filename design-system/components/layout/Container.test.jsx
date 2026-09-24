import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Container } from "./Container.jsx";

describe("<Container>", () => {
  it("renders children inside a div by default", () => {
    render(<Container>content</Container>);
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("defaults to the 7xl width token, centered", () => {
    render(<Container data-testid="c">content</Container>);
    const el = screen.getByTestId("c");
    expect(el.style.maxWidth).toBe("var(--container-7xl)");
    expect(el.style.marginInline).toBe("auto");
  });

  it("maps size to the matching --container-* token", () => {
    render(
      <Container size="4xl" data-testid="c">
        content
      </Container>
    );
    expect(screen.getByTestId("c").style.maxWidth).toBe("var(--container-4xl)");
  });

  it("falls back to 7xl for an unknown size", () => {
    render(
      <Container size="9xl" data-testid="c">
        content
      </Container>
    );
    expect(screen.getByTestId("c").style.maxWidth).toBe("var(--container-7xl)");
  });

  it("size=full removes the width cap but stays centered", () => {
    render(
      <Container size="full" data-testid="c">
        content
      </Container>
    );
    expect(screen.getByTestId("c").style.maxWidth).toBe("none");
    expect(screen.getByTestId("c").style.marginInline).toBe("auto");
  });

  it("applies the responsive gutter class by default", () => {
    render(<Container data-testid="c">content</Container>);
    expect(screen.getByTestId("c").className).toContain("ds-container--gutter");
  });

  it("gutter=false drops the padding class and skips the injected <style>", () => {
    const { container } = render(
      <Container gutter={false} data-testid="c">
        content
      </Container>
    );
    expect(screen.getByTestId("c").className).not.toContain("ds-container--gutter");
    expect(container.querySelector("style")).toBeNull();
  });

  it("uses CSS logical properties (padding-inline), not physical left/right — mirrors under RTL", () => {
    render(<Container data-testid="c">content</Container>);
    const el = screen.getByTestId("c");
    expect(el.style.marginLeft).toBe("");
    expect(el.style.marginRight).toBe("");
    expect(el.style.marginInline).toBe("auto");
  });

  it("renders as a different element via `as`", () => {
    render(
      <Container as="nav" data-testid="c">
        content
      </Container>
    );
    expect(screen.getByTestId("c").tagName).toBe("NAV");
  });

  it("merges a caller className alongside ds-container", () => {
    render(
      <Container className="relative" data-testid="c">
        content
      </Container>
    );
    const cls = screen.getByTestId("c").className;
    expect(cls).toContain("ds-container");
    expect(cls).toContain("relative");
  });

  it("merges caller style without dropping the computed width/centering", () => {
    render(
      <Container style={{ background: "var(--bg-secondary)" }} data-testid="c">
        content
      </Container>
    );
    const el = screen.getByTestId("c");
    expect(el.style.background).toBe("var(--bg-secondary)");
    expect(el.style.maxWidth).toBe("var(--container-7xl)");
  });

  it("forwards data-* test hooks and other DOM props", () => {
    render(
      <Container data-testid="c" aria-label="page content">
        content
      </Container>
    );
    expect(screen.getByTestId("c")).toHaveAttribute("aria-label", "page content");
  });
});
