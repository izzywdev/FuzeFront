import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Center } from "./Center.jsx";

describe("<Center>", () => {
  it("renders its children", () => {
    render(
      <Center>
        <h1>About FuzeOne</h1>
      </Center>
    );
    expect(screen.getByRole("heading", { name: "About FuzeOne" })).toBeInTheDocument();
  });

  it("defaults to a <div> with text-align: center", () => {
    const { container } = render(<Center>content</Center>);
    const el = container.firstElementChild;
    expect(el.tagName).toBe("DIV");
    expect(el.style.textAlign).toBe("center");
  });

  it("as renders a different element while keeping text-align: center", () => {
    const { container } = render(<Center as="section">content</Center>);
    const el = container.firstElementChild;
    expect(el.tagName).toBe("SECTION");
    expect(el.style.textAlign).toBe("center");
  });

  it("as accepts a component (e.g. an animation wrapper) and forwards its props", () => {
    const Wrapper = ({ children, "data-animated": animated, ...rest }) => (
      <div data-animated={animated} {...rest}>
        {children}
      </div>
    );
    render(
      <Center as={Wrapper} data-animated="true">
        content
      </Center>
    );
    const el = screen.getByText("content");
    expect(el).toHaveAttribute("data-animated", "true");
    expect(el.style.textAlign).toBe("center");
  });

  it("a caller style is merged, and cannot silently drop the centering", () => {
    const { container } = render(<Center style={{ marginTop: "var(--space-6)" }}>content</Center>);
    const el = container.firstElementChild;
    expect(el.style.textAlign).toBe("center");
    expect(el.style.marginTop).toBe("var(--space-6)");
  });

  it("forwards arbitrary data-* attributes (test hooks)", () => {
    render(<Center data-testid="hero-copy">content</Center>);
    expect(screen.getByTestId("hero-copy")).toBeInTheDocument();
  });
});
