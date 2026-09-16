import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "./Input.jsx";

describe("<Input> password reveal toggle", () => {
  it("renders a 'Show password' toggle for password fields, hidden by default", () => {
    render(<Input label="Password" type="password" defaultValue="hunter2" />);
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
  });

  it("toggles the field between password and text (value untouched)", () => {
    render(<Input label="Password" type="password" defaultValue="hunter2" />);
    const field = screen.getByLabelText("Password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("hunter2");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field).toHaveAttribute("type", "password");
  });

  it("does NOT render the toggle for non-password inputs", () => {
    render(<Input label="Email" type="email" />);
    expect(screen.queryByRole("button", { name: /password/i })).not.toBeInTheDocument();
  });

  it("respects revealToggle={false} on a password field", () => {
    render(<Input label="Password" type="password" revealToggle={false} />);
    expect(screen.queryByRole("button", { name: /password/i })).not.toBeInTheDocument();
  });

  it("hides the toggle when disabled", () => {
    render(<Input label="Password" type="password" disabled />);
    expect(screen.queryByRole("button", { name: /password/i })).not.toBeInTheDocument();
  });

  it("keeps a controlled password field working through a reveal", () => {
    function Controlled() {
      const [v, setV] = React.useState("");
      return <Input label="Password" type="password" value={v} onChange={(e) => setV(e.target.value)} />;
    }
    render(<Controlled />);
    const field = screen.getByLabelText("Password");
    fireEvent.change(field, { target: { value: "abc" } });
    expect(field).toHaveValue("abc");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("abc");
  });
});
