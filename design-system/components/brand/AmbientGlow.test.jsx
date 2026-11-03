import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AmbientGlow } from "./AmbientGlow.jsx";

describe("<AmbientGlow>", () => {
  it("is decorative: aria-hidden and pointer-events: none by default", () => {
    const { container } = render(<AmbientGlow />);
    const el = container.firstChild;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveStyle({ pointerEvents: "none" });
  });

  it("allows aria-hidden to be overridden", () => {
    const { container } = render(<AmbientGlow aria-hidden={false} />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "false");
  });

  it("defaults to the primary tone token", () => {
    const { container } = render(<AmbientGlow />);
    expect(container.firstChild).toHaveStyle({ background: "var(--accent-color)" });
  });

  it("maps the accent tone to --accent-2", () => {
    const { container } = render(<AmbientGlow tone="accent" />);
    expect(container.firstChild).toHaveStyle({ background: "var(--accent-2)" });
  });

  it("sizes square from the size prop", () => {
    const { container } = render(<AmbientGlow size={240} />);
    expect(container.firstChild).toHaveStyle({ width: "240px", height: "240px" });
  });

  it("supports independent width/height for a non-square glow", () => {
    const { container } = render(<AmbientGlow width={600} height={400} />);
    expect(container.firstChild).toHaveStyle({ width: "600px", height: "400px" });
  });

  it("applies the blur and opacity props", () => {
    const { container } = render(<AmbientGlow blur={48} opacity={0.15} />);
    expect(container.firstChild).toHaveStyle({ filter: "blur(48px)", opacity: "0.15" });
  });

  it("merges caller style for positioning, absolutely positioned by default", () => {
    const { container } = render(<AmbientGlow style={{ top: "2.5rem", left: "25%" }} />);
    expect(container.firstChild).toHaveStyle({
      position: "absolute",
      top: "2.5rem",
      left: "25%",
    });
  });
});
