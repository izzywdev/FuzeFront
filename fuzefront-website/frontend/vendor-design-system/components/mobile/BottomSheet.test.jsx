import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomSheet } from "./BottomSheet.jsx";

describe("<BottomSheet> attribute forwarding", () => {
  it("forwards data-*, aria-describedby and aria-busy to the role=dialog element", () => {
    render(
      <BottomSheet
        open
        title="Fork it"
        data-dialog="fork"
        data-presentation="bottom-sheet"
        aria-describedby="sub"
        aria-busy="true"
      >
        <p id="sub">sub</p>
      </BottomSheet>
    );
    const dialog = screen.getByRole("dialog", { name: "Fork it" });
    expect(dialog).toHaveAttribute("data-dialog", "fork");
    expect(dialog).toHaveAttribute("data-presentation", "bottom-sheet");
    expect(dialog).toHaveAttribute("aria-describedby", "sub");
    expect(dialog).toHaveAttribute("aria-busy", "true");
  });

  it("uses a caller aria-label when there is no title", () => {
    render(<BottomSheet open aria-label="Fork refused" />);
    expect(screen.getByRole("dialog", { name: "Fork refused" })).toBeInTheDocument();
  });

  it("calls a caller onClick on the sheet and does not close via the backdrop", () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    render(<BottomSheet open title="T" onClose={onClose} onClick={onClick} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and renders nothing while closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(<BottomSheet open title="T" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<BottomSheet open={false} title="T" onClose={onClose} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
