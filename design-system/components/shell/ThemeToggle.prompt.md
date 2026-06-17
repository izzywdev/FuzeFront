The host shell's theme switch — a quiet IconButton in the top bar that flips document `data-theme` between dark and light, showing a moon while dark and a sun while light.

```jsx
// Drive it from your theme hook
const { theme, setTheme } = useTheme();
<ThemeToggle theme={theme} onToggle={(next) => setTheme(next)} />

// Uncontrolled: it still flips data-theme on its own
<ThemeToggle theme="dark" />

// Persist the choice on toggle
<ThemeToggle theme={theme} onToggle={(next) => localStorage.setItem("theme", next)} />
```

Props: `theme` (`dark | light`, selects the icon) and `onToggle(next, event)` (fires after `data-theme` is applied). Self-labelling for accessibility via `title`/`aria-label`/`aria-pressed`.
