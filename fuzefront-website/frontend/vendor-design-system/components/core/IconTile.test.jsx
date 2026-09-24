import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconTile } from "./IconTile.jsx";

const DummyIcon = (props) => <svg data-testid="dummy-icon" {...props} />;

describe("<IconTile>", () => {
  it("renders its children (the icon) inside the tile", () => {
    render(
      <IconTile tone="accent">
        <DummyIcon />
      </IconTile>
    );
    expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
  });

  it("is decorative by default (aria-hidden, no accessible name)", () => {
    const { container } = render(
      <IconTile tone="accent">
        <DummyIcon />
      </IconTile>
    );
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("exposes an accessible name via `label` when the icon is not decorative", () => {
    render(
      <IconTile tone="success" label="Success">
        <DummyIcon />
      </IconTile>
    );
    expect(screen.getByRole("img", { name: "Success" })).toBeInTheDocument();
  });

  it.each(["accent", "info", "success", "warning", "error", "neutral"])(
    "accepts tone=%s without throwing",
    (tone) => {
      render(
        <IconTile tone={tone}>
          <DummyIcon />
        </IconTile>
      );
      expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
    }
  );

  it.each(["sm", "md", "lg"])("accepts size=%s without throwing", (size) => {
    render(
      <IconTile size={size}>
        <DummyIcon />
      </IconTile>
    );
    expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
  });

  it("variant=soft (default) sizes a fixed box and tints the background with the tone's soft token", () => {
    const { container } = render(
      <IconTile tone="success" size="md">
        <DummyIcon />
      </IconTile>
    );
    const tile = container.firstChild;
    expect(tile.style.width).toBe("44px");
    expect(tile.style.height).toBe("44px");
    expect(tile.style.background).toBe("var(--success-soft)");
    expect(tile.style.color).toBe("var(--success-color)");
  });

  it("variant=surface keeps a fixed box but uses the neutral surface token, not the tone tint", () => {
    const { container } = render(
      <IconTile tone="accent" variant="surface">
        <DummyIcon />
      </IconTile>
    );
    const tile = container.firstChild;
    expect(tile.style.background).toBe("var(--bg-quaternary)");
    expect(tile.style.color).toBe("var(--accent-color)");
  });

  it("variant=plain renders no box (no fixed width/height/background) — just a tinted inline wrapper", () => {
    const { container } = render(
      <IconTile tone="error" variant="plain">
        <DummyIcon />
      </IconTile>
    );
    const tile = container.firstChild;
    expect(tile.style.width).toBe("");
    expect(tile.style.height).toBe("");
    expect(tile.style.background).toBe("");
    expect(tile.style.color).toBe("var(--error-color)");
  });

  it("forwards arbitrary data-* attributes (test hooks) to the rendered span", () => {
    render(
      <IconTile tone="accent" data-tile="hero">
        <DummyIcon />
      </IconTile>
    );
    expect(screen.getByTestId("dummy-icon").closest("[data-tile='hero']")).toBeInTheDocument();
  });
});
