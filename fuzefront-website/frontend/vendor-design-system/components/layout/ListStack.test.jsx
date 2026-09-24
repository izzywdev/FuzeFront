import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListStack } from "./ListStack.jsx";

describe("<ListStack>", () => {
  it("renders a <ul> by default", () => {
    render(
      <ListStack>
        <li>One</li>
        <li>Two</li>
      </ListStack>
    );
    expect(screen.getByRole("list").tagName).toBe("UL");
  });

  it("renders as <ol> when `as=\"ol\"`", () => {
    render(
      <ListStack as="ol">
        <li>One</li>
      </ListStack>
    );
    expect(screen.getByRole("list").tagName).toBe("OL");
  });

  it("defaults gap to the sm token", () => {
    render(
      <ListStack>
        <li>Item</li>
      </ListStack>
    );
    expect(screen.getByRole("list").style.gap).toBe("var(--space-2)");
  });

  it("resolves every gap variant to its DS spacing token — never a raw value", () => {
    const cases = [
      ["xs", "var(--space-1)"],
      ["sm", "var(--space-2)"],
      ["md", "var(--space-3)"],
      ["lg", "var(--space-4)"],
    ];
    cases.forEach(([gap, expected]) => {
      const { unmount } = render(
        <ListStack gap={gap}>
          <li>Item</li>
        </ListStack>
      );
      expect(screen.getByRole("list").style.gap).toBe(expected);
      unmount();
    });
  });

  it("falls back to the sm gap for an unknown gap value", () => {
    render(
      <ListStack gap="not-a-real-gap">
        <li>Item</li>
      </ListStack>
    );
    expect(screen.getByRole("list").style.gap).toBe("var(--space-2)");
  });

  it("lays out as a flex column with browser list styling reset", () => {
    render(
      <ListStack>
        <li>Item</li>
      </ListStack>
    );
    const node = screen.getByRole("list");
    expect(node.style.display).toBe("flex");
    expect(node.style.flexDirection).toBe("column");
    expect(node.style.listStyle).toBe("none");
    expect(node.style.margin).toBe("0px");
    expect(node.style.paddingInlineStart).toBe("0");
  });

  it("keeps list/listitem semantics for assistive tech even though list-style is reset (Safari/VoiceOver)", () => {
    render(
      <ListStack>
        <li>First</li>
        <li>Second</li>
      </ListStack>
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders its children in order", () => {
    render(
      <ListStack>
        <li>First</li>
        <li>Second</li>
      </ListStack>
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("First");
    expect(items[1]).toHaveTextContent("Second");
  });

  it("passes through arbitrary attributes (test hooks / aria)", () => {
    render(
      <ListStack data-testid="footer-links" aria-label="Product links">
        <li>Item</li>
      </ListStack>
    );
    const node = screen.getByTestId("footer-links");
    expect(node).toHaveAttribute("aria-label", "Product links");
  });

  it("caller style overrides the base style", () => {
    render(
      <ListStack style={{ marginTop: "var(--space-4)" }}>
        <li>Item</li>
      </ListStack>
    );
    expect(screen.getByRole("list").style.marginTop).toBe("var(--space-4)");
  });
});
