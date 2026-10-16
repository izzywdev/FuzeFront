"""
FuzeFront Design System Python Package.
"""

from .tokens import (
    COLOR_ELECTRIC_INDIGO,
    COLOR_CYAN,
    SEAM_GRADIENT,
    DARK_BG_PRIMARY,
    DARK_BG_SECONDARY,
    DARK_BG_TERTIARY,
    DARK_BORDER_COLOR,
    DARK_TEXT_PRIMARY,
    DARK_TEXT_SECONDARY,
    LIGHT_BG_PRIMARY,
    LIGHT_BG_SECONDARY,
    LIGHT_BORDER_COLOR,
    LIGHT_TEXT_PRIMARY,
    FONT_DISPLAY,
    FONT_SANS,
    FONT_MONO,
)
from .theme import FuzeTheme, ThemeContext, ThemePalette, DARK_PALETTE, LIGHT_PALETTE
from .terminal import get_ansi_seam_banner, format_cli_status, get_rich_theme_dict
from .components import StatusPillData, ChatBubbleData

__version__ = "1.0.0"

__all__ = [
    "COLOR_ELECTRIC_INDIGO",
    "COLOR_CYAN",
    "SEAM_GRADIENT",
    "DARK_BG_PRIMARY",
    "DARK_BG_SECONDARY",
    "DARK_BG_TERTIARY",
    "DARK_BORDER_COLOR",
    "DARK_TEXT_PRIMARY",
    "DARK_TEXT_SECONDARY",
    "LIGHT_BG_PRIMARY",
    "LIGHT_BG_SECONDARY",
    "LIGHT_BORDER_COLOR",
    "LIGHT_TEXT_PRIMARY",
    "FONT_DISPLAY",
    "FONT_SANS",
    "FONT_MONO",
    "FuzeTheme",
    "ThemeContext",
    "ThemePalette",
    "DARK_PALETTE",
    "LIGHT_PALETTE",
    "get_ansi_seam_banner",
    "format_cli_status",
    "get_rich_theme_dict",
    "StatusPillData",
    "ChatBubbleData",
]
