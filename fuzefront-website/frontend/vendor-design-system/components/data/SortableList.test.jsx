import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SortableList } from "./SortableList.jsx";

const APPS = [
  { id: "crm", name: "CRM" },
  { id: "docs", name: "Docs" },
  { id: "analytics", name: "Analytics" },
];

describe("<SortableList>", () => {
  it("renders every item via renderItem", () => {
    render(<SortableList items={APPS} renderItem={(app) => <span>{app.name}</span>} />);
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("renders the optional actions slot", () => {
    render(
      <SortableList
        items={APPS}
        renderItem={(app) => <span>{app.name}</span>}
        renderActions={(app) => <button>{`Remove ${app.name}`}</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Remove CRM" })).toBeInTheDocument();
  });

  it("moves an item down and calls onReorder with the new array", () => {
    const onReorder = vi.fn();
    render(<SortableList items={APPS} renderItem={(app) => <span>{app.name}</span>} onReorder={onReorder} />);
    const [firstDown] = screen.getAllByLabelText("Move item down");
    firstDown.click();
    expect(onReorder).toHaveBeenCalledWith([
      { id: "docs", name: "Docs" },
      { id: "crm", name: "CRM" },
      { id: "analytics", name: "Analytics" },
    ]);
  });

  it("moves an item up and calls onReorder with the new array", () => {
    const onReorder = vi.fn();
    render(<SortableList items={APPS} renderItem={(app) => <span>{app.name}</span>} onReorder={onReorder} />);
    const upButtons = screen.getAllByLabelText("Move item up");
    upButtons[1].click(); // "Docs" moves up
    expect(onReorder).toHaveBeenCalledWith([
      { id: "docs", name: "Docs" },
      { id: "crm", name: "CRM" },
      { id: "analytics", name: "Analytics" },
    ]);
  });

  it("disables the move-up button on the first item and move-down on the last", () => {
    render(<SortableList items={APPS} renderItem={(app) => <span>{app.name}</span>} />);
    const upButtons = screen.getAllByLabelText("Move item up");
    const downButtons = screen.getAllByLabelText("Move item down");
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
    expect(upButtons[upButtons.length - 1]).not.toBeDisabled();
  });

  it("does not call onReorder when the disabled boundary button is clicked", () => {
    const onReorder = vi.fn();
    render(<SortableList items={APPS} renderItem={(app) => <span>{app.name}</span>} onReorder={onReorder} />);
    const upButtons = screen.getAllByLabelText("Move item up");
    upButtons[0].click(); // disabled — first item can't move up
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("marks each row draggable", () => {
    render(<SortableList items={APPS} renderItem={(app) => <span>{app.name}</span>} />);
    const items = document.querySelectorAll("[data-sortable-item]");
    expect(items).toHaveLength(3);
    items.forEach((el) => expect(el).toHaveAttribute("draggable", "true"));
  });
});
