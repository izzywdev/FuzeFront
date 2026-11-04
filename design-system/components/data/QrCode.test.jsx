import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QrCode } from "./QrCode.jsx";

const M = [
  [true, false, true],
  [false, true, false],
  [true, false, true],
];

describe("<QrCode>", () => {
  it("renders an accessible svg sized to matrix + quiet zone", () => {
    render(<QrCode modules={M} label="Scan me" />);
    const svg = screen.getByRole("img", { name: "Scan me" });
    expect(svg).toHaveAttribute("viewBox", "0 0 11 11");
  });

  it("draws one path segment per dark module", () => {
    const { container } = render(<QrCode modules={M} />);
    const d = container.querySelector("path").getAttribute("d");
    expect(d.match(/M/g)).toHaveLength(5);
  });

  it("defaults the quiet zone to 4 modules and honours an override", () => {
    const { container, rerender } = render(<QrCode modules={M} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 11 11");
    rerender(<QrCode modules={M} quietZone={1} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 5 5");
  });

  it("renders nothing for an empty matrix", () => {
    const { container } = render(<QrCode modules={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses fixed-contrast plate tokens, not theme text colors", () => {
    const { container } = render(<QrCode modules={M} />);
    expect(container.querySelector("svg").style.background).toContain("--paper");
    expect(container.querySelector("path")).toHaveAttribute("fill", "var(--ink-900)");
  });
});
