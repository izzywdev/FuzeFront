import React, { useRef, useState } from "react";

/**
 * Drag-and-drop file target — dashed border, keyboard-activatable, calls
 * `onFiles` with the selected/dropped FileList. Border and background shift
 * to accent colors on dragover.
 */
export function FileDropZone({
  onFiles,
  accept,
  label,
  disabled = false,
  multiple = false,
  style,
  ...rest
}) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleFiles(files) {
    if (!files || files.length === 0 || disabled) return;
    onFiles?.(files);
  }

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={
        typeof label === "string"
          ? label
          : accept
          ? `Drop or select file (${accept})`
          : "Drop or select file"
      }
      aria-disabled={disabled || undefined}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        width: "100%",
        boxSizing: "border-box",
        padding: "var(--space-8) var(--space-4)",
        background: isDragOver ? "var(--drop-active)" : "var(--bg-secondary)",
        border: `2px dashed ${isDragOver ? "var(--accent-color)" : "var(--border-color)"}`,
        borderRadius: "var(--radius-lg)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition:
          "background var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
        outline: "none",
        ...style,
      }}
      onFocus={(e) => {
        if (!disabled)
          e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
      {...rest}
    >
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          // reset so the same file can be re-selected
          e.target.value = "";
        }}
      />

      {/* Upload icon */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke={isDragOver ? "var(--accent-color)" : "var(--text-tertiary)"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{
          transition: "stroke var(--duration-base) var(--ease-standard)",
        }}
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>

      {/* Label hint */}
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          color: isDragOver ? "var(--accent-color)" : "var(--text-secondary)",
          textAlign: "center",
          lineHeight: 1.4,
          transition: "color var(--duration-base) var(--ease-standard)",
          pointerEvents: "none",
        }}
      >
        {label ?? (accept ? `Drop a ${accept} file or click to browse` : "Drop a file or click to browse")}
      </span>
    </div>
  );
}
