import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconListItem } from "./IconListItem.jsx";

const DummyIcon = (props) => <svg data-testid="dummy-icon" {...props} />;

describe("<IconListItem>", () => {
  it("renders as a <li> by default, inside a <listitem> role", () => {
    render(
      <ul>
        <IconListItem icon={DummyIcon}>Some text</IconListItem>
      </ul>
    );
    expect(screen.getByRole("listitem").tagName).toBe("LI");
  });

  it("renders as a <div> when as=\"div\"", () => {
    render(
      <IconListItem as="div" icon={DummyIcon} data-testid="row">
        Some text
      </IconListItem>
    );
    expect(screen.getByTestId("row").tagName).toBe("DIV");
  });

  it("renders the icon and the children content", () => {
    render(
      <IconListItem icon={DummyIcon} as="div">
        Challenge text
      </IconListItem>
    );
    expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
    expect(screen.getByText("Challenge text")).toBeInTheDocument();
  });

  it("renders no icon when `icon` is omitted", () => {
    render(
      <IconListItem as="div" data-testid="row">
        Text only
      </IconListItem>
    );
    expect(screen.queryByTestId("dummy-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("row")).toHaveTextContent("Text only");
  });

  it("the icon is decorative by default (aria-hidden)", () => {
    render(
      <IconListItem as="div" icon={DummyIcon}>
        Text
      </IconListItem>
    );
    expect(screen.getByTestId("dummy-icon")).toHaveAttribute("aria-hidden", "true");
  });

  it("defaults tone to success and size to 14", () => {
    render(
      <IconListItem as="div" icon={DummyIcon}>
        Text
      </IconListItem>
    );
    const icon = screen.getByTestId("dummy-icon");
    expect(icon.style.color).toBe("var(--success-color)");
    expect(icon.getAttribute("size")).toBe("14");
  });

  it.each([
    ["success", "var(--success-color)"],
    ["warning", "var(--warning-color)"],
    ["error", "var(--error-color)"],
    ["accent", "var(--accent-color)"],
    ["neutral", "var(--text-secondary)"],
    ["muted", "var(--text-tertiary)"],
  ])("resolves tone=%s to its DS color token", (tone, expected) => {
    render(
      <IconListItem as="div" icon={DummyIcon} tone={tone}>
        Text
      </IconListItem>
    );
    expect(screen.getByTestId("dummy-icon").style.color).toBe(expected);
  });

  it("passes a custom size straight to the icon", () => {
    render(
      <IconListItem as="div" icon={DummyIcon} size={18}>
        Text
      </IconListItem>
    );
    expect(screen.getByTestId("dummy-icon").getAttribute("size")).toBe("18");
  });

  it("the icon never shrinks and is nudged to align with the first text line", () => {
    render(
      <IconListItem as="div" icon={DummyIcon}>
        Text
      </IconListItem>
    );
    const icon = screen.getByTestId("dummy-icon");
    expect(icon.style.flex).toBe("0 0 auto"); // jsdom's normalized form of the `flex: "none"` shorthand
    expect(icon.style.marginTop).toBe("2px");
  });

  it("lays out as a top-aligned flex row with a token-driven gap", () => {
    render(
      <IconListItem as="div" icon={DummyIcon} data-testid="row">
        Text
      </IconListItem>
    );
    const row = screen.getByTestId("row");
    expect(row.style.display).toBe("flex");
    expect(row.style.alignItems).toBe("flex-start");
    expect(row.style.gap).toBe("var(--space-2)");
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
        <IconListItem as="div" icon={DummyIcon} gap={gap} data-testid="row">
          Text
        </IconListItem>
      );
      expect(screen.getByTestId("row").style.gap).toBe(expected);
      unmount();
    });
  });

  it("falls back to the sm gap for an unknown gap value", () => {
    render(
      <IconListItem as="div" icon={DummyIcon} gap="not-a-real-gap" data-testid="row">
        Text
      </IconListItem>
    );
    expect(screen.getByTestId("row").style.gap).toBe("var(--space-2)");
  });

  it("passes through arbitrary attributes (className / aria / test hooks) to the row", () => {
    render(
      <IconListItem as="div" icon={DummyIcon} className="text-sm text-gray-600" data-testid="row">
        Text
      </IconListItem>
    );
    const row = screen.getByTestId("row");
    expect(row).toHaveClass("text-sm", "text-gray-600");
  });

  it("caller style overrides the base style", () => {
    render(
      <IconListItem as="div" icon={DummyIcon} style={{ gap: "var(--space-4)" }} data-testid="row">
        Text
      </IconListItem>
    );
    expect(screen.getByTestId("row").style.gap).toBe("var(--space-4)");
  });
});
