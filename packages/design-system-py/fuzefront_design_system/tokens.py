"""
Design tokens matching FuzeFront's fuse seam design system (tokens.css).
"""

from typing import Final

# Core Brand Colors
COLOR_ELECTRIC_INDIGO: Final[str] = "#6e5cff"
COLOR_CYAN: Final[str] = "#29d3e6"
COLOR_FUZE_NAVY: Final[str] = "#0b0e15"
COLOR_FUZE_SLATE: Final[str] = "#141a26"

# Semantic Brand Gradients
SEAM_GRADIENT: Final[str] = "linear-gradient(90deg, #6e5cff, #29d3e6)"
SEAM_GRADIENT_45: Final[str] = "linear-gradient(135deg, #6e5cff, #29d3e6)"

# Dark Palette (Default)
DARK_BG_PRIMARY: Final[str] = "#0b0e15"
DARK_BG_SECONDARY: Final[str] = "#0f131c"
DARK_BG_TERTIARY: Final[str] = "#141a26"
DARK_BG_QUATERNARY: Final[str] = "#1c2433"
DARK_BORDER_COLOR: Final[str] = "#232c3d"
DARK_BORDER_SUBTLE: Final[str] = "#1a2230"
DARK_BORDER_STRONG: Final[str] = "#2f3b50"
DARK_TEXT_PRIMARY: Final[str] = "#e7ecf5"
DARK_TEXT_SECONDARY: Final[str] = "#9fa9bc"
DARK_TEXT_TERTIARY: Final[str] = "#68758d"

# Light Palette (Cool Override)
LIGHT_BG_PRIMARY: Final[str] = "#f6f8fb"
LIGHT_BG_SECONDARY: Final[str] = "#ffffff"
LIGHT_BG_TERTIARY: Final[str] = "#edf1f7"
LIGHT_BG_QUATERNARY: Final[str] = "#e2e8f0"
LIGHT_BORDER_COLOR: Final[str] = "#d8e0eb"
LIGHT_BORDER_SUBTLE: Final[str] = "#e6edf5"
LIGHT_BORDER_STRONG: Final[str] = "#c2cddb"
LIGHT_TEXT_PRIMARY: Final[str] = "#0f172a"
LIGHT_TEXT_SECONDARY: Final[str] = "#475569"
LIGHT_TEXT_TERTIARY: Final[str] = "#64748b"

# Accent Colors & Status Colors
COLOR_SUCCESS: Final[str] = "#10b981"
COLOR_WARNING: Final[str] = "#f59e0b"
COLOR_DANGER: Final[str] = "#ef4444"
COLOR_INFO: Final[str] = "#3b82f6"

# Typography Fonts
FONT_DISPLAY: Final[str] = "'Space Grotesk', -apple-system, sans-serif"
FONT_SANS: Final[str] = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
FONT_MONO: Final[str] = "'JetBrains Mono', 'Fira Code', monospace"

# Spacing Tokens (in rem / px equivalents)
SPACING_MAP: Final[dict[str, str]] = {
    "1": "0.25rem",  # 4px
    "2": "0.5rem",   # 8px
    "3": "0.75rem",  # 12px
    "4": "1rem",     # 16px
    "5": "1.25rem",  # 20px
    "6": "1.5rem",   # 24px
    "8": "2rem",     # 32px
    "10": "2.5rem",  # 40px
    "12": "3rem",    # 48px
}

# Border Radii
RADIUS_SM: Final[str] = "0.375rem"  # 6px
RADIUS_MD: Final[str] = "0.5rem"    # 8px
RADIUS_LG: Final[str] = "0.75rem"   # 12px
RADIUS_XL: Final[str] = "1rem"      # 16px
RADIUS_FULL: Final[str] = "9999px"
