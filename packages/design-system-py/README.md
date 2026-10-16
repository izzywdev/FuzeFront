# FuzeFront Design System for Python (`fuzefront-design-system`)

The Python binding for the **FuzeFront Design System** — providing design tokens, themes, terminal styles, and component contracts for backend services and CLI runtimes.

## Brand Identity — "The Fuse Seam"

- **Gradient Seam**: Electric Indigo (`#6e5cff`) to Cyan (`#29d3e6`).
- **Dark-Default**: `#0b0e15` primary background, cool light override available.
- **Typography**: Space Grotesk (Brand/Display), Inter (Body), JetBrains Mono (Technical/Data).

## Usage

```python
from fuzefront_design_system import tokens, ThemeContext, FuzeTheme, get_terminal_theme

# Access design tokens
print(tokens.COLOR_ELECTRIC_INDIGO) # #6e5cff
print(tokens.COLOR_CYAN)            # #29d3e6
print(tokens.SEAM_GRADIENT)         # linear-gradient(90deg, #6e5cff, #29d3e6)

# Resolve theme from request or context
theme_ctx = ThemeContext(theme=FuzeTheme.DARK)
theme_colors = theme_ctx.colors

# Terminal styling with Rich
console_theme = get_terminal_theme()
```
