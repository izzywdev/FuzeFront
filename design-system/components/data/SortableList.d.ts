import * as React from "react";

export interface SortableListProps<T = unknown>
  extends Omit<React.HTMLAttributes<HTMLUListElement>, "children"> {
  items: T[];
  /** Stable key extractor. @default (item) => item.id */
  getKey?: (item: T) => string | number;
  /** Renders an item's main content (icon/name/description). */
  renderItem?: (item: T, index: number) => React.ReactNode;
  /** Optional slot rendered before the reorder buttons (e.g. an enable toggle). */
  renderActions?: (item: T, index: number) => React.ReactNode;
  /** Called with the full reordered array after a drag-drop or button move. */
  onReorder?: (nextItems: T[]) => void;
  ariaLabel?: string;
}

/**
 * A reorderable list — drag is the primary interaction; the ▲▼ button pair
 * (`data-action="move-up" | "move-down"`) is the keyboard-accessible
 * equivalent, disabled at the list boundary.
 */
export function SortableList<T = unknown>(props: SortableListProps<T>): JSX.Element;
