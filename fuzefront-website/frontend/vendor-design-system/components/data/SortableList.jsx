import React from "react";

function reorderBtnStyle(disabled) {
  return {
    appearance: "none",
    padding: "0 var(--space-2)",
    fontSize: "var(--text-xs)",
    lineHeight: 1.6,
    fontFamily: "var(--font-sans)",
    background: "var(--bg-quaternary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
}

/**
 * A reorderable list — drag is the primary interaction, the ▲▼ button pair
 * is the keyboard-accessible equivalent (built for the per-portal app
 * catalog's enable/reorder list). Each item's content is supplied via
 * `renderItem`; an optional `renderActions` slot sits before the reorder
 * buttons (e.g. an enable/disable toggle). Move buttons disable at the list
 * boundary rather than wrapping.
 */
export function SortableList({
  items = [],
  getKey = (item) => item.id,
  renderItem,
  renderActions,
  onReorder,
  ariaLabel,
  style,
  ...rest
}) {
  const dragIndexRef = React.useRef(null);

  const moveItem = (from, to) => {
    if (to < 0 || to >= items.length || from === to || from == null) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder && onReorder(next);
  };

  return (
    <ul
      role="list"
      aria-label={ariaLabel}
      data-sortable-list=""
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
      {...rest}
    >
      {items.map((item, index) => {
        const key = getKey(item);
        return (
          <li
            key={key}
            draggable
            data-sortable-item={key}
            onDragStart={(e) => {
              dragIndexRef.current = index;
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              moveItem(dragIndexRef.current, index);
              dragIndexRef.current = null;
            }}
            onDragEnd={() => {
              dragIndexRef.current = null;
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              alignItems: "center",
              gap: "var(--space-4)",
              padding: "var(--space-4) var(--space-6)",
              borderTop: index === 0 ? "none" : "1px solid var(--border-color)",
            }}
          >
            <span
              aria-hidden="true"
              data-sortable-grip=""
              style={{
                color: "var(--text-tertiary)",
                cursor: "grab",
                fontSize: "var(--text-lg)",
                lineHeight: 1,
                userSelect: "none",
              }}
            >
              ⠿
            </span>
            <div>{renderItem ? renderItem(item, index) : null}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              {renderActions && renderActions(item, index)}
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <button
                  type="button"
                  aria-label={`Move item up`}
                  data-action="move-up"
                  disabled={index === 0}
                  onClick={() => moveItem(index, index - 1)}
                  style={reorderBtnStyle(index === 0)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label={`Move item down`}
                  data-action="move-down"
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, index + 1)}
                  style={reorderBtnStyle(index === items.length - 1)}
                >
                  ▼
                </button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
