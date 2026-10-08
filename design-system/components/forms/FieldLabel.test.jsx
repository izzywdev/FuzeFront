import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldLabel } from "./FieldLabel.jsx";

describe("<FieldLabel>", () => {
  it("renders label text and associates with a control via htmlFor", () => {
    render(
      <>
        <FieldLabel htmlFor="first-name">First Name</FieldLabel>
        <input id="first-name" />
      </>
    );
    expect(screen.getByLabelText("First Name")).toBeInTheDocument();
  });

  it("does not show a required marker by default", () => {
    render(<FieldLabel htmlFor="company">Company</FieldLabel>);
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("shows a visual asterisk and a visually-hidden ' (required)' suffix when required", () => {
    render(
      <FieldLabel htmlFor="email" required data-testid="email-label">
        Email
      </FieldLabel>
    );
    const label = screen.getByTestId("email-label");
    // Visible asterisk, hidden from assistive tech (it's decorative)...
    const asterisk = screen.getByText("*");
    expect(asterisk).toHaveAttribute("aria-hidden", "true");
    // ...paired with a visually-hidden text suffix that IS exposed to
    // assistive tech, so the requirement reaches screen readers too.
    expect(label).toHaveTextContent("Email* (required)");
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });

  it("forwards additional label attributes and merges style overrides", () => {
    render(
      <FieldLabel htmlFor="bio" style={{ marginBlockEnd: "4px" }} data-testid="bio-label">
        Bio
      </FieldLabel>
    );
    const label = screen.getByTestId("bio-label");
    expect(label).toHaveStyle({ marginBlockEnd: "4px" });
    expect(label).toHaveAttribute("for", "bio");
  });
});
