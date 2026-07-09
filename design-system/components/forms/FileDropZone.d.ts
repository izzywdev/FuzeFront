import * as React from "react";

/**
 * Drag-and-drop file target — dashed-border drop area, keyboard-activatable
 * (Enter / Space opens the picker), calls `onFiles` with the selected or
 * dropped files.
 */
export interface FileDropZoneProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Called with the selected or dropped `FileList` (or `File[]`). */
  onFiles?: (files: FileList | File[]) => void;
  /** Native `accept` attribute forwarded to the hidden `<input type="file">` (e.g. `'.csv,.json'`). */
  accept?: string;
  /** Hint text rendered inside the zone. Defaults to a generic "drop or click" message. */
  label?: React.ReactNode;
  /** Disables interaction and dims the zone. */
  disabled?: boolean;
  /** Allow picking/dropping multiple files. Default false. */
  multiple?: boolean;
}

export function FileDropZone(props: FileDropZoneProps): JSX.Element;
