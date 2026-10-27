import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhoneNumberInput, isValidE164 } from "./PhoneNumberInput.jsx";

describe("isValidE164", () => {
  it("accepts well-formed numbers and rejects malformed ones", () => {
    expect(isValidE164("+15550104477")).toBe(true);
    expect(isValidE164("+447700900123")).toBe(true);
    expect(isValidE164("15550104477")).toBe(false);
    expect(isValidE164("+0123456789")).toBe(false);
    expect(isValidE164("+1555")).toBe(false);
    expect(isValidE164("+1555-OOPS")).toBe(false);
    expect(isValidE164("")).toBe(false);
  });
});

describe("<PhoneNumberInput>", () => {
  it("labels the national input and the country picker", () => {
    render(<PhoneNumberInput label="WhatsApp number" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("WhatsApp number")).toBeInTheDocument();
    expect(screen.getByLabelText("Country code")).toBeInTheDocument();
  });

  it("composes an E.164 value from the picker and the digits", () => {
    const onChange = vi.fn();
    render(<PhoneNumberInput label="Phone" value="" onChange={onChange} defaultCountry="GB" />);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "7700 900123" } });
    expect(onChange).toHaveBeenLastCalledWith("+447700900123", { valid: true, iso: "GB" });
    fireEvent.change(screen.getByLabelText("Country code"), { target: { value: "IL" } });
    expect(onChange).toHaveBeenLastCalledWith("+9727700900123", { valid: true, iso: "IL" });
  });

  it("splits an incoming E.164 value into picker + digits", () => {
    render(<PhoneNumberInput label="Phone" value="+447700900123" onChange={() => {}} />);
    expect(screen.getByLabelText("Country code")).toHaveValue("GB");
    expect(screen.getByLabelText("Phone")).toHaveValue("7700900123");
  });

  it("emits an empty string when the digits are cleared", () => {
    const onChange = vi.fn();
    render(<PhoneNumberInput label="Phone" value="+15550104477" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("", { valid: false, iso: "US" });
  });

  it("shows the built-in invalid message after blur and marks the field invalid", () => {
    render(<PhoneNumberInput label="Phone" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Phone");
    fireEvent.change(input, { target: { value: "55" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveAttribute("data-error-code", "INVALID_PHONE");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("lets a consumer error win and keeps digits left-to-right under RTL", () => {
    render(<PhoneNumberInput label="Phone" value="+15550104477" error="Server says no" onChange={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Server says no");
    expect(screen.getByLabelText("Phone")).toHaveAttribute("dir", "ltr");
  });

  it("disables both controls", () => {
    render(<PhoneNumberInput label="Phone" value="" onChange={() => {}} disabled />);
    expect(screen.getByLabelText("Phone")).toBeDisabled();
    expect(screen.getByLabelText("Country code")).toBeDisabled();
  });
});
