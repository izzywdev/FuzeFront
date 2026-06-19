import * as React from "react";

/** Column descriptor passed to DataTable. */
export interface DataTableColumn {
  /** Unique key — passed to `onSort` when this header is clicked. */
  key: string;
  /** Header cell content. */
  header: React.ReactNode;
  /** Show a sort caret and call `onSort(key)` when clicked. */
  sortable?: boolean;
  /** Cell alignment — applied to the `<th>`. Default `'left'`. */
  align?: "left" | "center" | "right";
}

/**
 * Semantic table shell — `<thead>` built from `columns`; consumer renders
 * `<tbody>` as `children`. Sort affordance and aria-sort are handled here;
 * actual sort logic lives in the consumer (e.g. TanStack Table).
 */
export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column definitions that build the `<thead>`. */
  columns: DataTableColumn[];
  /**
   * The `<tbody>` element (or elements) rendered by the consumer.
   * When absent and `loading` is false, `emptyState` is shown.
   */
  children?: React.ReactNode;
  /** When true, renders 5 skeleton rows instead of `children`. */
  loading?: boolean;
  /** Content shown when `children` is empty and `loading` is false. */
  emptyState?: React.ReactNode;
  /** Called with the column key when a sortable header is clicked. */
  onSort?: (key: string) => void;
  /** Key of the currently sorted column. */
  sortBy?: string;
  /** Current sort direction. Default `'asc'`. */
  sortDir?: "asc" | "desc";
}

export function DataTable(props: DataTableProps): JSX.Element;
