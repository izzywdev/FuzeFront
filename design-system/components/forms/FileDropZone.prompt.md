Drag-and-drop file target — a dashed-border drop area that turns accent-colored on dragover (`--drop-active` background, `--accent-color` border). Keyboard-activatable: `Enter` or `Space` opens the native file picker. Calls `onFiles` with the selected or dropped files.

```jsx
<FileDropZone
  accept=".csv"
  label="Drop a CSV file or click to browse"
  onFiles={(files) => handleUpload(files)}
/>

<FileDropZone
  accept=".png,.jpg,.jpeg"
  multiple
  label="Drop images or click to select"
  onFiles={(files) => Array.from(files).forEach(processImage)}
/>

<FileDropZone
  onFiles={(files) => importData(files[0])}
  disabled
  label="Upload unavailable during import"
/>
```

Props: `onFiles` (FileList | File[]), `accept` (forwarded to hidden `<input>`), `label` (hint inside the zone), `disabled`, `multiple` (default false), plus all div attributes. Focus shows `--accent-soft` ring; dragover switches border to `--accent-color` and fill to `--drop-active`.
