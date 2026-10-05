import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BulletList } from "./BulletList.jsx";

describe("<BulletList>", () => {
  it("renders a <ul> with a disc marker by default", () => {
    render(
      <BulletList>
        <li>One</li>
        <li>Two</li>
      </BulletList>
    );
    const node = screen.getByRole("list");
    expect(node.tagName).toBe("UL");
    expect(node.style.listStyleType).toBe("disc");
  });

  it("renders as <ol> with a decimal marker when as=\"ol\"", () => {
    render(
      <BulletList as="ol">
        <li>One</li>
      </BulletList>
    );
    const node = screen.getByRole("list");
    expect(node.tagName).toBe("OL");
    expect(node.style.listStyleType).toBe("decimal");
  });

  it("keeps native list/listitem a11y semantics (no role override, no list-style: none)", () => {
    render(
      <BulletList>
        <li>First</li>
        <li>Second</li>
      </BulletList>
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("indents with the --space-6 token (pl-6's exact match)", () => {
    render(
      <BulletList>
        <li>Item</li>
      </BulletList>
    );
    expect(screen.getByRole("list").style.paddingInlineStart).toBe("var(--space-6)");
  });

  it("defaults space (top margin) to none", () => {
    render(
      <BulletList>
        <li>Item</li>
      </BulletList>
    );
    expect(screen.getByRole("list").style.marginBlockStart).toBe("0");
  });

  it.each([
    ["none", "0"],
    ["sm", "var(--space-3)"],
    ["md", "var(--space-4)"],
  ])("space=%s maps to the %s top-margin token", (space, expected) => {
    render(
      <BulletList space={space}>
        <li>Item</li>
      </BulletList>
    );
    expect(screen.getByRole("list").style.marginBlockStart).toBe(expected);
  });

  it("leaves the first item unspaced and gives every later item the gap token as marginBlockStart", () => {
    render(
      <BulletList gap="md">
        <li>First</li>
        <li>Second</li>
        <li>Third</li>
      </BulletList>
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0].style.marginBlockStart).toBe("");
    expect(items[1].style.marginBlockStart).toBe("var(--space-3)");
    expect(items[2].style.marginBlockStart).toBe("var(--space-3)");
  });

  it("defaults gap to sm (--space-2, 8px — the space-y-1.5/space-y-2 rounding ListStack also uses)", () => {
    render(
      <BulletList>
        <li>First</li>
        <li>Second</li>
      </BulletList>
    );
    expect(screen.getAllByRole("listitem")[1].style.marginBlockStart).toBe("var(--space-2)");
  });

  it("falls back to the sm gap for an unknown gap value", () => {
    render(
      <BulletList gap="not-a-real-gap">
        <li>First</li>
        <li>Second</li>
      </BulletList>
    );
    expect(screen.getAllByRole("listitem")[1].style.marginBlockStart).toBe("var(--space-2)");
  });

  it("preserves a caller-supplied style on an item alongside the injected gap", () => {
    render(
      <BulletList>
        <li>First</li>
        <li style={{ color: "red" }}>Second</li>
      </BulletList>
    );
    const second = screen.getAllByRole("listitem")[1];
    expect(second.style.color).toBe("red");
    expect(second.style.marginBlockStart).toBe("var(--space-2)");
  });

  it("renders rich children inside items (e.g. <strong> labels)", () => {
    render(
      <BulletList>
        <li>
          <strong>Access:</strong> Request a copy of your personal data
        </li>
      </BulletList>
    );
    expect(screen.getByText("Access:")).toBeInTheDocument();
  });

  it("passes through arbitrary attributes (test hooks / aria)", () => {
    render(
      <BulletList data-testid="policy-list" aria-label="Your rights">
        <li>Item</li>
      </BulletList>
    );
    const node = screen.getByTestId("policy-list");
    expect(node).toHaveAttribute("aria-label", "Your rights");
  });

  it("caller style overrides the base style", () => {
    render(
      <BulletList style={{ marginBlockStart: "var(--space-8)" }}>
        <li>Item</li>
      </BulletList>
    );
    expect(screen.getByRole("list").style.marginBlockStart).toBe("var(--space-8)");
  });
});
