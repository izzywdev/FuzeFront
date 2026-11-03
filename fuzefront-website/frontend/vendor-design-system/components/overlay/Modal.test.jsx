import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal.jsx";

describe("<Modal> attribute forwarding", () => {
  it("forwards data-*, aria-describedby and aria-busy to the role=dialog element", () => {
    render(
      <Modal
        open
        title="Fork it"
        data-dialog="fork"
        data-state="idle"
        aria-describedby="sub"
        aria-busy="true"
      >
        <p id="sub">sub</p>
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Fork it" });
    expect(dialog).toHaveAttribute("data-dialog", "fork");
    expect(dialog).toHaveAttribute("data-state", "idle");
    expect(dialog).toHaveAttribute("aria-describedby", "sub");
    expect(dialog).toHaveAttribute("aria-busy", "true");
  });

  it("keeps role and aria-modal fixed whatever the caller passes", () => {
    render(<Modal open title="T" role="presentation" aria-modal="false" />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("uses a caller aria-label when there is no title", () => {
    render(<Modal open aria-label="Fork refused" />);
    expect(screen.getByRole("dialog", { name: "Fork refused" })).toBeInTheDocument();
  });

  it("calls a caller onClick on the dialog and still stops the backdrop close", () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    render(<Modal open title="T" onClose={onClose} onClick={onClick} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    render(<Modal open={false} title="T" data-dialog="fork" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
