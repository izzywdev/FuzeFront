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

describe("<Input> label", () => {
  it("accepts a node label (e.g. an inline annotation) and still associates it with the field", () => {
    render(
      <Input
        label={
          <>
            Slug
            <span> (auto-derived)</span>
          </>
        }
        defaultValue="my-org"
      />
    );
    expect(screen.getByLabelText(/Slug/)).toHaveValue("my-org");
    expect(screen.getByText("(auto-derived)", { exact: false })).toBeInTheDocument();
  });
});

describe("<Input> adornment + validity rings", () => {
  it("renders a decorative end adornment and reserves room for it", () => {
    render(<Input label="Email" adornment={<i data-testid="ad" />} />);
    expect(screen.getByTestId("ad").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByLabelText("Email").style.paddingInlineEnd).toBe("var(--space-10)");
  });

  it("valid -> success border; invalid -> error border + aria-invalid with no message", () => {
    const { rerender } = render(<Input label="Email" valid />);
    expect(screen.getByLabelText("Email").style.border).toContain("var(--success-color)");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    rerender(<Input label="Email" invalid />);
    expect(screen.getByLabelText("Email").style.border).toContain("var(--error-color)");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets a caller localize the reveal toggle's accessible name", () => {
    render(
      <Input
        label="Password"
        type="password"
        showPasswordLabel="إظهار كلمة المرور"
        hidePasswordLabel="إخفاء كلمة المرور"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "إظهار كلمة المرور" }));
    expect(screen.getByRole("button", { name: "إخفاء كلمة المرور" })).toBeInTheDocument();
  });
});
