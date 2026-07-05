import React from "react";

const SKELETON_ROWS = 5;

const SortAscIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: "none" }}
  >
    <path d="M5 8V2M2 5l3-3 3 3" />
  </svg>
);

const SortDescIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: "none" }}
  >
    <path d="M5 2v6M2 5l3 3 3-3" />
  </svg>
);

const SortNeutralIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: "none", opacity: 0.4 }}
  >
    <path d="M5 2v6M2 4l3-3 3 3M2 6l3 3 3-3" />
  </svg>
);

function SkeletonCell({ width = "80%" }) {
  return (
    <div
      style={{
        height: "12px",
        width,
        background: "var(--bg-quaternary)",
        borderRadius: "var(--radius-sm)",
        animation: "ds-skeleton-pulse var(--duration-slow, 320ms) ease-in-out infinite alternate",
      }}
    />
  );
}

/**
 * Semantic table shell — renders `<thead>` from `columns` (with sort affordance
 * + aria-sort) and accepts the consumer's `<tbody>` as `children`. Loading shows
 * skeleton rows; emptyState shows when children are absent and not loading.
 */
export function DataTable({
  columns = [],
  children,
  loading = false,
  emptyState,
  onSort,
  sortBy,
  sortDir = "asc",
  style,
  ...rest
}) {
  const hasChildren = Boolean(
    children &&
      React.Children.count(
        typeof children === "object" && children.props?.children
          ? children.props.children
          : children
      ) > 0
  );

  function getAriaSortAttr(col) {
    if (!col.sortable || col.key !== sortBy) return undefined;
    return sortDir === "asc" ? "ascending" : "descending";
  }

  return (
    <>
      {/* Inline keyframes for skeleton shimmer — injected once via a <style> tag. */}
      <style>{`
        @keyframes ds-skeleton-pulse {
          from { opacity: 1; }
          to   { opacity: 0.4; }
        }
      `}</style>
      <div
        style={{
          width: "100%",
          overflowX: "auto",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          ...style,
        }}
        {...rest}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-sans)",
          }}
        >
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = col.key === sortBy;
                const ariaSortAttr = getAriaSortAttr(col);
                return (
                  <th
                    key={col.key}
                    aria-sort={ariaSortAttr}
                    scope="col"
                    onClick={
                      col.sortable && onSort
                        ? () => onSort(col.key)
                        : undefined
                    }
                    style={{
                      padding: "var(--space-3) var(--space-4)",
                      textAlign: col.align || "left",
                      fontFamily: "var(--font-sans)",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-medium)",
                      color: "var(--text-secondary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid var(--border-color)",
                      background: "var(--bg-tertiary)",
                      cursor:
                        col.sortable && onSort ? "pointer" : "default",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (col.sortable && onSort)
                        e.currentTarget.style.color = "var(--text-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                      }}
                    >
                      {col.header}
                      {col.sortable &&
                        (isSorted ? (
                          sortDir === "asc" ? (
                            <SortAscIcon />
                          ) : (
                            <SortDescIcon />
                          )
                        ) : (
                          <SortNeutralIcon />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          {loading ? (
            <tbody aria-hidden="true" aria-label="Loading">
              {Array.from({ length: SKELETON_ROWS }).map((_, ri) => (
                <tr key={ri}>
                  {columns.map((col, ci) => (
                    <td
                      key={col.key}
                      style={{
                        padding: "var(--space-3) var(--space-4)",
                        borderBottom:
                          ri < SKELETON_ROWS - 1
                            ? "1px solid var(--border-color)"
                            : "none",
                      }}
                    >
                      <SkeletonCell
                        width={ci === 0 ? "60%" : ci % 2 === 0 ? "45%" : "70%"}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : hasChildren ? (
            children
          ) : (
            <tbody>
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: "var(--space-12) var(--space-4)",
                    textAlign: "center",
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--text-sm)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  {emptyState ?? "No data"}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </>
  );
}
