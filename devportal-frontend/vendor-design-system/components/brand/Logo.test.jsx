import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Logo } from "./Logo.jsx";

describe("<Logo>", () => {
  it("renders an <img> when src is given", () => {
    render(<Logo src="https://cdn.example.com/logo.png" name="CorpABC" />);
    const img = screen.getByRole("img", { name: "CorpABC" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/logo.png");
    expect(img).toHaveAttribute("data-logo-state", "image");
  });

  it("falls back to initials (never a broken-image icon) when the image errors", () => {
    render(<Logo src="https://dead-link.example.com/x.png" name="Northwind" />);
    const img = screen.getByRole("img", { name: "Northwind" });
    expect(img.tagName).toBe("IMG");

    fireEvent.error(img);

    // After the error, no <img> remains — a text/span fallback replaces it.
    const fallback = screen.getByText("N");
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback).toHaveAttribute("data-logo-state", "fallback-error");
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders initials from the first two words when no src is given", () => {
    render(<Logo name="Northwind Traders" />);
    const fallback = screen.getByText("NT");
    expect(fallback).toHaveAttribute("data-logo-state", "fallback-initials");
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders a single-letter initial for a one-word name", () => {
    render(<Logo name="CorpABC" />);
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("falls back to '?' when there is neither src nor name", () => {
    render(<Logo />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("resets the broken-image flag when src changes", () => {
    const { rerender } = render(<Logo src="https://dead.example.com/a.png" name="Acme Co" />);
    fireEvent.error(screen.getByRole("img", { name: "Acme Co" }));
    expect(screen.getByText("AC")).toBeInTheDocument();

    rerender(<Logo src="https://good.example.com/b.png" name="B Co" />);
    expect(screen.getByRole("img", { name: "B Co" })).toBeInTheDocument();
  });

  it("uses an explicit alt over name for the accessible name", () => {
    render(<Logo src="https://cdn.example.com/logo.png" name="CorpABC" alt="CorpABC portal logo" />);
    expect(screen.getByRole("img", { name: "CorpABC portal logo" })).toBeInTheDocument();
  });
});
