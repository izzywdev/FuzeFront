import { CSSProperties, HTMLAttributes } from "react";

export interface PaginationProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Current active page (1-indexed). */
  page?: number;
  /** Total number of pages. */
  total?: number;
  /** Called with the new page number when a page button is clicked. */
  onChange?: (page: number) => void;
  style?: CSSProperties;
}

export declare function Pagination(props: PaginationProps): JSX.Element;
